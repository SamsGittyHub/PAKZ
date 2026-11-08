"use server";
import { refresh } from "next/cache";
import { invalidateCatalog } from "@/lib/shop/catalog";
import { z } from "zod";
import { assertAdmin, type AdminUser } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/format";
import { fromZonedInput } from "@/lib/dates";
import { CONDITIONS, STATUSES } from "@/lib/admin/products";
import { deleteImages, imageUrl, putImage } from "@/lib/storage";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

const money = z.coerce.number().min(0).max(1_000_000);
const optMoney = z.union([money, z.literal(""), z.null()]).optional().transform((v) => (v === "" || v == null ? null : v));
const optStr = z.string().max(5000).optional().nullable().transform((v) => (v?.trim() ? v.trim() : null));

const VariantInput = z.object({
  id: z.string().uuid().optional(),
  size: optStr,
  condition: z.enum(CONDITIONS),
  sku: optStr,
  price: money,
  cost_price: money.optional(), // absent for staff
  low_stock_threshold: z.coerce.number().int().min(0).max(1000).default(1),
  status: z.enum(["active", "hidden", "archived", "sold_out"]).default("active"),
  initial_quantity: z.coerce.number().int().min(0).max(10_000).optional(),
  purchase_source: z.enum(["retail", "resale", "consignment", "private"]).optional(),
  remove: z.boolean().optional(),
});

const ProductInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(200),
  slug: optStr,
  description: optStr,
  category_id: z.string().uuid().nullable().optional(),
  new_category: optStr,
  brand_id: z.string().uuid().nullable().optional(),
  new_brand: optStr,
  status: z.enum(STATUSES),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  featured: z.boolean().default(false),
  allow_offers: z.boolean().default(false),
  offer_floor_price: optMoney,
  seo_title: optStr,
  seo_description: optStr,
  authenticity_notes: optStr,
  publish_at: optStr,
  drop_id: z.string().uuid().nullable().optional(),
  variants: z.array(VariantInput).min(1, "Add at least one variant").max(200),
  images: z.array(z.object({ id: z.string().uuid(), position: z.number().int(), is_cover: z.boolean() })).default([]),
  removed_image_ids: z.array(z.string().uuid()).default([]),
});
export type ProductInput = z.input<typeof ProductInput>;

async function lookupOrCreate(table: "categories" | "brands", name: string): Promise<string> {
  const existing = await db().from(table).select("id").ilike("name", name).maybeSingle();
  if (existing.data) return existing.data.id;
  const created = must(await db().from(table).insert({ name, slug: slugify(name) }).select("id").single(), table);
  return created.id;
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || "item";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    let q = db().from("products").select("id").eq("slug", slug);
    if (excludeId) q = q.neq("id", excludeId);
    const { data } = await q.maybeSingle();
    if (!data) return slug;
  }
  return `${root}-${crypto.randomUUID().slice(0, 6)}`;
}

async function receive(admin: AdminUser, variantId: string, qty: number, unitCost: number, source = "retail", note = "Initial stock") {
  const { error } = await db().rpc("receive_stock", {
    p_variant_id: variantId, p_quantity: qty, p_unit_cost: unitCost, p_source: source,
    p_fees: 0, p_shipping_in: 0, p_note: note, p_admin_id: admin.id,
  });
  if (error) throw new Error(`receive_stock: ${error.message}`);
}

