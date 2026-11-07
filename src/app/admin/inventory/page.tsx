import { Suspense } from "react";
import Link from "next/link";
import { pageContext, one, type SearchParams } from "@/lib/admin/context";
import { getAging, getMovements, getStock, getValuation } from "@/lib/admin/inventory";
import { getInventoryValue } from "@/lib/admin/overview";
import { fmt } from "@/lib/format";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { KpiCard } from "@/components/admin/KpiCard";
import { DataTable } from "@/components/admin/DataTable";
import { StockTable } from "./StockTable";

const TABS = [
  { key: "stock", label: "Stock" },
  { key: "aging", label: "Aging" },
  { key: "valuation", label: "Valuation" },
  { key: "movements", label: "Movements" },
];

export default function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Suspense fallback={<PageSkeleton />}><Inventory searchParams={searchParams} /></Suspense>;
}

async function Inventory({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { admin, params } = await pageContext(searchParams);
  const tab = one(params.tab) ?? "stock";
  const filter = one(params.filter);
  const product = one(params.product);
  const value = await getInventoryValue();

  return (
    <>
      <PageHeader title="Inventory" description={`${fmt.num(value.units)} units across ${fmt.num(value.skus)} SKUs`} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {admin.canSeeCosts && <KpiCard label="Value at cost" value={value.at_cost} kind="money" compare={false} />}
        <KpiCard label="Value at retail" value={value.at_retail} kind="money" compare={false} />
        {admin.canSeeCosts && <KpiCard label="Potential profit" value={value.potential_profit} kind="money" compare={false} />}
        <KpiCard label="Units on hand" value={value.units} compare={false} />
      </div>
      <nav className="mb-3 flex gap-1 overflow-x-auto" aria-label="Inventory views">
        {TABS.filter((t) => t.key !== "valuation" || admin.canSeeCosts).map((t) => (
          <Link key={t.key} href={`/admin/inventory?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined}
            className={`btn btn-sm ${tab === t.key ? "btn-primary" : ""}`}>{t.label}</Link>
        ))}
      </nav>
      {tab === "stock" && <StockView admin={admin} filter={filter} product={product} />}
      {tab === "aging" && <AgingView admin={admin} />}
      {tab === "valuation" && admin.canSeeCosts && <ValuationView />}
      {tab === "movements" && <MovementsView admin={admin} />}
    </>
  );
}

async function StockView({ admin, filter, product }: { admin: Awaited<ReturnType<typeof pageContext>>["admin"]; filter?: string; product?: string }) {
  let rows = await getStock(admin, product && /^[0-9a-f-]{36}$/i.test(product) ? product : undefined);
  if (filter === "low") rows = rows.filter((r) => r.is_low);
  if (filter === "reserved") rows = rows.filter((r) => Number(r.reserved_quantity) > 0);
  if (filter === "out") rows = rows.filter((r) => Number(r.quantity) === 0);
  if (!filter && !product) rows = rows.filter((r) => r.product_status !== "sold" || Number(r.quantity) > 0);
  return (
    <Section>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {[["", "In stock"], ["low", "Low stock"], ["reserved", "Reserved"], ["out", "Out of stock"]].map(([v, l]) => (
          <Link key={v} href={`/admin/inventory?tab=stock${v ? `&filter=${v}` : ""}`} className={`badge ${filter === v || (!filter && !v) ? "!border-[var(--ink)] !text-[var(--ink)]" : ""}`}>{l}</Link>
        ))}
        {product && <span className="badge">Filtered to one product · <Link href="/admin/inventory" className="underline">clear</Link></span>}
      </div>
      <StockTable rows={rows} canSeeCosts={admin.canSeeCosts} />
    </Section>
  );
}

async function AgingView({ admin }: { admin: Awaited<ReturnType<typeof pageContext>>["admin"] }) {
  const rows = await getAging(admin);
  const buckets = ["30-59", "60-89", "90+"].map((b) => ({ b, n: rows.filter((r) => r.bucket === b).length }));
  return (
    <Section title="Unsold 30+ days" actions={<span className="faint text-xs">{buckets.map((x) => `${x.b}d: ${x.n}`).join(" · ")}</span>}>
      <p className="faint mb-3 text-xs">Suggested markdowns: 10% at 30 days, 15% at 60, 25% at 90+ — never below cost + 5%.</p>
      <DataTable
        data={rows}
        filename="aging-report"
        rowKey="variant_id"
        initialSort={{ key: "days_listed", desc: true }}
        columns={[
          { key: "title", header: "Product", href: "/admin/products/{product_id}", sub: "brand" },
          { key: "size", header: "Size" },
          { key: "days_listed", header: "Days listed", type: "num" },
          { key: "bucket", header: "Bucket", type: "badge" },
          { key: "views_30d", header: "Views 30d", type: "num", hideMobile: true },
          { key: "quantity", header: "Qty", type: "num", hideMobile: true },
          { key: "price", header: "Price", type: "money" },
          ...(admin.canSeeCosts ? [{ key: "cost_price", header: "Cost", type: "money" as const, hideMobile: true }] : []),
          { key: "suggested_markdown_pct", header: "Markdown", type: "num" },
          { key: "suggested_price", header: "Suggested", type: "money" },
        ]}
      />
    </Section>
  );
}

async function ValuationView() {
  const rows = await getValuation();
  return (
    <Section title="Valuation by category">
      <DataTable
        data={rows}
        rowKey="category"
        filename="inventory-valuation"
        searchable={false}
        columns={[
          { key: "category", header: "Category" },
          { key: "units", header: "Units", type: "num" },
          { key: "skus", header: "SKUs", type: "num", hideMobile: true },
          { key: "at_cost", header: "At cost", type: "money" },
          { key: "at_retail", header: "At retail", type: "money" },
          { key: "potential_profit", header: "Potential profit", type: "money" },
        ]}
      />
    </Section>
  );
}

async function MovementsView({ admin }: { admin: Awaited<ReturnType<typeof pageContext>>["admin"] }) {
  const rows = await getMovements(admin, { limit: 500 });
  return (
    <Section title="Recent stock movements">
      <DataTable
        data={rows}
        filename="inventory-movements"
        columns={[
          { key: "created_at", header: "When", type: "datetime" },
          { key: "title", header: "Product", href: "/admin/inventory/{variant_id}", sub: "size" },
          { key: "change", header: "Change", type: "num" },
          { key: "reason", header: "Reason", type: "badge" },
          { key: "quantity_after", header: "After", type: "num", hideMobile: true },
          { key: "note", header: "Note", hideMobile: true },
          { key: "by", header: "By", hideMobile: true },
        ]}
      />
    </Section>
  );
}
