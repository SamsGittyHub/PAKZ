import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { pageContext, one, type SearchParams } from "@/lib/admin/context";
import { CHANNELS, ORDER_STATUSES, listOrders } from "@/lib/admin/orders";
import { fmt } from "@/lib/format";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { FilterBar } from "@/components/admin/FilterBar";
import { DataTable } from "@/components/admin/DataTable";

export default function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Suspense fallback={<PageSkeleton />}><Orders searchParams={searchParams} /></Suspense>;
}

async function Orders({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { admin, params } = await pageContext(searchParams);
  const rows = await listOrders(admin, { status: one(params.status), channel: one(params.channel) });
  return (
    <>
      <PageHeader
        title="Orders"
        description={`${rows.length} orders`}
        actions={<>
          <a className="btn" href={`/api/admin/export?dataset=orders${one(params.status) ? `&status=${one(params.status)}` : ""}`}>Export</a>
          <Link className="btn btn-primary" href="/admin/orders/new"><Plus size={14} /> Record sale</Link>
        </>}
      />
      <Section>
        <FilterBar filters={[
          { key: "status", label: "Status", options: ORDER_STATUSES.map((s) => ({ value: s, label: fmt.label(s) })) },
          { key: "channel", label: "Channel", options: CHANNELS.map((c) => ({ value: c, label: fmt.label(c) })) },
        ]} />
        <DataTable
          data={rows}
          filename="orders"
          initialSort={{ key: "paid_at", desc: true }}
          columns={[
            { key: "number", header: "Order", href: "/admin/orders/{id}" },
            { key: "paid_at", header: "Date", type: "datetime" },
            { key: "customer", header: "Customer", sub: "email" },
            { key: "channel", header: "Channel", type: "label", hideMobile: true },
            { key: "items", header: "Items", type: "num", hideMobile: true },
            { key: "total", header: "Total", type: "money2" },
            { key: "status", header: "Status", type: "badge" },
            { key: "waiting_hours", header: "Waiting (h)", type: "num", hideMobile: true, warnAtOrBelow: -1 },
          ]}
        />
      </Section>
    </>
  );
}
