import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { facets, getCatalog, getDrops } from "@/lib/shop/catalog";
import { ProductGrid } from "@/components/shop/ProductCard";
import { Countdown } from "@/components/shop/Countdown";

export default function Home() {
  return (
    <>
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-16">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-2)]">Resale · Authenticated · Ships fast</p>
          <h1 className="shop-display mt-4 text-[22vw] sm:text-[16vw] lg:text-[12rem]">Rare pairs.<br />Real ones.</h1>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/shop" className="shop-btn">Shop all <ArrowRight size={16} /></Link>
            <Link href="/sell" className="shop-btn shop-btn-outline">Sell to us</Link>
          </div>
        </div>
      </section>
      <Suspense fallback={<GridSkeleton />}>
        <HomeContent />
      </Suspense>
    </>
  );
}

async function HomeContent() {
  await connection();
  const [all, drops] = await Promise.all([getCatalog(), getDrops()]);
  const available = all.filter((p) => p.available);
  const newIn = available.slice(0, 8);
  const featured = available.filter((p) => p.featured).slice(0, 4);
  const { categories } = facets(all);
  const next = drops.find((d) => d.status === "scheduled" && d.startsAt) ?? drops.find((d) => d.status === "live");

  return (
    <div className="mx-auto max-w-7xl space-y-16 px-4 pt-12 sm:px-6">
      {next && (
        <Link href="/drops" className="block bg-[var(--ink)] p-6 text-[var(--page)] sm:p-8">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">{next.status === "live" ? "Live now" : "Next drop"}</div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div className="shop-display text-5xl sm:text-6xl">{next.name}</div>
            {next.status === "scheduled" && next.startsAt && <Countdown to={next.startsAt} />}
          </div>
        </Link>
      )}

      <section>
        <div className="mb-5 flex items-end justify-between">
          <h2 className="shop-display text-4xl sm:text-5xl">New in</h2>
          <Link href="/shop" className="text-sm font-semibold underline-offset-4 hover:underline">View all</Link>
        </div>
        {newIn.length ? <ProductGrid products={newIn} /> : <p className="text-[var(--ink-2)]">New stock lands soon — check back or follow us on Instagram.</p>}
      </section>

      {featured.length > 0 && (
        <section>
          <h2 className="shop-display mb-5 text-4xl sm:text-5xl">Grails</h2>
          <ProductGrid products={featured} priorityCount={0} />
        </section>
      )}

      {categories.length > 0 && (
        <section>
          <h2 className="shop-display mb-5 text-4xl sm:text-5xl">Shop by category</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map((c) => (
              <Link key={c.slug} href={`/shop?category=${c.slug}`} className="shop-display flex aspect-square items-end bg-[var(--surface-2)] p-4 text-2xl transition hover:bg-[var(--ink)] hover:text-[var(--page)]">{c.name}</Link>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-6 border border-[var(--border)] p-6 sm:grid-cols-[2fr_1fr] sm:items-center sm:p-10">
        <div>
          <h2 className="shop-display text-4xl sm:text-5xl">Got heat sitting in your closet?</h2>
          <p className="mt-3 max-w-xl text-[var(--ink-2)]">We buy sneakers and streetwear outright. Send photos, get an offer within 48 hours, get paid fast.</p>
        </div>
        <Link href="/sell" className="shop-btn sm:justify-self-end">Get an offer <ArrowRight size={16} /></Link>
      </section>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="mx-auto grid max-w-7xl grid-cols-2 gap-5 px-4 pt-12 sm:px-6 md:grid-cols-4" aria-busy="true">
      {Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[4/5] animate-pulse bg-[var(--surface-2)]" />)}
    </div>
  );
}
