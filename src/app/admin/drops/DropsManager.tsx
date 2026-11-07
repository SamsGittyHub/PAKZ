"use client";
import { useState, useTransition } from "react";
import { Dices } from "lucide-react";
import { DataTable } from "@/components/admin/DataTable";
import { Modal, useNotice } from "@/components/admin/Toast";
import { Section } from "@/components/admin/PageHeader";
import { drawRaffle, saveDrop, saveRaffle } from "../orders/actions";

type Row = Record<string, unknown>;

export function DropsManager({ drops, raffles, products }: { drops: Row[]; raffles: Row[]; products: { id: string; title: string }[] }) {
  const [dropOpen, setDropOpen] = useState<Row | "new" | null>(null);
  const [raffleOpen, setRaffleOpen] = useState(false);
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();
  const d = dropOpen && dropOpen !== "new" ? dropOpen : null;
  const local = (v: unknown) => (v ? new Date(String(v)).toISOString().slice(0, 16) : "");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Drops" actions={<button className="btn btn-sm" onClick={() => setDropOpen("new")}>+ Drop</button>}>
        <DataTable data={drops} searchable={false} filename="drops"
          columns={[{ key: "name", header: "Name" }, { key: "starts_at", header: "Starts", type: "datetime" }, { key: "listings", header: "Listings", type: "num" }, { key: "status", header: "Status", type: "badge" }]}
          rowActions={(r) => <button className="btn btn-sm" onClick={() => setDropOpen(r)}>Edit</button>} />
      </Section>
      <Section title="Raffles" actions={<button className="btn btn-sm" onClick={() => setRaffleOpen(true)}>+ Raffle</button>}>
        <DataTable data={raffles} searchable={false} filename="raffles"
          columns={[{ key: "name", header: "Name", sub: "product" }, { key: "ends_at", header: "Ends", type: "datetime" }, { key: "entries", header: "Entries", type: "num" }, { key: "status", header: "Status", type: "badge" }, { key: "winner", header: "Winner" }]}
          rowActions={(r) => r.status !== "drawn" && Number(r.entries) > 0 ? (
            <button className="btn btn-sm" disabled={pending} title="Draw winner" onClick={() => confirm(`Draw a winner from ${r.entries} entries?`) && start(async () => {
              const res = await drawRaffle(String(r.id)); if (res.ok) ok(res.message ?? "Drawn"); else error(res.error);
            })}><Dices size={14} /> Draw</button>
          ) : null} />
      </Section>

      <Modal open={!!dropOpen} onClose={() => setDropOpen(null)} title={d ? "Edit drop" : "New drop"}>
        <form className="space-y-2" action={(f) => start(async () => {
          const r = await saveDrop({ id: d?.id as string | undefined, name: String(f.get("name")), description: String(f.get("description") ?? ""), starts_at: String(f.get("starts_at") || ""), ends_at: String(f.get("ends_at") || ""), status: String(f.get("status")) });
          if (r.ok) { ok("Saved"); setDropOpen(null); } else error(r.error);
        })}>
          <input name="name" className="input" required placeholder="Drop name" defaultValue={String(d?.name ?? "")} />
          <textarea name="description" className="input" placeholder="Description" defaultValue={String(d?.description ?? "")} />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm"><span className="label">Starts</span><input name="starts_at" type="datetime-local" className="input" defaultValue={local(d?.starts_at)} /></label>
            <label className="text-sm"><span className="label">Ends</span><input name="ends_at" type="datetime-local" className="input" defaultValue={local(d?.ends_at)} /></label>
          </div>
          <select name="status" className="input" defaultValue={String(d?.status ?? "draft")} aria-label="Status">
            <option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="live">Live</option><option value="ended">Ended</option>
          </select>
          <button className="btn btn-primary w-full" disabled={pending}>Save</button>
        </form>
      </Modal>

      <Modal open={raffleOpen} onClose={() => setRaffleOpen(false)} title="New raffle">
        <form className="space-y-2" action={(f) => start(async () => {
          const r = await saveRaffle({ name: String(f.get("name")), product_id: String(f.get("product_id") || ""), drop_id: String(f.get("drop_id") || ""), starts_at: String(f.get("starts_at") || ""), ends_at: String(f.get("ends_at") || "") });
          if (r.ok) { ok("Raffle created"); setRaffleOpen(false); } else error(r.error);
        })}>
          <input name="name" className="input" required placeholder="Raffle name" />
          <select name="product_id" className="input" aria-label="Product"><option value="">Product…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
          <select name="drop_id" className="input" aria-label="Drop"><option value="">No drop</option>{drops.map((x) => <option key={String(x.id)} value={String(x.id)}>{String(x.name)}</option>)}</select>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm"><span className="label">Opens</span><input name="starts_at" type="datetime-local" className="input" /></label>
            <label className="text-sm"><span className="label">Closes</span><input name="ends_at" type="datetime-local" className="input" /></label>
          </div>
          <button className="btn btn-primary w-full" disabled={pending}>Create</button>
        </form>
      </Modal>
      {notice}
    </div>
  );
}
