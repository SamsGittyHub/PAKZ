"use client";
import { useTransition } from "react";
import { useNotice } from "@/components/admin/Toast";
import { markNotificationsRead, saveAlertSettings, sendReportNow } from "../settings/actions";

export function AlertSettingsForm({ initial, isOwner }: { initial: { report_recipients: string[]; report_weekly: boolean; report_monthly: boolean; alerts: { low_stock: boolean; big_order_threshold: number; offer_received: boolean; traffic_spike_pct: number } }; isOwner: boolean }) {
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();
  return (
    <form className="space-y-3 text-sm" action={(f) => start(async () => {
      const r = await saveAlertSettings({
        report_recipients: String(f.get("recipients") ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
        report_weekly: f.get("weekly") === "on", report_monthly: f.get("monthly") === "on",
        alerts: { low_stock: f.get("low_stock") === "on", offer_received: f.get("offer_received") === "on", big_order_threshold: String(f.get("big_order") || 0), traffic_spike_pct: String(f.get("spike") || 0) },
      });
      if (r.ok) ok(r.message ?? "Saved"); else error(r.error);
    })}>
      <fieldset disabled={!isOwner || pending} className="space-y-3">
        <label className="block"><span className="label">Report & alert recipients <span className="faint">(blank = owners)</span></span>
          <input name="recipients" className="input" defaultValue={initial.report_recipients.join(", ")} placeholder="owner@pakz.co, ops@pakz.co" /></label>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2"><input type="checkbox" name="weekly" defaultChecked={initial.report_weekly} /> Weekly report (Mon 07:00)</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="monthly" defaultChecked={initial.report_monthly} /> Monthly report (1st)</label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2"><input type="checkbox" name="low_stock" defaultChecked={initial.alerts.low_stock} /> Low stock</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="offer_received" defaultChecked={initial.alerts.offer_received} /> Offer received</label>
          <label><span className="label">Big order alert at (0 = off)</span><input name="big_order" className="input" inputMode="decimal" defaultValue={initial.alerts.big_order_threshold} /></label>
          <label><span className="label">Traffic spike: % above usual (0 = off)</span><input name="spike" className="input" inputMode="numeric" defaultValue={initial.alerts.traffic_spike_pct} /></label>
        </div>
        {isOwner && <button className="btn btn-primary">Save</button>}
      </fieldset>
      {notice}
    </form>
  );
}

export function SendReportButtons() {
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();
  const send = (p: "weekly" | "monthly") => start(async () => { const r = await sendReportNow(p); if (r.ok) ok(r.message ?? "Sent"); else error(r.error); });
  return (
    <div className="flex gap-2">
      <button className="btn btn-sm" disabled={pending} onClick={() => send("weekly")}>Send weekly now</button>
      <button className="btn btn-sm" disabled={pending} onClick={() => send("monthly")}>Send monthly now</button>
      {notice}
    </div>
  );
}

export function MarkReadButton() {
  const [pending, start] = useTransition();
  return <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => { await markNotificationsRead(); })}>Mark all read</button>;
}
