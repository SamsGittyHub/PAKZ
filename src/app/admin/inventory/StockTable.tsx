"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { History, PackagePlus, SlidersHorizontal } from "lucide-react";
import { DataTable, type ColSpec } from "@/components/admin/DataTable";
import { Modal, useNotice } from "@/components/admin/Toast";
import { adjustStock, receiveStock } from "./actions";

type Row = Record<string, unknown>;

export function StockTable({ rows, canSeeCosts }: { rows: Row[]; canSeeCosts: boolean }) {
  const [adjust, setAdjust] = useState<Row | null>(null);
  const [receive, setReceive] = useState<Row | null>(null);
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();

  const columns: ColSpec[] = [
    { key: "title", header: "Product", href: "/admin/products/{product_id}", sub: "brand" },
    { key: "size", header: "Size" },
    { key: "condition", header: "Condition", type: "label", hideMobile: true },
    { key: "quantity", header: "Available", type: "num", warnAtOrBelow: "low_threshold_or_zero" },
    { key: "reserved_quantity", header: "Reserved", type: "num", hideMobile: true },
    { key: "low_stock_threshold", header: "Low at", type: "num", hideMobile: true },
    { key: "units_sold_30d", header: "Sold 30d", type: "num", hideMobile: true },
    { key: "price", header: "Price", type: "money", hideMobile: true },
    ...(canSeeCosts ? [{ key: "cost_price", header: "Avg cost", type: "money", hideMobile: true } as ColSpec] : []),
    { key: "last_movement_at", header: "Last change", type: "date", hideMobile: true },
  ];
  // Highlight at-or-below threshold for multi-quantity lines; one-offs aren't "low" at 0.
  const data = rows.map((r) => ({ ...r, low_threshold_or_zero: Number(r.low_stock_threshold) > 1 ? r.low_stock_threshold : -1 }));

  const submit = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, close: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) { ok(res.message ?? "Saved"); close(); } else error(res.error ?? "Failed");
    });

  return (
    <>
      <DataTable
        data={data}
        columns={columns}
        rowKey="variant_id"
        filename="stock"
        rowActions={(r) => (
          <>
            <button className="btn btn-sm btn-ghost" title="Adjust" aria-label="Adjust stock" onClick={() => setAdjust(r)}><SlidersHorizontal size={14} /></button>
            <button className="btn btn-sm btn-ghost" title="Receive stock" aria-label="Receive stock" onClick={() => setReceive(r)}><PackagePlus size={14} /></button>
            <Link className="btn btn-sm btn-ghost" title="History" aria-label="History" href={`/admin/inventory/${r.variant_id}`} prefetch={false}><History size={14} /></Link>
          </>
        )}
      />

      <Modal open={!!adjust} onClose={() => setAdjust(null)} title={`Adjust · ${adjust?.title ?? ""} ${adjust?.size ? `(${adjust.size})` : ""}`}>
        {adjust && (
          <form className="space-y-3" action={(f) => submit(() => adjustStock({
            variant_id: String(adjust.variant_id), change: String(f.get("change")), reason: String(f.get("reason")) as "adjustment", note: String(f.get("note") ?? ""),
          }), () => setAdjust(null))}>
            <p className="faint text-sm">Currently {String(adjust.quantity)} available, {String(adjust.reserved_quantity)} reserved.</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="reason">Reason</label>
                <select id="reason" name="reason" className="input" required>
                  <option value="adjustment">Count correction (±)</option>
                  <option value="damaged">Damaged / lost (−)</option>
                  <option value="return">Customer return (+)</option>
                  <option value="reserved">Reserve (−)</option>
                  <option value="released">Release reservation (+)</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="change">Units</label>
                <input id="change" name="change" className="input" inputMode="numeric" required placeholder="-1 or 2" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="note">Note <span className="faint">(required for corrections)</span></label>
              <input id="note" name="note" className="input" placeholder="Stock count 7 Nov" />
            </div>
            <button className="btn btn-primary w-full" disabled={pending}>Save adjustment</button>
          </form>
        )}
      </Modal>

      <Modal open={!!receive} onClose={() => setReceive(null)} title={`Receive stock · ${receive?.title ?? ""} ${receive?.size ? `(${receive.size})` : ""}`}>
        {receive && (
          <form className="space-y-3" action={(f) => submit(() => receiveStock({
            variant_id: String(receive.variant_id), quantity: String(f.get("quantity")), unit_cost: String(f.get("unit_cost")),
            source: String(f.get("source")) as "retail", fees: String(f.get("fees") || 0), shipping_in: String(f.get("shipping_in") || 0),
            acquired_at: String(f.get("acquired_at") || "") || undefined, note: String(f.get("note") || ""),
          }), () => setReceive(null))}>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor="q">Quantity</label><input id="q" name="quantity" className="input" inputMode="numeric" required defaultValue="1" /></div>
              <div><label className="label" htmlFor="uc">Unit cost</label><input id="uc" name="unit_cost" className="input" inputMode="decimal" required /></div>
              <div>
                <label className="label" htmlFor="src">Source</label>
                <select id="src" name="source" className="input"><option value="retail">Retail</option><option value="resale">Resale</option><option value="consignment">Consignment</option><option value="private">Private</option></select>
              </div>
              <div><label className="label" htmlFor="date">Acquired</label><input id="date" name="acquired_at" type="date" className="input" /></div>
              <div><label className="label" htmlFor="fees">Fees (lot total)</label><input id="fees" name="fees" className="input" inputMode="decimal" defaultValue="0" /></div>
              <div><label className="label" htmlFor="ship">Shipping in (lot total)</label><input id="ship" name="shipping_in" className="input" inputMode="decimal" defaultValue="0" /></div>
            </div>
            <input name="note" className="input" placeholder="Note (supplier, receipt #)" />
            <p className="faint text-xs">Cost basis moves to the weighted average of current stock and this lot (fees and inbound shipping included).</p>
            <button className="btn btn-primary w-full" disabled={pending}>Receive</button>
          </form>
        )}
      </Modal>
      {notice}
    </>
  );
}
