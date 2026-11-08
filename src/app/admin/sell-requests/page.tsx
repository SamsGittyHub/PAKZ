import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { SellRequests } from "./SellRequests";

export default function SellRequestsPage() {
  return <Suspense fallback={<PageSkeleton />}><Page /></Suspense>;
}

async function Page() {
  await requireAdmin();
  const rows = must(await db().from("sell_requests").select("*").order("created_at", { ascending: false }).limit(500), "sell requests");
  return (
    <>
      <PageHeader title="Sell to us" description={`${rows.filter((r) => r.status === "new").length} new requests`} />
      <Section><SellRequests rows={rows} /></Section>
    </>
  );
}
