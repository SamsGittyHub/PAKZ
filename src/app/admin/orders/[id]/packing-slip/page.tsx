import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getOrder } from "@/lib/admin/orders";
import { getSettings } from "@/lib/admin/context";
import { fmt } from "@/lib/format";
import { PrintButton } from "./PrintButton";

export default function PackingSlipPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={null}><Slip params={params} /></Suspense>;
}

async function Slip({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const [o, settings] = await Promise.all([getOrder(admin, id), getSettings()]);
  if (!o) notFound();
  const a = o.shipping_address ?? {};
  return (
    <div className="mx-auto max-w-2xl bg-white p-8 text-black print:p-0">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">{settings.store_name}</h1>
          <p className="text-sm">Packing slip · Order #{o.number} · {fmt.date(o.paid_at ?? o.created_at)}</p>
        </div>
        <PrintButton />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-6 text-sm">
        <div>
          <h2 className="mb-1 font-semibold">Ship to</h2>
          <p className="whitespace-pre-line">{[a.name ?? o.customers?.name, a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean).join("\n") || "—"}</p>
        </div>
        <div>
          <h2 className="mb-1 font-semibold">Customer</h2>
          <p>{o.customers?.name}<br />{o.customers?.email}<br />{o.customers?.phone}</p>
        </div>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-b border-black"><th className="py-1 text-left">Item</th><th className="py-1 text-left">Size</th><th className="py-1 text-left">Condition</th><th className="py-1 text-right">Qty</th></tr></thead>
        <tbody>
          {o.order_items.map((i) => (
            <tr key={i.id} className="border-b border-neutral-300">
              <td className="py-2">{i.title}</td><td>{i.size ?? "—"}</td><td>{fmt.label(i.condition)}</td><td className="text-right">{i.quantity - i.refunded_qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-8 text-center text-sm">Thanks for shopping with {settings.store_name}. Questions? {settings.contact_email}</p>
    </div>
  );
}