export async function saveProduct(input: ProductInput): Promise<ActionResult<{ id: string }>> {
  try {
    const admin = await assertAdmin();
    const p = ProductInput.parse(input);
    if (p.status === "scheduled" && !p.publish_at) throw new Error("Set a publish date for scheduled listings");

    const category_id = p.new_category ? await lookupOrCreate("categories", p.new_category) : p.category_id ?? null;
    const brand_id = p.new_brand ? await lookupOrCreate("brands", p.new_brand) : p.brand_id ?? null;
    const row = {
      title: p.title,
      slug: await uniqueSlug(p.slug ?? p.title, p.id),
      description: p.description,
      category_id,
      brand_id,
      status: p.status,
      tags: [...new Set(p.tags.map((t) => t.toLowerCase()))],
      featured: p.featured,
      allow_offers: p.allow_offers,
      offer_floor_price: p.allow_offers ? p.offer_floor_price : null,
      seo_title: p.seo_title,
      seo_description: p.seo_description,
      authenticity_notes: p.authenticity_notes,
      publish_at: p.publish_at ? fromZonedInput(p.publish_at).toISOString() : null,
      drop_id: p.drop_id ?? null,
    };

    let id = p.id;
    if (id) {
      must(await db().from("products").update(row).eq("id", id).select("id").single(), "update product");
    } else {
      id = must(await db().from("products").insert(row).select("id").single(), "insert product").id as string;
    }

    // Variants
    for (const [position, v] of p.variants.entries()) {
      if (v.id && v.remove) {
        const { count } = await db().from("order_items").select("id", { count: "exact", head: true }).eq("variant_id", v.id);
        if (count) {
          must(await db().from("product_variants").update({ status: "archived" }).eq("id", v.id).select("id"), "archive variant");
        } else {
          must(await db().from("product_variants").delete().eq("id", v.id).select("id"), "delete variant");
        }
        continue;
      }
      if (v.remove) continue;
      const base = {
        size: v.size, condition: v.condition, sku: v.sku, price: v.price,
        low_stock_threshold: v.low_stock_threshold, position,
        ...(v.status !== "sold_out" ? { status: v.status } : {}),
      };
      // Owners can override the cost basis directly; it's otherwise set by receive_stock (weighted average).
      const costOverride = admin.canSeeCosts && v.cost_price != null ? { cost_price: v.cost_price } : {};
      if (v.id) {
        must(await db().from("product_variants").update({ ...base, ...costOverride }).eq("id", v.id).eq("product_id", id).select("id"), "update variant");
      } else {
        const created = must(
          await db().from("product_variants").insert({ ...base, ...costOverride, product_id: id, quantity: 0 }).select("id").single(),
          "insert variant",
        );
        if (v.initial_quantity && v.initial_quantity > 0) {
          // Staff may enter a purchase cost when receiving stock (write-only); they never read it back.
          await receive(admin, created.id, v.initial_quantity, v.cost_price ?? 0, v.purchase_source);
        }
      }
    }

    // Images: reorder / cover / remove
    for (const img of p.images) {
      await db().from("product_images").update({ position: img.position, is_cover: img.is_cover }).eq("id", img.id).eq("product_id", id);
    }
    if (p.removed_image_ids.length) await removeImages(id, p.removed_image_ids);

    await audit(admin, p.id ? "product.update" : "product.create", "product", id, { title: p.title, status: p.status });
    refresh();
    invalidateCatalog();
    return { ok: true, data: { id } };
  } catch (e) {
    return fail(e instanceof z.ZodError ? new Error(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")) : e);
  }
}

async function removeImages(productId: string, ids: string[]) {
  const rows = must(await db().from("product_images").select("id, path").in("id", ids).eq("product_id", productId), "images");
  must(await db().from("product_images").delete().in("id", ids).eq("product_id", productId).select("id"), "delete images");
  // Only delete files no other listing (e.g. a duplicate) still references.
  const paths = rows.map((r) => r.path);
  const stillUsed = must(await db().from("product_images").select("path").in("path", paths), "images in use").map((r) => r.path);
  const orphaned = paths.filter((p) => !stillUsed.includes(p));
  if (orphaned.length) await deleteImages(orphaned);
}

/** Upload one already-compressed (WebP) image. */
export async function uploadProductImage(productId: string, form: FormData): Promise<ActionResult<{ id: string; url: string; path: string }>> {
  try {
    const admin = await assertAdmin();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file");
    if (file.size > 8 * 1024 * 1024) throw new Error("Image too large (max 8MB after compression)");
    if (!/^image\/(webp|jpeg|png|avif)$/.test(file.type)) throw new Error(`Unsupported image type ${file.type}`);
    const ext = file.type.split("/")[1];
    const path = `${productId}/${crypto.randomUUID()}.${ext}`;
    await putImage(path, new Uint8Array(await file.arrayBuffer()), file.type);

    const { data: existing } = await db().from("product_images").select("position").eq("product_id", productId).order("position", { ascending: false }).limit(1);
    const position = (existing?.[0]?.position ?? -1) + 1;
    const width = Number(form.get("width")) || null;
    const height = Number(form.get("height")) || null;
    const img = must(
      await db().from("product_images").insert({ product_id: productId, path, position, is_cover: position === 0, width, height }).select("id").single(),
      "insert image",
    );
    await audit(admin, "product.image_upload", "product", productId, { path });
    return { ok: true, data: { id: img.id, url: imageUrl(path)!, path } };
  } catch (e) {
    return fail(e);
  }
}

const BulkInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  action: z.enum(["publish", "unpublish", "mark_sold", "price_pct", "price_fixed", "add_tag", "feature", "unfeature", "archive", "delete"]),
  value: z.union([z.string(), z.number()]).optional(),
});

