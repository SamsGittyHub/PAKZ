import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { rpc } from "@/lib/supabase/admin";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { KpiCard } from "@/components/admin/KpiCard";
import { DataTable } from "@/components/admin/DataTable";

export default function CustomersPage() {
  return <Suspense fallback={<PageSkeleton />}><Customers /></Suspense>;
}

async function Customers() {
  await requireAdmin();
  const rows = await rpc<{ id: string; orders: number; lifetime_value: number; is_repeat: boolean }[]>("admin_customers", { p_search: null, p_limit: 5000 });
  const buyers = rows.filter((r) => r.orders > 0);
  const repeat = buyers.filter((r) => r.is_repeat).length;
  const ltv = buyers.reduce((a, r) => a + Number(r.lifetime_value), 0);
  return (
    <>
      <PageHeader title="Customers" description={`${rows.length} customers`} actions={<a className="btn" href="/api/admin/export?dataset=customers">Export</a>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Buyers" value={buyers.length} compare={false} />
        <KpiCard label="Repeat buyers" value={repeat} compare={false} hint={buyers.length ? `${Math.round((repeat / buyers.length) * 100)}% of buyers` : undefined} />
        <KpiCard label="Avg lifetime value" value={buyers.length ? ltv / buyers.length : 0} kind="money" compare={false} />
        <KpiCard label="Total lifetime value" value={ltv} kind="money" compare={false} />
      </div>
      <Section>
        <DataTable
          data={rows}
          filename="customers"
          initialSort={{ key: "lifetime_value", desc: true }}
          columns={[
            { key: "name", header: "Name", sub: "email" },
            { key: "instagram_handle", header: "Instagram", hideMobile: true },
            { key: "orders", header: "Orders", type: "num" },
            { key: "lifetime_value", header: "Lifetime value", type: "money" },
            { key: "last_order", header: "Last order", type: "date", hideMobile: true },
            { key: "is_repeat", header: "Repeat", type: "bool" },
            { key: "marketing_opt_in", header: "Opted in", type: "bool", hideMobile: true },
          ]}
        />
      </Section>
    </>
  );
}
