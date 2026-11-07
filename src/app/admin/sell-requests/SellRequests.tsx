"use client";
import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { DataTable } from "@/components/admin/DataTable";
import { Modal, useNotice } from "@/components/admin/Toast";
import { fmt } from "@/lib/format";
import { updateSellRequest } from "../orders/actions";

type Row = Record<string, unknown>;
const STATUSES = ["new", "reviewing", "offer_sent", "accepted", "rejected", "completed"];

export function SellRequests({ rows }: { rows: Row[] }) {
  const [edit, setEdit] = useState<Row | null>(null);
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();
  return (
    <>
      <DataTable
        data={rows}
        filename="sell-requests"
        initialSort={{ key: "created_at", desc: true }}
        columns={[
          { key: "created_at", header: "Received", type: "date" },
          { key: "item", header: "Item", sub: "brand" },
          { key: "size", header: "Size", hideMobile: true },
          { key: "condition", header: "Condition", type: "label", hideMobile: true },
          { key: "asking_price", header: "Asking", type: "money" },
          { key: "offer_price", header: "Our offer", type: "money", hideMobile: true },
          { key: "name", header: "From", sub: "email", hideMobile: true },
          { key: "status", header: "Status", type: "badge" },
        ]}
        rowActions={(r) => <button className="btn btn-sm btn-ghost" aria-label="Review" onClick={() => setEdit(r)}><Pencil size={14} /></button>}
      />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Sell request · ${edit?.item ?? ""}`}>
        {edit && (
          <form className="space-y-3 text-sm" action={(f) => start(async () => {
            const r = await updateSellRequest({ id: String(edit.id), status: String(f.get("status")), offer_price: f.get("offer_price") ? Number(f.get("offer_price")) : null, notes: String(f.get("notes") ?? "") });
            if (r.ok) { ok("Updated"); setEdit(null); } else error(r.error);
          })}>
            <p>{String(edit.name)} · <a className="underline" href={`mailto:${edit.email}`}>{String(edit.email)}</a>{edit.phone ? ` · ${edit.phone}` : ""}</p>
            <p className="muted">{[edit.brand, edit.size, fmt.label(edit.condition as string)].filter(Boolean).join(" · ")} · asking {fmt.money(edit.asking_price as number)}</p>
            {Array.isArray(edit.images) && edit.images.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {(edit.images as string[]).map((src) => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="" className="aspect-square rounded object-cover" /></a>)}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <select name="status" className="input" defaultValue={String(edit.status)} aria-label="Status">{STATUSES.map((s) => <option key={s} value={s}>{fmt.label(s)}</option>)}</select>
              <input name="offer_price" className="input" inputMode="decimal" placeholder="Our offer" defaultValue={edit.offer_price ? String(edit.offer_price) : ""} />
            </div>
            <textarea name="notes" className="input" rows={3} placeholder="Notes" defaultValue={String(edit.notes ?? "")} />
            <button className="btn btn-primary w-full" disabled={pending}>Save</button>
          </form>
        )}
      </Modal>
      {notice}
    </>
  );
}