export async function bulkProducts(input: z.input<typeof BulkInput>): Promise<ActionResult> {
  try {
    const admin = await assertAdmin();
    const { ids, action, value } = BulkInput.parse(input);
    const products = () => db().from("products");
    let message = "";

    switch (action) {
      case "publish":
        must(await products().update({ status: "active" }).in("id", ids).neq("status", "archived").select("id"), "publish");
        break;
      case "unpublish":
        must(await products().update({ status: "draft" }).in("id", ids).select("id"), "unpublish");
        break;
      case "archive":
        must(await products().update({ status: "archived" }).in("id", ids).select("id"), "archive");
        break;
      case "feature":
      case "unfeature":
        must(await products().update({ featured: action === "feature" }).in("id", ids).select("id"), "feature");
        break;
      case "add_tag": {
        const tag = String(value ?? "").trim().toLowerCase();
        if (!tag) throw new Error("Enter a tag");
        const rows = must(await products().select("id, tags").in("id", ids), "tags");
        for (const r of rows) {
          if (!r.tags.includes(tag)) await products().update({ tags: [...r.tags, tag] }).eq("id", r.id);
        }
        break;
      }
      case "price_pct":
      case "price_fixed": {
        const n = Number(value);
        if (!Number.isFinite(n) || n === 0) throw new Error("Enter a non-zero amount");
        if (action === "price_pct" && (n <= -100 || n > 500)) throw new Error("Percentage must be between -99 and 500");
        const variants = must(await db().from("product_variants").select("id, price").in("product_id", ids).neq("status", "archived"), "variants");
        for (const v of variants) {
          const next = action === "price_pct" ? Math.round(Number(v.price) * (1 + n / 100)) : Number(v.price) + n;
          await db().from("product_variants").update({ price: Math.max(0, Math.round(next * 100) / 100) }).eq("id", v.id);
        }
        message = `Updated ${variants.length} variant prices`;
        break;
      }
      case "mark_sold": {
        // Removes remaining stock through the ledger. Use "Record sale" instead when you want the revenue tracked.
        const variants = must(await db().from("product_variants").select("id, quantity").in("product_id", ids).gt("quantity", 0), "variants");
        for (const v of variants) {
          const { error } = await db().rpc("adjust_stock", {
            p_variant_id: v.id, p_change: -v.quantity, p_reason: "adjustment", p_note: "Marked sold (no order recorded)", p_admin_id: admin.id,
          });
          if (error) throw new Error(error.message);
        }
        must(await products().update({ status: "sold" }).in("id", ids).select("id"), "mark sold");
        message = "Marked sold. Tip: record a sale instead to keep revenue and profit accurate.";
        break;
      }
      case "delete": {
        const { data: sold } = await db().from("order_items").select("product_id").in("product_id", ids);
        const withSales = new Set((sold ?? []).map((s) => s.product_id));
        const deletable = ids.filter((id) => !withSales.has(id));
        if (deletable.length) {
          const imgs = must(await db().from("product_images").select("id, product_id").in("product_id", deletable), "images");
          for (const pid of deletable) {
            const own = imgs.filter((i) => i.product_id === pid).map((i) => i.id);
            if (own.length) await removeImages(pid, own);
          }
          must(await products().delete().in("id", deletable).select("id"), "delete");
        }
        if (withSales.size) {
          must(await products().update({ status: "archived" }).in("id", [...withSales]).select("id"), "archive");
          message = `${deletable.length} deleted; ${withSales.size} with sales history were archived instead.`;
        }
        break;
      }
    }
    await audit(admin, `product.bulk_${action}`, "product", null, { ids, value });
    refresh();
    invalidateCatalog();
    return { ok: true, message: message || `Done (${ids.length} products)` };
  } catch (e) {
    return fail(e);
  }
}

