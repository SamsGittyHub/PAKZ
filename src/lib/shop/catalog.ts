import "server-only";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { db, must } from "@/lib/db";
import { imageUrl } from "@/lib/storage";

/**
 * Public catalogue reads. Cached (tag "catalog") and invalidated on every stock/listing change, so pages are
 * fast without serving sold items for long; checkout re-checks stock live regardless.
 * Selects only public columns — never cost_price, offer floors or internal notes.
 */
export const CATALOG_TAG = "catalog";

/** Call after anything that changes listings, prices, images or stock. */
export function invalidateCatalog() {
  revalidateTag(CATALOG_TAG, { expire: 0 });
}

export interface ShopVariant { id: string; size: string | null; condition: string; price: number; available: number }
export interface ShopProduct {
  id: string; slug: string; title: string; brand: string; brandSlug: string; category: string; categorySlug: string;
  description: string | null; authenticity: string | null; seoTitle: string | null; seoDescription: string | null;
  tags: string[]; featured: boolean; allowOffers: boolean; status: "active" | "sold"; listedAt: string; dropId: string | null;
  images: string[]; variants: ShopVariant[];
  /** derived */
  price: number; available: boolean; sizes: string[]; conditions: string[];
}

interface Row {
  id: string; slug: string; title: string; status: "active" | "sold"; description: string | null; authenticity_notes: string | null;
  seo_title: string | null; seo_description: string | null; tags: string[]; featured: boolean; allow_offers: boolean;
  listed_at: string | null; created_at: string; sold_at: string | null; drop_id: string | null;
  categories: { name: string; slug: string } | null; brands: { name: string; slug: string } | null;
  product_images: { path: string; position: number; is_cover: boolean }[];
  product_variants: { id: string; size: string | null; condition: string; price: number; quantity: number; status: string; position: number }[];
}

const SELECT = `id, slug, title, status, description, authenticity_notes, seo_title, seo_description, tags, featured,
  allow_offers, listed_at, created_at, sold_at, drop_id, categories(name, slug), brands(name, slug),
  product_images(path, position, is_cover), product_variants(id, size, condition, price, quantity, status, position)`;

function toProduct(r: Row): ShopProduct {
  const variants = r.product_variants
    .filter((v) => v.status === "active" || v.status === "sold_out")
    .sort((a, b) => a.position - b.position)
    .map((v) => ({ id: v.id, size: v.size, condition: v.condition, price: Number(v.price), available: v.status === "active" ? v.quantity : 0 }));
  const inStock = variants.filter((v) => v.available > 0);
  const priced = inStock.length ? inStock : variants;
  const images = [...r.product_images]
    .sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.position - b.position)
    .map((i) => imageUrl(i.path)!);
  return {
    id: r.id, slug: r.slug, title: r.title, status: r.status,
    brand: r.brands?.name ?? "", brandSlug: r.brands?.slug ?? "", category: r.categories?.name ?? "", categorySlug: r.categories?.slug ?? "",
    description: r.description, authenticity: r.authenticity_notes, seoTitle: r.seo_title, seoDescription: r.seo_description,
    tags: r.tags, featured: r.featured, allowOffers: r.allow_offers, listedAt: r.listed_at ?? r.created_at, dropId: r.drop_id,
    images, variants,
    price: priced.length ? Math.min(...priced.map((v) => v.price)) : 0,
    available: r.status === "active" && inStock.length > 0,
    sizes: sortSizes([...new Set(inStock.map((v) => v.size).filter(Boolean) as string[])]),
    conditions: [...new Set(inStock.map((v) => v.condition))],
  };
}

/** Everything listable: active products plus items sold in the last 60 days (shown as "Sold"). */
export async function getCatalog(): Promise<ShopProduct[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const rows = must(
    await db().from("products").select(SELECT)
      .or(`status.eq.active,and(status.eq.sold,sold_at.gte.${since})`)
      .order("listed_at", { ascending: false, nullsFirst: false })
      .limit(5000),
    "catalog",
  ) as unknown as Row[];
  return rows.map(toProduct).filter((p) => p.variants.length > 0);
}

export async function getProduct(slug: string): Promise<ShopProduct | null> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");
  const row = must(await db().from("products").select(SELECT).eq("slug", slug).in("status", ["active", "sold"]).maybeSingle(), "product") as unknown as Row | null;
  return row ? toProduct(row) : null;
}

export interface ShopDrop {
  id: string; name: string; description: string | null; status: string; startsAt: string | null; endsAt: string | null;
  raffles: { id: string; name: string; status: string; startsAt: string | null; endsAt: string | null; productSlug: string | null; productTitle: string | null; sizes: string[] }[];
}

