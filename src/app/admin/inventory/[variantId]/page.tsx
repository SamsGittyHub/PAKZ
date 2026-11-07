import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getMovements, getVariant } from "@/lib/admin/inventory";
import { fmt } from "@/lib/format";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { DataTable } from "@/components/admin/DataTable";

export default function VariantHistoryPage({ params }: { params: Promise<{ variantId: string }> }) {
  return <Suspense fallback={<PageSkeleton />}><History params={params} /></Suspense>;
}

async function History({ params }: { params: Promise<{ variantId: string }> }) {
  const admin = await requireAdmin();
  const { variantId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(variantId)) notFound();
  const [res, movements] = await Promise.all([getVariant(admin, variantId), getMovements(admin, { variantId, limit: 1000 })]);
  if (!res) notFound();
  const v = res.variant as Record<string, unknown> & { products: { id: string; title: string } };
  return (
    <>
      <PageHeader
        title={`${v.products.title}${v.size ? ` · ${v.size}` : ""}`}
        description={<>{fmt.label(String(v.condition))} · {String(v.quantity)} available · {String(v.reserved_quantity)} reserved{admin.canSeeCosts ? ` · avg cost ${fmt.money2(v.cost_price as number)}` : ""} · <Link className="underline" href={`/admin/products/${v.products.id}`}>Edit listing</Link></>}
      />
      <Section title="Audit history">
        <DataTable
          data={movements}
          filename={`movements-${variantId}`}
          columns={[
            { key: "created_at", header: "When", type: "datetime" },
            { key: "change", header: "Change", type: "num" },
            { key: "reason", header: "Reason", type: "badge" },
            { key: "quantity_after", header: "After", type: "num" },
            { key: "note", header: "Note" },
            { key: "by", header: "By" },
            { key: "order_id", header: "Order", href: "/admin/orders/{order_id}", hideMobile: true },
          ]}
        />
      </Section>
      {admin.canSeeCosts && (
        <Section title="Purchase lots" className="mt-4">
          <DataTable
            data={res.costs}
            filename={`cost-lots-${variantId}`}
            searchable={false}
            columns={[
              { key: "acquired_at", header: "Acquired", type: "date" },
              { key: "quantity", header: "Qty", type: "num" },
              { key: "purchase_price", header: "Unit price", type: "money2" },
              { key: "fees", header: "Fees", type: "money2" },
              { key: "shipping_in", header: "Shipping in", type: "money2" },
              { key: "purchase_source", header: "Source", type: "badge" },
              { key: "note", header: "Note" },
            ]}
          />
        </Section>
      )}
    </>
  );
}
