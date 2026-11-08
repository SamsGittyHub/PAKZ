import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { getCatalog, getDrops } from "@/lib/shop/catalog";
import { ProductGrid } from "@/components/shop/ProductCard";
import { Countdown } from "@/components/shop/Countdown";
import { RaffleEntry } from "@/components/shop/RaffleEntry";
import { WaitlistForm } from "@/components/shop/WaitlistForm";

export const metadata: Metadata = { title: "Drops & raffles", description: "Upcoming drops and open raffles." };

export default function DropsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <h1 className="shop-display mb-8 text-5xl sm:text-7xl">Drops & raffles</h1>
      <Suspense fallback={<div className="h-64" aria-busy="true" />}><Drops /></Suspense>
    </div>
  );
}

async function Drops() {
  await connection();
  const [drops, catalog] = await Promise.all([getDrops(), getCatalog()]);
  if (!drops.length) {
    return (
      <div className="max-w-lg">
        <p className="text-lg">No drops scheduled right now.</p>
        <p className="mt-1 text-[var(--ink-2)]">Get the next one in your inbox:</p>
        <div className="mt-4"><WaitlistForm keyword="drops" cta="Sign me up" /></div>
      </div>
    );
  }
  return (
    <div className="space-y-16">
      {drops.map((d) => {
        const products = catalog.filter((p) => p.dropId === d.id && p.available);
        return (
          <section key={d.id} className="border-t-2 border-[var(--ink)] pt-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-2)]">{d.status === "live" ? "Live now" : "Coming up"}</div>
                <h2 className="shop-display mt-1 text-4xl sm:text-6xl">{d.name}</h2>
                {d.description && <p className="mt-2 max-w-2xl text-[var(--ink-2)]">{d.description}</p>}
              </div>
              {d.status === "scheduled" && d.startsAt && <Countdown to={d.startsAt} />}
            </div>
            {d.raffles.length > 0 && (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {d.raffles.map((r) => (
                  <div key={r.id} className="border border-[var(--border)] p-5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Raffle{r.endsAt ? ` · closes ${new Date(r.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: process.env.NEXT_PUBLIC_TIMEZONE ?? "Europe/London" })}` : ""}</div>
                    <h3 className="mt-1 text-lg font-semibold">{r.name}</h3>
                    {r.productSlug && <Link href={`/product/${r.productSlug}`} className="text-sm underline">{r.productTitle}</Link>}
                    <div className="mt-4"><RaffleEntry raffleId={r.id} sizes={r.sizes} /></div>
                  </div>
                ))}
              </div>
            )}
            {products.length > 0 && <div className="mt-8"><ProductGrid products={products} priorityCount={0} /></div>}
          </section>
        );
      })}
    </div>
  );
}