export async function duplicateProduct(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const admin = await assertAdmin();
    const src = must(await db().from("products").select("*, product_variants(*), product_images(*)").eq("id", id).single(), "product");
    const { id: _id, created_at: _c, updated_at: _u, listed_at: _l, sold_at: _s, archived_at: _a, product_variants, product_images, ...rest } = src;
    void _id; void _c; void _u; void _l; void _s; void _a;
    const copy = must(
      await db().from("products").insert({ ...rest, title: `${rest.title} (copy)`, slug: await uniqueSlug(`${rest.slug}-copy`), status: "draft", publish_at: null }).select("id").single(),
      "duplicate",
    );
    for (const v of product_variants as Record<string, unknown>[]) {
      await db().from("product_variants").insert({
        product_id: copy.id, size: v.size, condition: v.condition, sku: v.sku ? `${v.sku}-copy-${crypto.randomUUID().slice(0, 4)}` : null,
        price: v.price, cost_price: admin.canSeeCosts ? v.cost_price : 0, low_stock_threshold: v.low_stock_threshold, position: v.position, quantity: 0,
      });
    }
    for (const img of product_images as Record<string, unknown>[]) {
      await db().from("product_images").insert({ product_id: copy.id, path: img.path, position: img.position, is_cover: img.is_cover, width: img.width, height: img.height });
    }
    await audit(admin, "product.duplicate", "product", copy.id, { from: id });
    return { ok: true, data: { id: copy.id } };
  } catch (e) {
    return fail(e);
  }
}

const ImportRow = z.object({
  title: z.string().trim().min(2),
  brand: z.string().optional().default(""),
  category: z.string().optional().default(""),
  description: z.string().optional().default(""),
  status: z.enum(STATUSES).optional().default("draft"),
  size: z.string().optional().default(""),
  condition: z.enum(CONDITIONS).optional().default("new"),
  price: z.coerce.number().min(0),
  cost: z.coerce.number().min(0).optional().default(0),
  quantity: z.coerce.number().int().min(0).optional().default(0),
  sku: z.string().optional().default(""),
  tags: z.string().optional().default(""),
  source: z.enum(["retail", "resale", "consignment", "private"]).optional().default("retail"),
});

/** CSV import: one row per variant; rows with the same title + brand become one product. */
export async function importProducts(rows: Record<string, string>[]): Promise<ActionResult<{ products: number; variants: number; errors: string[] }>> {
  try {
    const admin = await assertAdmin();
    if (rows.length > 5000) throw new Error("Import at most 5000 rows at a time");
    const errors: string[] = [];
    const groups = new Map<string, z.output<typeof ImportRow>[]>();
    rows.forEach((raw, i) => {
      const clean = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), typeof v === "string" ? v.trim() : v]));
      for (const k of Object.keys(clean)) if (clean[k] === "") delete clean[k];
      const parsed = ImportRow.safeParse(clean);
      if (!parsed.success) { errors.push(`Row ${i + 2}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join(", ")}`); return; }
      const key = `${parsed.data.title.toLowerCase()}|${parsed.data.brand.toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), parsed.data]);
    });

    let products = 0;
    let variants = 0;
    for (const items of groups.values()) {
      const first = items[0];
      try {
        const res = await saveProduct({
          title: first.title,
          description: first.description || null,
          new_brand: first.brand || null,
          new_category: first.category || null,
          status: first.status,
          tags: first.tags ? first.tags.split(/[;|,]/).map((t) => t.trim()).filter(Boolean) : [],
          variants: items.map((r) => ({
            size: r.size || null, condition: r.condition, sku: r.sku || null, price: r.price,
            cost_price: r.cost, initial_quantity: r.quantity, purchase_source: r.source,
            low_stock_threshold: r.quantity > 1 ? Math.max(2, Math.ceil(r.quantity * 0.2)) : 1, status: "active",
          })),
        });
        if (!res.ok) throw new Error(res.error);
        products++;
        variants += items.length;
      } catch (e) {
        errors.push(`${first.title}: ${e instanceof Error ? e.message : e}`);
      }
    }
    await audit(admin, "product.import", "product", null, { products, variants, errors: errors.length });
    refresh();
    invalidateCatalog();
    return { ok: true, data: { products, variants, errors } };
  } catch (e) {
    return fail(e);
  }
}
