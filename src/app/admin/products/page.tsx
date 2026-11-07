import { Suspense } from "react";
import Link from "next/link";
import { Camera, Download, Plus } from "lucide-react";
import { pageContext, one, type SearchParams } from "@/lib/admin/context";
import { getLookups, listProducts, CONDITIONS, STATUSES } from "@/lib/admin/products";
import { fmt } from "@/lib/format";
import { PageHeader, PageSkeleton } from "@/components/admin/PageHeader";
import { FilterBar } from "@/components/admin/FilterBar";
import { ProductsTable } from "./ProductsTable";
import { ImportButton } from "./ImportButton";

export default function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Suspense fallback={<PageSkeleton />}><Products searchParams={searchParams} /></Suspense>;
}

async function Products({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { admin, params } = await pageContext(searchParams);
  const [lookups, rows] = await Promise.all([
    getLookups(),
    listProducts(admin, {
      q: one(params.q), category: one(params.category), brand: one(params.brand), status: one(params.status),
      condition: one(params.condition), stock: one(params.stock), age: one(params.age),
    }),
  ]);
  return (
    <>
      <PageHeader
        title="Products"
        description={`${rows.length} listings`}
        actions={<>
          <ImportButton />
          <a className="btn" href="/api/admin/export?dataset=products"><Download size={14} /> Export</a>
          <Link className="btn" href="/admin/products/quick-add"><Camera size={14} /> Quick add</Link>
          <Link className="btn btn-primary" href="/admin/products/new"><Plus size={14} /> New listing</Link>
        </>}
      />
      <div className="card card-pad">
        <FilterBar
          search="q"
          filters={[
            { key: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: fmt.label(s) })) },
            { key: "category", label: "Category", options: lookups.categories.map((c) => ({ value: c.id, label: c.name })) },
            { key: "brand", label: "Brand", options: lookups.brands.map((b) => ({ value: b.id, label: b.name })) },
            { key: "condition", label: "Condition", options: CONDITIONS.map((c) => ({ value: c, label: fmt.label(c) })) },
            { key: "stock", label: "Stock", options: [{ value: "in", label: "In stock" }, { value: "low", label: "Low stock" }, { value: "out", label: "Out of stock" }] },
            { key: "age", label: "Age", options: [{ value: "30", label: "30+ days" }, { value: "60", label: "60+ days" }, { value: "90", label: "90+ days" }] },
          ]}
        />
        <ProductsTable rows={rows} canSeeCosts={admin.canSeeCosts} />
      </div>
    </>
  );
}
