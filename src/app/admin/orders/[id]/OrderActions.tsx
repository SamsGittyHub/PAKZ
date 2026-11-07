"use client";
import { useState, useTransition } from "react";
import { useNotice } from "@/components/admin/Toast";
import { fmt } from "@/lib/format";
import { addOrderNote, markShipped, refundOrder, setOrderStatus } from "../actions";

const CARRIERS = ["Royal Mail", "Evri", "DPD", "UPS", "DHL", "FedEx", "Other"];

export function ShipForm({ orderId, hasEmail }: { orderId: string; hasEmail: boolean }) {
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();
  return (
    <form className="space-y-2" action={(f) => start(async () => {
      const r = await markShipped({ orderId, carrier: String(f.get("carrier")), tracking: String(f.get("tracking") ?? ""), notify: f.get("notify") === "on" });
      if (r.ok) ok(r.message ?? "Shipped"); else error(r.error);
    })}>
      <select name="carrier" className="input" aria-label="Carrier">{CARRIERS.map((c) => <option key={c}>{c}</option>)}</select>
      <input name="tracking" className="input" placeholder="Tracking number" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notify" defaultChecked={hasEmail} disabled={!hasEmail} /> Email customer</label>
      <button className="btn btn-primary w-full" disabled={pending}>Mark shipped</button>
      {notice}
    </form>
  );
}

export function StatusButtons({ orderId, status }: { orderId: string; status: string }) {
  const [pending, start] = useTransition();
  const { notice, error } = useNotice();
  const go = (s: "delivered" | "cancelled") => start(async () => { const r = await setOrderStatus(orderId, s); if (!r.ok) error(r.error); });
  return (
    <>
      {status === "shipped" && <button className="btn" disabled={pending} onClick={() => go("delivered")}>Mark delivered</button>}
      {status === "pending" && <button className="btn btn-danger" disabled={pending} onClick={() => confirm("Cancel this order?") && go("cancelled")}>Cancel</button>}
      {notice}
    </>
  );
}

export function NoteForm({ orderId }: { orderId: string }) {
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  return (
    <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addOrderNote(orderId, text); if (r.ok) setText(""); }); }}>
      <input className="input" placeholder="Add a note…" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" disabled={pending || !text.trim()}>Add</button>
    </form>
  );
}

export function RefundForm({ orderId, remaining, items, viaStripe }: {
  orderId: string; remaining: number; viaStripe: boolean; items: { id: string; title: string; max: number; price: number }[];
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [amount, setAmount] = useState("");
  const [restock, setRestock] = useState(true);
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();
  const itemsValue = items.reduce((a, i) => a + (qty[i.id] ?? 0) * i.price, 0);

  return (
    <form className="space-y-2 text-sm" onSubmit={(e) => {
      e.preventDefault();
      const amt = Number(amount || itemsValue);
      if (!confirm(`Refund ${fmt.money2(amt)}${viaStripe ? " to the customer's card via Stripe" : ""}?`)) return;
      start(async () => {
        const r = await refundOrder({
          orderId, amount: amt, restock, reason: String(new FormData(e.currentTarget).get("reason") ?? ""),
          items: Object.entries(qty).filter(([, n]) => n > 0).map(([order_item_id, quantity]) => ({ order_item_id, quantity })),
        });
        if (r.ok) ok(r.message ?? "Refunded"); else error(r.error);
      });
    }}>
      {items.map((i) => (
        <label key={i.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate">{i.title}</span>
          <input type="number" min={0} max={i.max} value={qty[i.id] ?? 0} onChange={(e) => setQty({ ...qty, [i.id]: Math.min(i.max, Math.max(0, Number(e.target.value))) })} className="input !w-16 text-right" aria-label={`Units to refund of ${i.title}`} />
        </label>
      ))}
      <div>
        <label className="label" htmlFor="ramt">Amount <span className="faint">(max {fmt.money2(remaining)})</span></label>
        <input id="ramt" className="input" inputMode="decimal" placeholder={itemsValue ? itemsValue.toFixed(2) : "0.00"} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <input name="reason" className="input" placeholder="Reason" />
      <label className="flex items-center gap-2"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Restock refunded units</label>
      <button className="btn btn-danger w-full" disabled={pending || !(Number(amount) > 0 || itemsValue > 0)}>{viaStripe ? "Refund via Stripe" : "Record refund"}</button>
      {notice}
    </form>
  );
}
