"use client";
import { useState, useTransition } from "react";
import { Check, ClipboardPlus, X } from "lucide-react";
import { fmt } from "@/lib/format";
import { Modal, useNotice } from "@/components/admin/Toast";
import { createPurchaseTask, setRecommendationStatus } from "./actions";

const LABELS: Record<string, string> = {
  restock: "Restock now", stock_more: "Stock more", stock_less: "Stock less", reprice: "Reprice", promote: "Promote",
  clearance: "Clearance", no_supply: "High interest, no supply", best_sizes: "Best sizes",
};
const PCT_KEYS = new Set(["add_to_cart_rate", "conversion_rate", "sell_through", "margin"]);
const MONEY_KEYS = new Set(["price", "cost", "suggested_price"]);
const HIDDEN = new Set(["components", "product_id", "sizes", "direction"]);

export interface Reco { id: string; type: string; scope: string; scope_value: string; title: string; reason: string; score: number; data: Record<string, unknown>; status: string; created_at: string; href?: string }

export function RecoCard({ r }: { r: Reco }) {
  const [pending, start] = useTransition();
  const [task, setTask] = useState(false);
  const { notice, ok, error } = useNotice();
  const numbers = Object.entries(r.data).filter(([k, v]) => !HIDDEN.has(k) && v != null && typeof v !== "object");
  const sizes = Array.isArray(r.data.sizes) ? (r.data.sizes as { size: string; sell_through: number; units_sold: number; on_hand: number; avg_days_to_sell: number | null }[]) : null;
  const set = (status: "dismissed" | "actioned") => start(async () => { const res = await setRecommendationStatus(r.id, status); if (!res.ok) error(res.error); });

  return (
    <article className="card card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="badge">{LABELS[r.type] ?? r.type}</span>
            {r.type === "reprice" && r.data.direction ? <span className="badge">{r.data.direction === "up" ? "↑ up" : "↓ down"}</span> : null}
            <span className="faint text-xs capitalize">{r.scope}</span>
          </div>
          <h3 className="font-medium">{r.href ? <a href={r.href} className="hover:underline">{r.title}</a> : r.title}</h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-semibold tnum">{Math.round(r.score)}</div>
          <div className="faint text-[11px]">score</div>
        </div>
      </div>
      <p className="muted mt-2 text-sm">{r.reason}</p>
      {sizes && (
        <table className="table mt-2"><thead><tr><th>Size</th><th className="num">Sell-through</th><th className="num">Sold</th><th className="num">On hand</th><th className="num">Days</th></tr></thead>
          <tbody>{sizes.map((s) => <tr key={s.size}><td>{s.size}</td><td className="num">{fmt.pct(s.sell_through, 0)}</td><td className="num">{s.units_sold}</td><td className="num">{s.on_hand}</td><td className="num">{s.avg_days_to_sell ?? "—"}</td></tr>)}</tbody></table>
      )}
      {numbers.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="faint cursor-pointer">Numbers behind this</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {numbers.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2"><dt className="faint">{fmt.label(k)}</dt>
                <dd className="tnum">{PCT_KEYS.has(k) ? fmt.pct(Number(v)) : MONEY_KEYS.has(k) ? fmt.money(Number(v)) : String(v)}</dd></div>
            ))}
          </dl>
        </details>
      )}
      {r.status === "new" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-sm" disabled={pending} onClick={() => setTask(true)}><ClipboardPlus size={14} /> Create purchase task</button>
          <button className="btn btn-sm" disabled={pending} onClick={() => set("actioned")}><Check size={14} /> Mark actioned</button>
          <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => set("dismissed")}><X size={14} /> Dismiss</button>
        </div>
      )}
      <Modal open={task} onClose={() => setTask(false)} title="New purchase task">
        <form className="space-y-2" action={(f) => start(async () => {
          const res = await createPurchaseTask(r.id, String(f.get("title")), String(f.get("notes") ?? ""), String(f.get("due") ?? ""));
          if (res.ok) { ok("Task created"); setTask(false); } else error(res.error);
        })}>
          <input name="title" className="input" defaultValue={r.title} required />
          <textarea name="notes" className="input" rows={3} defaultValue={r.reason} />
          <label className="block text-sm"><span className="label">Due</span><input name="due" type="date" className="input" /></label>
          <button className="btn btn-primary w-full" disabled={pending}>Create</button>
        </form>
      </Modal>
      {notice}
    </article>
  );
}
