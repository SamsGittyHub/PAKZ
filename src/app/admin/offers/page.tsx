import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { db, must } from "@/lib/supabase/admin";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { OffersInbox } from "./OffersInbox";

export default function OffersPage() {
  return <Suspense fallback={<PageSkeleton />}><Offers /></Suspense>;
}

async function Offers() {
  await requireAdmin();
  const rows = must(
    await db().from("offers").select("id, amount, counter_amount, email, message, status, created_at, product_id, products(title, offer_floor_price, product_variants(price))").order("created_at", { ascending: false }).limit(500),
    "offers",
  ) as unknown as { id: string; amount: number; counter_amount: number | null; email: string; message: string | null; status: string; created_at: string; product_id: string; products: { title: string; offer_floor_price: number | null; product_variants: { price: number }[] } | null }[];
  const data = rows.map((o) => {
    const list = o.products?.product_variants.length ? Math.min(...o.products.product_variants.map((v) => Number(v.price))) : null;
    return {
      id: o.id, title: o.products?.title ?? "—", product_id: o.product_id, email: o.email, amount: Number(o.amount), list_price: list,
      pct_of_list: list ? Number(o.amount) / list : null, counter_amount: o.counter_amount, status: o.status, created_at: o.created_at, message: o.message,
    };
  });
  const pending = data.filter((o) => o.status === "pending");
  return (
    <>
      <PageHeader title="Offers" description={`${pending.length} pending · offers below a listing's floor price are auto-declined`} />
      <Section><OffersInbox rows={data} /></Section>
    </>
  );
}
