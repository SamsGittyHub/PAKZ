"use client";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useNotice } from "@/components/admin/Toast";
import { inviteStaff, saveSettings, setStaffRole } from "./actions";

type Rate = { name: string; price: number | string; free_over?: number | string };

export function StoreSettingsForm({ initial }: { initial: Record<string, unknown> }) {
  const [rates, setRates] = useState<Rate[]>((initial.shipping_rates as Rate[]) ?? []);
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();
  return (
    <form className="space-y-4" action={(f) => start(async () => {
      const r = await saveSettings({
        store_name: String(f.get("store_name")), contact_email: String(f.get("contact_email") ?? ""), currency: String(f.get("currency")),
        timezone: String(f.get("timezone")), vat_registered: f.get("vat_registered") === "on", vat_rate: String(f.get("vat_rate")),
        prices_include_vat: f.get("prices_include_vat") === "on", vat_scheme: String(f.get("vat_scheme")) as "standard",
        email_from: String(f.get("email_from") ?? ""), low_stock_default: String(f.get("low_stock_default")),
        shipping_rates: rates.filter((x) => x.name).map((x) => ({ name: x.name, price: String(x.price), ...(x.free_over !== "" && x.free_over != null ? { free_over: String(x.free_over) } : {}) })),
      });
      if (r.ok) ok(r.message ?? "Saved"); else error(r.error);
    })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className="label">Store name</span><input name="store_name" className="input" defaultValue={String(initial.store_name)} required /></label>
        <label className="text-sm"><span className="label">Contact email</span><input name="contact_email" type="email" className="input" defaultValue={String(initial.contact_email ?? "")} /></label>
        <label className="text-sm"><span className="label">Currency</span><input name="currency" className="input" defaultValue={String(initial.currency)} maxLength={3} /></label>
        <label className="text-sm"><span className="label">Timezone</span><input name="timezone" className="input" defaultValue={String(initial.timezone)} /></label>
        <label className="text-sm"><span className="label">Email &ldquo;from&rdquo; (display)</span><input name="email_from" className="input" defaultValue={String(initial.email_from ?? "")} placeholder="PAKZ <orders@pakz.co>" /></label>
        <label className="text-sm"><span className="label">Default low-stock threshold</span><input name="low_stock_default" className="input" inputMode="numeric" defaultValue={String(initial.low_stock_default)} /></label>
      </div>
      <fieldset className="rounded-lg border border-[var(--border)] p-3">
        <legend className="px-1 text-sm font-medium">Tax / VAT</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="vat_registered" defaultChecked={Boolean(initial.vat_registered)} /> VAT registered</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="prices_include_vat" defaultChecked={Boolean(initial.prices_include_vat)} /> Prices include VAT</label>
          <label className="text-sm"><span className="label">VAT rate %</span><input name="vat_rate" className="input" inputMode="decimal" defaultValue={String(initial.vat_rate)} /></label>
          <label className="text-sm"><span className="label">Scheme</span>
            <select name="vat_scheme" className="input" defaultValue={String(initial.vat_scheme)}><option value="standard">Standard</option><option value="margin">Margin scheme (second-hand goods)</option></select>
          </label>
        </div>
      </fieldset>
      <fieldset className="rounded-lg border border-[var(--border)] p-3">
        <legend className="px-1 text-sm font-medium">Shipping rates</legend>
        <div className="space-y-2">
          {rates.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_7rem_auto] gap-2">
              <input className="input" placeholder="Name" value={r.name} onChange={(e) => setRates(rates.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} aria-label="Rate name" />
              <input className="input" inputMode="decimal" placeholder="Price" value={String(r.price)} onChange={(e) => setRates(rates.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} aria-label="Price" />
              <input className="input" inputMode="decimal" placeholder="Free over" value={String(r.free_over ?? "")} onChange={(e) => setRates(rates.map((x, j) => j === i ? { ...x, free_over: e.target.value } : x))} aria-label="Free over" />
              <button type="button" className="btn btn-sm btn-ghost" aria-label="Remove rate" onClick={() => setRates(rates.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setRates([...rates, { name: "", price: "" }])}>+ Rate</button>
        </div>
      </fieldset>
      <button className="btn btn-primary" disabled={pending}>Save settings</button>
      {notice}
    </form>
  );
}

export function StaffManager({ staff, me }: { staff: { id: string; email: string; full_name: string | null; role: string }[]; me: string }) {
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();
  const run = (p: Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => { const r = await p; if (r.ok) ok(r.message ?? "Done"); else error(r.error ?? "Failed"); });
  return (
    <div className="space-y-4">
      <table className="table">
        <thead><tr><th>User</th><th>Role</th><th /></tr></thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id}>
              <td>{s.full_name ?? s.email}<div className="faint text-xs">{s.email}</div></td>
              <td>
                <select className="input !w-auto" defaultValue={s.role} disabled={s.id === me || pending} aria-label={`Role for ${s.email}`}
                  onChange={(e) => run(setStaffRole(s.id, e.target.value as "owner"))}>
                  <option value="owner">Owner</option><option value="staff">Staff (no costs/profit)</option>
                </select>
              </td>
              <td className="text-right">{s.id !== me && <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => confirm(`Remove admin access for ${s.email}?`) && run(setStaffRole(s.id, "customer"))}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="flex flex-wrap gap-2" action={(f) => run(inviteStaff({ email: String(f.get("email")), role: String(f.get("role")) as "staff", name: String(f.get("name") ?? "") }))}>
        <input name="name" className="input !w-40" placeholder="Name" />
        <input name="email" type="email" required className="input !w-64" placeholder="email@example.com" />
        <select name="role" className="input !w-auto" aria-label="Role"><option value="staff">Staff</option><option value="owner">Owner</option></select>
        <button className="btn" disabled={pending}>Invite</button>
      </form>
      {notice}
    </div>
  );
}
