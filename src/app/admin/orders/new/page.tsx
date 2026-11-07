import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { PageHeader, PageSkeleton } from "@/components/admin/PageHeader";
import { ManualSaleForm } from "./ManualSaleForm";

export default function NewSalePage() {
  return <Suspense fallback={<PageSkeleton />}><Page /></Suspense>;
}

async function Page() {
  const admin = await requireAdmin();
  return (
    <>
      <PageHeader title="Record a sale" description="In-person, Instagram DM, Vinted, eBay, Depop — every sale in one place. Stock and cost of goods update automatically." />
      <ManualSaleForm canSeeCosts={admin.canSeeCosts} />
    </>
  );
}
