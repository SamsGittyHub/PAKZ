"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { fmt } from "@/lib/format";
import { useNotice } from "@/components/admin/Toast";
import { recordManualSale, searchVariants } from "../actions";

type Hit = { id: string; label: string; price: number; quantity: number };
type Line = Hit & { qty: number; unit_price: string };

export function ManualSaleForm({ canSeeCosts }: { canSeeCosts: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, start] = useTransition();
  const { notice, error } = useNotice();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => { searchVariants(q).then(setHits); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const subtotal = lines.reduce((a, l) => a + l.qty * Number(l.unit_price || 0), 0);

  return (
    <form className="grid gap-4 lg:grid-cols-3" action={(f) => start(async () => {
      const r = await recordManualSale({
        channel: String(f.get("channel")) as "instagram",
        paid_at: String(f.get("paid_at") || "") || undefined,
        customer: { email: String(f.get("email") ?? ""), name: String(f.get("name") ?? ""), instagram: String(f.get("instagram") ?? "") },
        items: lines.map((l) => ({ variant_id: l.id, quantity: l.qty, unit_price: l.unit_price })),
        shipping_charged: String(f.get("shipping_charged") || 0),
        shipping_cost: String(f.get("shipping_cost") || 0),
        payment_fees: String(f.get("payment_fees") || 0),
        external_ref: String(f.get("external_ref") ?? ""),
        note: String(f.get("note") ?? ""),
        mark_shipped: f.get("mark_shipped") === "on",
      });
      if (r.ok) router.push(`/admin/orders/${r.data!.id}`); else error(r.error);
    })}>
      <div className="card card-pad space-y-3 lg:col-span-2">
        <h2 className="text-sm font-semibold">Items</h2>
        <div className="relative">
          <input className="input" placeholder="Search in-stock items…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
          {q.trim().length >= 2 && hits.length > 0 && (
            <ul className="card absolute z-10 mt-1 max-h-64 w-full overflow-y-auto p-1 shadow-lg">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" className="flex w-full justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]"
                    onClick={() => { setLines((ls) => ls.some((l) => l.id === h.id) ? ls : [...ls, { ...h, qty: 1, unit_price: String(h.price) }]); setQ(""); setHits([]); }}>
                    <span>{h.label}</span><span className="faint tnum">{fmt.money(h.price)} · {h.quantity} left</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lines.length === 0 ? <p className="faint py-4 text-center text-sm">Search and add the items you sold.</p> : (
          <table className="table">
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Sold for (each)</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.label}</td>
                  <td className="num"><input type="number" min={1} max={l.quantity} value={l.qty} className="input !w-16 text-right" aria-label="Quantity"
                    onChange={(e) => setLines((ls) => ls.map((x) => x.id === l.id ? { ...x, qty: Math.min(l.quantity, Math.max(1, Number(e.target.value))) } : x))} /></td>
                  <td className="num"><input inputMode="decimal" value={l.unit_price} className="input !w-24 text-right" aria-label="Unit price"
                    onChange={(e) => setLines((ls) => ls.map((x) => x.id === l.id ? { ...x, unit_price: e.target.value } : x))} /></td>
                  <td><button type="button" className="btn btn-sm btn-ghost" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="text-right text-sm">Subtotal <b className="tnum">{fmt.money2(subtotal)}</b></div>
      </div>
      <div className="space-y-4">
        <div className="card card-pad space-y-2">
          <h2 className="text-sm font-semibold">Sale</h2>
          <select name="channel" className="input" aria-label="Channel" defaultValue="instagram">
            <option value="in_person">In person</option><option value="instagram">Instagram DM</option><option value="vinted">Vinted</option>
            <option value="ebay">eBay</option><option value="depop">Depop</option><option value="other">Other</option>
          </select>
          <input name="paid_at" type="datetime-local" className="input" aria-label="Sold at" />
          <input name="external_ref" className="input" placeholder="Marketplace order # (optional)" />
          <div className="grid grid-cols-2 gap-2">
            <input name="shipping_charged" className="input" inputMode="decimal" placeholder="Shipping charged" />
            <input name="shipping_cost" className="input" inputMode="decimal" placeholder={canSeeCosts ? "Label cost" : "Label cost"} />
            <input name="payment_fees" className="input col-span-2" inputMode="decimal" placeholder="Platform / payment fees" />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mark_shipped" /> Already shipped</label>
        </div>
        <div className="card card-pad space-y-2">
          <h2 className="text-sm font-semibold">Customer <span className="faint font-normal">(optional)</span></h2>
          <input name="name" className="input" placeholder="Name" />
          <input name="email" type="email" className="input" placeholder="Email" />
          <input name="instagram" className="input" placeholder="@instagram" />
          <textarea name="note" className="input" rows={2} placeholder="Note" />
        </div>
        <button className="btn btn-primary w-full" disabled={pending || lines.length === 0}>{pending ? "Saving…" : "Record sale"}</button>
      </div>
      {notice}
    </form>
  );
}
