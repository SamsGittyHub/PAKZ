import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { facets, filterProducts, getCatalog, type ShopFilters } from "@/lib/shop/catalog";
import { ProductGrid } from "@/components/shop/ProductCard";
import { ShopFilterBar } from "@/components/shop/ShopFilterBar";
import { TrackSearch } from "@/components/shop/Tracking";
import { WaitlistForm } from "@/components/shop/WaitlistForm";

export const metadata: Metadata = { title: "Shop", description: "Authenticated resale sneakers and streetwear." };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function ShopPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <Suspense fallback={<div className="h-96" aria-busy="true" />}>
        <Listing searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Listing({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await connection();
  const num = (v?: string) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const f: ShopFilters = {
    q: one(sp.q)?.slice(0, 100), category: one(sp.category), brand: one(sp.brand), size: one(sp.size), condition: one(sp.condition),
    min: num(one(sp.min)), max: num(one(sp.max)), sort: (one(sp.sort) as ShopFilters["sort"]) ?? "new", sold: one(sp.sold) === "1",
  };
  const all = await getCatalog();
  const results = filterProducts(all, f);
  const fx = facets(all);
  const heading = f.q ? `“${f.q}”` : fx.categories.find((c) => c.slug === f.category)?.name ?? fx.brands.find((b) => b.slug === f.brand)?.name ?? "Shop all";

  return (
    <>
      <h1 className="shop-display mb-1 text-5xl sm:text-7xl">{heading}</h1>
      <p className="mb-6 text-sm text-[var(--ink-2)]">{results.length} {results.length === 1 ? "item" : "items"}</p>
      <ShopFilterBar facets={fx} />
      {f.q && <TrackSearch query={f.q} results={results.length} />}
      {results.length ? <ProductGrid products={results} /> : (
        <div className="max-w-lg py-10">
          <p className="text-lg font-semibold">Nothing matching that right now.</p>
          <p className="mt-1 text-[var(--ink-2)]">Stock changes daily. Leave your email and we&apos;ll tell you when {f.q ? `“${f.q}”` : "it"} lands.</p>
          <div className="mt-4"><WaitlistForm keyword={f.q ?? ""} brand={fx.brands.find((b) => b.slug === f.brand)?.name} /></div>
        </div>
      )}
    </>
  );
}
