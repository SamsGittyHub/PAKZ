import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { db, must } from "@/lib/supabase/admin";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { DropsManager } from "./DropsManager";

export default function DropsPage() {
  return <Suspense fallback={<PageSkeleton />}><Drops /></Suspense>;
}

async function Drops() {
  await requireAdmin();
  const [drops, raffles, products] = await Promise.all([
    db().from("drops").select("*, products(id)").order("created_at", { ascending: false }),
    db().from("raffles").select("*, raffle_entries(id, email, is_winner), products(title)").order("created_at", { ascending: false }),
    db().from("products").select("id, title").in("status", ["draft", "scheduled", "active"]).order("title").limit(1000),
  ]);
  const dropRows = (must(drops, "drops") as (Record<string, unknown> & { products: unknown[] })[]).map(({ products: p, ...d }) => ({ ...d, listings: p.length }));
  const raffleRows = (must(raffles, "raffles") as (Record<string, unknown> & { raffle_entries: { email: string; is_winner: boolean }[]; products: { title: string } | null })[])
    .map(({ raffle_entries, products: p, ...r }) => ({ ...r, product: p?.title ?? "", entries: raffle_entries.length, winner: raffle_entries.find((e) => e.is_winner)?.email ?? "" }));
  return (
    <>
      <PageHeader title="Drops & raffles" />
      <DropsManager drops={dropRows} raffles={raffleRows} products={must(products, "products")} />
      <Section className="mt-4"><p className="faint text-xs">Setting a drop to <b>Live</b> publishes its draft/scheduled listings. Listings are assigned to a drop from the listing form.</p></Section>
    </>
  );
}
