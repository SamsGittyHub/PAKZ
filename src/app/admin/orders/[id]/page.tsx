import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getOrder } from "@/lib/admin/orders";
import { fmt } from "@/lib/format";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { NoteForm, RefundForm, ShipForm, StatusButtons } from "./OrderActions";

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<PageSkeleton />}><Order params={params} /></Suspense>;
}

async function Order({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const o = await getOrder(admin, id);
  if (!o) notFound();
  const c = o.customers;
  const addr = o.shipping_address;
  const remaining = Number(o.total) - Number(o.refunded_amount);
  const profit = admin.canSeeCosts
    ? o.order_items.reduce((a, i) => a + (i.quantity - i.refunded_qty) * (Number(i.unit_price) - Number(i.unit_cost)), 0)
      + Number(o.shipping_charged) - Number(o.payment_fees) - Number(o.shipping_cost) - Number(o.tax)
    : null;

  return (
    <>
      <PageHeader
        title={`Order #${o.number}`}
        description={<>{fmt.dateTime(o.paid_at ?? o.created_at)} · {fmt.label(o.channel)} · <span className="badge">{fmt.label(o.status)}</span></>}
        actions={<>
          <Link className="btn" href={`/admin/orders/${o.id}/packing-slip`} target="_blank"><Printer size={14} /> Packing slip</Link>
          <StatusButtons orderId={o.id} status={o.status} />
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Items">
            <table className="table">
              <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th>{admin.canSeeCosts && <th className="num">Cost</th>}<th className="num">Line</th></tr></thead>
              <tbody>
                {o.order_items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product_id ? <Link className="hover:underline" href={`/admin/products/${i.product_id}`}>{i.title}</Link> : i.title}
                      <div className="faint text-xs">{[i.size, i.condition && fmt.label(i.condition)].filter(Boolean).join(" · ")}{i.refunded_qty ? ` · ${i.refunded_qty} refunded` : ""}</div></td>
                    <td className="num">{i.quantity}</td>
                    <td className="num">{fmt.money2(i.unit_price)}</td>
                    {admin.canSeeCosts && <td className="num">{fmt.money2(i.unit_cost)}</td>}
                    <td className="num">{fmt.money2(i.quantity * Number(i.unit_price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-3 ml-auto max-w-xs space-y-1 text-sm">
              {[
                ["Subtotal", o.subtotal], ["Discount", -Number(o.discount)], ["Shipping", o.shipping_charged], ["Tax", o.tax],
                ["Total", o.total], ["Refunded", -Number(o.refunded_amount)],
                ...(admin.canSeeCosts ? [["Payment fees", -Number(o.payment_fees)], ["Label cost", -Number(o.shipping_cost)]] : []),
              ].filter(([, v]) => Number(v) !== 0 || v === o.total).map(([k, v]) => (
                <div key={String(k)} className="flex justify-between"><dt className="muted">{k}</dt><dd className="tnum">{fmt.money2(v as number)}</dd></div>
              ))}
              {profit != null && <div className="flex justify-between border-t border-[var(--border)] pt-1 font-semibold"><dt>Profit</dt><dd className="tnum">{fmt.money2(profit)}</dd></div>}
            </dl>
          </Section>

          <Section title="Timeline">
            <ol className="space-y-3 border-l border-[var(--border)] pl-4">
              {o.order_events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[var(--ink-3)]" aria-hidden />
                  <div>{e.message ?? fmt.label(e.type)}</div>
                  <div className="faint text-xs">{fmt.dateTime(e.created_at)} · {fmt.label(e.type)}</div>
                </li>
              ))}
            </ol>
            <NoteForm orderId={o.id} />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Customer">
            {c ? (
              <div className="space-y-0.5 text-sm">
                <div className="font-medium">{c.name ?? "—"}</div>
                {c.email && <div><a className="underline" href={`mailto:${c.email}`}>{c.email}</a></div>}
                {c.phone && <div>{c.phone}</div>}
                {c.instagram_handle && <div>@{c.instagram_handle}</div>}
              </div>
            ) : <p className="faint text-sm">Guest / walk-in</p>}
          </Section>
          {addr && (
            <Section title="Shipping label data">
              <pre className="whitespace-pre-wrap rounded-lg bg-[var(--surface-2)] p-3 font-sans text-sm">{[addr.name ?? c?.name, addr.line1, addr.line2, addr.city, addr.state, addr.postal_code, addr.country].filter(Boolean).join("\n")}</pre>
            </Section>
          )}
          <Section title="Fulfilment">
            {o.shipped_at
              ? <p className="text-sm">Shipped {fmt.dateTime(o.shipped_at)}{o.carrier ? ` via ${o.carrier}` : ""}{o.tracking_number ? ` · ${o.tracking_number}` : ""}</p>
              : <ShipForm orderId={o.id} hasEmail={Boolean(c?.email)} />}
          </Section>
          {remaining > 0 && ["paid", "shipped", "delivered", "partially_refunded"].includes(o.status) && (
            <Section title="Refund">
              <RefundForm
                orderId={o.id}
                remaining={remaining}
                viaStripe={Boolean(o.stripe_payment_intent_id)}
                items={o.order_items.filter((i) => i.quantity > i.refunded_qty).map((i) => ({ id: i.id, title: `${i.title}${i.size ? ` (${i.size})` : ""}`, max: i.quantity - i.refunded_qty, price: Number(i.unit_price) }))}
              />
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
