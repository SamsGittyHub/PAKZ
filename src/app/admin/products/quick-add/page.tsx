import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { getLookups } from "@/lib/admin/products";
import { PageHeader, PageSkeleton } from "@/components/admin/PageHeader";
import { QuickAdd } from "./QuickAdd";

export default function QuickAddPage() {
  return <Suspense fallback={<PageSkeleton />}><Page /></Suspense>;
}

async function Page() {
  const admin = await requireAdmin();
  const { categories, brands } = await getLookups();
  return (
    <>
      <PageHeader title="Quick add" description="Snap, price, list — built for your phone." />
      <QuickAdd categories={categories} brands={brands} canSeeCosts={admin.canSeeCosts} />
    </>
  );
}
