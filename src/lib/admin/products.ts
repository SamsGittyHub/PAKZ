import "server-only";
import { db, must, rpc } from "@/lib/supabase/admin";
import { redact, type AdminUser } from "@/lib/auth";
import { iso } from "./context";

export const IMAGE_BUCKET = "product-images";
export const imageUrl = (path: string | null | undefined) =>
  path ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${IMAGE_BUCKET}/${path}` : null;

export const CONDITIONS = ["new", "new_defects", "used_excellent", "used_good", "used_fair"] as const;
export const STATUSES = ["draft", "scheduled", "active", "sold", "archived"] as const;

export interface Lookup { id: string; name: string }

export async function getLookups() {
  const [categories, brands, drops] = await Promise.all([
    db().from("categories").select("id, name").order("name"),
    db().from("brands").select("id, name").order("name"),
    db().from("drops").select("id, name").order("created_at", { ascending: false }),
  ]);
  return {
    categories: must(categories, "categories") as Lookup[],
    brands: must(brands, "brands") as Lookup[],
    drops: must(drops, "drops") as Lookup[],
  };
}

interface VariantRow {
  id: string; size: string | null; condition: string; price: number; cost_price: number; quantity: number;
  reserved_quantity: number; low_stock_threshold: number; status: string; sku: string | null;
}

export interface ProductListRow {
  id: string; title: string; image: string | null; status: string; featured: boolean; tags: string; category: string;
  brand: string; variants: number; sizes: string; conditions: string; stock: number; reserved: number;
  price: number | null; price_label: string; cost?: number | null; margin?: number | null; views: number;
  conversion: number | null; days_listed: number; low_stock: boolean;
}

export interface ProductFilters {
  q?: string; category?: string; brand?: string; status?: string; condition?: string; stock?: string; age?: string;
}

export async function listProducts(admin: AdminUser, f: ProductFilters): Promise<ProductListRow[]> {
  let query = db()
    .from("products")
    .select(`id, title, status, featured, tags, created_at, listed_at, category_id, brand_id,
             categories(name), brands(name), product_images(path, is_cover, position),
             product_variants(id, size, condition, price, cost_price, quantity, reserved_quantity, low_stock_threshold, status, sku)`)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (f.status) query = query.eq("status", f.status);
  else query = query.neq("status", "archived");
  if (f.category) query = query.eq("category_id", f.category);
  if (f.brand) query = query.eq("brand_id", f.brand);
  if (f.q) query = query.ilike("title", `%${f.q}%`);
  const products = must(await query, "products") as unknown as {
    id: string; title: string; status: string; featured: boolean; tags: string[]; created_at: string; listed_at: string | null;
    categories: { name: string } | null; brands: { name: string } | null;
    product_images: { path: string; is_cover: boolean; position: number }[]; product_variants: VariantRow[];
  }[];

  const now = new Date();
  const stats = await rpc<{ product_id: string; views: number; conversion: number | null }[]>("admin_product_stats", {
    p_from: iso(new Date(now.getTime() - 30 * 86_400_000)), p_to: iso(now),
  });
  const statMap = new Map(stats.map((s) => [s.product_id, s]));

  let rows: ProductListRow[] = products.map((p) => {
    const vs = p.product_variants.filter((v) => v.status !== "archived");
    const stock = vs.reduce((a, v) => a + v.quantity, 0);
    const reserved = vs.reduce((a, v) => a + v.reserved_quantity, 0);
    const prices = vs.map((v) => Number(v.price));
    const minP = prices.length ? Math.min(...prices) : null;
    const maxP = prices.length ? Math.max(...prices) : null;
    const units = vs.reduce((a, v) => a + v.quantity + v.reserved_quantity, 0);
    const avgCost = units > 0
      ? vs.reduce((a, v) => a + Number(v.cost_price) * (v.quantity + v.reserved_quantity), 0) / units
      : vs.length ? vs.reduce((a, v) => a + Number(v.cost_price), 0) / vs.length : null;
    const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    const cover = [...p.product_images].sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.position - b.position)[0];
    const s = statMap.get(p.id);
    const listed = p.listed_at ?? p.created_at;
    return {
      id: p.id,
      title: p.title,
      image: imageUrl(cover?.path),
      status: p.status,
      featured: p.featured,
      tags: p.tags.join(", "),
      category: p.categories?.name ?? "",
      brand: p.brands?.name ?? "",
      variants: vs.length,
      sizes: [...new Set(vs.map((v) => v.size).filter(Boolean))].join(", "),
      conditions: [...new Set(vs.map((v) => v.condition))].join(","),
      stock,
      reserved,
      price: minP,
      price_label: minP == null ? "—" : minP === maxP ? "" : `up to ${maxP}`,
      cost: avgCost == null ? null : Math.round(avgCost * 100) / 100,
      margin: avgCost != null && avgPrice ? (avgPrice - avgCost) / avgPrice : null,
      views: Number(s?.views ?? 0),
      conversion: s?.conversion != null ? Number(s.conversion) : null,
      days_listed: Math.floor((now.getTime() - new Date(listed).getTime()) / 86_400_000),
      low_stock: vs.some((v) => v.status === "active" && v.low_stock_threshold > 1 && v.quantity <= v.low_stock_threshold),
    };
  });

  if (f.condition) rows = rows.filter((r) => r.conditions.split(",").includes(f.condition!));
  if (f.stock === "in") rows = rows.filter((r) => r.stock > 0);
  if (f.stock === "out") rows = rows.filter((r) => r.stock === 0);
  if (f.stock === "low") rows = rows.filter((r) => r.low_stock);
  if (f.age) rows = rows.filter((r) => r.days_listed >= Number(f.age) && r.stock > 0);

  return redact(admin, rows);
}

export interface ProductDetail {
  id: string; title: string; slug: string; description: string | null; category_id: string | null; brand_id: string | null;
  status: string; tags: string[]; featured: boolean; allow_offers: boolean; offer_floor_price: number | null;
  seo_title: string | null; seo_description: string | null; authenticity_notes: string | null; publish_at: string | null;
  drop_id: string | null; listed_at: string | null; created_at: string;
  images: { id: string; path: string; url: string; position: number; is_cover: boolean }[];
  variants: (VariantRow & { position: number })[];
}

export async function getProduct(admin: AdminUser, id: string): Promise<ProductDetail | null> {
  const res = await db()
    .from("products")
    .select(`*, product_images(id, path, position, is_cover),
             product_variants(id, size, condition, sku, price, cost_price, quantity, reserved_quantity, low_stock_threshold, status, position)`)
    .eq("id", id)
    .maybeSingle();
  const p = must(res, "product") as (Omit<ProductDetail, "images" | "variants"> & {
    product_images: { id: string; path: string; position: number; is_cover: boolean }[];
    product_variants: ProductDetail["variants"];
  }) | null;
  if (!p) return null;
  const { product_images, product_variants, ...rest } = p;
  return redact(admin, {
    ...rest,
    images: [...product_images].sort((a, b) => a.position - b.position).map((i) => ({ ...i, url: imageUrl(i.path)! })),
    variants: [...product_variants].sort((a, b) => a.position - b.position),
  });
}