export async function getDrops(): Promise<ShopDrop[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");
  const drops = must(await db().from("drops").select("id, name, description, status, starts_at, ends_at").in("status", ["scheduled", "live"]).order("starts_at", { ascending: true, nullsFirst: false }), "drops");
  const raffles = must(
    await db().from("raffles").select("id, name, status, starts_at, ends_at, drop_id, products(slug, title, product_variants(size, status))").eq("status", "open").order("ends_at", { ascending: true, nullsFirst: false }),
    "raffles",
  ) as unknown as { id: string; name: string; status: string; starts_at: string | null; ends_at: string | null; drop_id: string | null; products: { slug: string; title: string; product_variants: { size: string | null; status: string }[] } | null }[];
  const mapRaffle = (r: (typeof raffles)[number]) => ({
    id: r.id, name: r.name, status: r.status, startsAt: r.starts_at, endsAt: r.ends_at,
    productSlug: r.products?.slug ?? null, productTitle: r.products?.title ?? null,
    sizes: sortSizes([...new Set((r.products?.product_variants ?? []).filter((v) => v.status !== "archived").map((v) => v.size).filter(Boolean) as string[])]),
  });
  const out: ShopDrop[] = drops.map((d) => ({
    id: d.id, name: d.name, description: d.description, status: d.status, startsAt: d.starts_at, endsAt: d.ends_at,
    raffles: raffles.filter((r) => r.drop_id === d.id).map(mapRaffle),
  }));
  const loose = raffles.filter((r) => !r.drop_id || !drops.some((d) => d.id === r.drop_id));
  if (loose.length) out.push({ id: "raffles", name: "Open raffles", description: null, status: "live", startsAt: null, endsAt: null, raffles: loose.map(mapRaffle) });
  return out;
}

export async function getShippingRates(): Promise<{ name: string; price: number; free_over?: number }[]> {
  "use cache";
  cacheTag("settings");
  cacheLife("hours");
  const { data } = await db().from("store_settings").select("shipping_rates").eq("id", 1).single();
  return (data?.shipping_rates as { name: string; price: number; free_over?: number }[]) ?? [];
}

// ---------------------------------------------------------------------------
// Filtering (pure, runs on the cached list)
// ---------------------------------------------------------------------------
const APPAREL = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
export function sortSizes(sizes: string[]): string[] {
  const key = (s: string) => {
    const a = APPAREL.indexOf(s.toUpperCase());
    if (a >= 0) return [0, a];
    const n = parseFloat(s.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? [1, n] : [2, 0];
  };
  return [...sizes].sort((x, y) => {
    const [a1, a2] = key(x), [b1, b2] = key(y);
    return a1 - b1 || a2 - b2 || x.localeCompare(y);
  });
}

export interface ShopFilters {
  q?: string; category?: string; brand?: string; size?: string; condition?: string;
  min?: number; max?: number; sort?: "new" | "price_asc" | "price_desc"; sold?: boolean;
}

export function filterProducts(all: ShopProduct[], f: ShopFilters): ShopProduct[] {
  const q = f.q?.trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  let list = all.filter((p) => (f.sold ? true : p.available));
  if (terms.length) {
    list = list.filter((p) => {
      const hay = `${p.title} ${p.brand} ${p.category} ${p.tags.join(" ")}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  if (f.category) list = list.filter((p) => p.categorySlug === f.category);
  if (f.brand) list = list.filter((p) => p.brandSlug === f.brand);
  if (f.size) list = list.filter((p) => p.sizes.includes(f.size!));
  if (f.condition) list = list.filter((p) => p.conditions.includes(f.condition!));
  if (f.min != null) list = list.filter((p) => p.price >= f.min!);
  if (f.max != null) list = list.filter((p) => p.price <= f.max!);
  const sorted = [...list];
  if (f.sort === "price_asc") sorted.sort((a, b) => a.price - b.price);
  else if (f.sort === "price_desc") sorted.sort((a, b) => b.price - a.price);
  else sorted.sort((a, b) => Number(b.available) - Number(a.available) || b.listedAt.localeCompare(a.listedAt));
  return sorted;
}

export function facets(all: ShopProduct[]) {
  const avail = all.filter((p) => p.available);
  const uniq = <T,>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];
  return {
    categories: uniq(avail.filter((p) => p.categorySlug), (p) => p.categorySlug).map((p) => ({ slug: p.categorySlug, name: p.category })).sort((a, b) => a.name.localeCompare(b.name)),
    brands: uniq(avail.filter((p) => p.brandSlug), (p) => p.brandSlug).map((p) => ({ slug: p.brandSlug, name: p.brand })).sort((a, b) => a.name.localeCompare(b.name)),
    sizes: sortSizes([...new Set(avail.flatMap((p) => p.sizes))]),
  };
}
