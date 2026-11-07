import "server-only";
import { db, must } from "@/lib/supabase/admin";
import { esc, sendEmail } from "@/lib/email";
import { fmt } from "@/lib/format";
import { env } from "@/lib/env";

interface Alert { type: string; title: string; body: string; data: Record<string, unknown>; dedupe: string }

/**
 * Hourly: create in-app notifications (and email the owner) for configurable alerts.
 * Each alert carries a dedupe key so re-runs don't repeat it.
 */
export async function runAlerts() {
  const settings = must(await db().from("store_settings").select("alerts, report_recipients, store_name").eq("id", 1).single(), "settings");
  const cfg = settings.alerts as { low_stock: boolean; big_order_threshold: number; offer_received: boolean; traffic_spike_pct: number };
  const hourAgo = new Date(Date.now() - 65 * 60_000).toISOString();
  const alerts: Alert[] = [];

  if (cfg.low_stock) {
    const low = must(await db().from("product_variants").select("id, size, quantity, low_stock_threshold, products!inner(title, status)").eq("status", "active").gt("low_stock_threshold", 1).eq("products.status", "active"), "low stock") as unknown as
      { id: string; size: string | null; quantity: number; low_stock_threshold: number; products: { title: string } }[];
    for (const v of low.filter((x) => x.quantity <= x.low_stock_threshold)) {
      alerts.push({ type: "low_stock", title: `Low stock: ${v.products.title}${v.size ? ` (${v.size})` : ""}`, body: `${v.quantity} left (alert at ${v.low_stock_threshold}).`, data: { variant_id: v.id }, dedupe: `low_stock:${v.id}:${new Date().toISOString().slice(0, 10)}` });
    }
  }
  if (cfg.big_order_threshold > 0) {
    const big = must(await db().from("orders").select("id, number, total, channel").gte("paid_at", hourAgo).gte("total", cfg.big_order_threshold), "big orders");
    for (const o of big) alerts.push({ type: "big_order", title: `Big order #${o.number}: ${fmt.money(o.total)}`, body: `${fmt.label(o.channel)} order over ${fmt.money(cfg.big_order_threshold)}.`, data: { order_id: o.id }, dedupe: `big_order:${o.id}` });
  }
  if (cfg.offer_received) {
    const offers = must(await db().from("offers").select("id, amount, products(title)").eq("status", "pending").gte("created_at", hourAgo), "offers") as unknown as { id: string; amount: number; products: { title: string } | null }[];
    for (const o of offers) alerts.push({ type: "offer_received", title: `Offer: ${fmt.money(o.amount)} on ${o.products?.title ?? "an item"}`, body: "Respond from the offers inbox.", data: { offer_id: o.id }, dedupe: `offer:${o.id}` });
  }
  const sellReqs = must(await db().from("sell_requests").select("id, item, brand").gte("created_at", hourAgo), "sell requests");
  for (const s of sellReqs) alerts.push({ type: "sell_request", title: `Sell request: ${[s.brand, s.item].filter(Boolean).join(" ")}`, body: "New sell-to-us submission.", data: { sell_request_id: s.id }, dedupe: `sell:${s.id}` });

  if (cfg.traffic_spike_pct > 0) {
    const now = Date.now();
    const { count: lastHour } = await db().from("sessions").select("id", { count: "exact", head: true }).eq("is_bot", false).gte("first_seen", new Date(now - 3_600_000).toISOString());
    // Baseline: same hour on each of the previous 7 days.
    let base = 0;
    for (let d = 1; d <= 7; d++) {
      const { count } = await db().from("sessions").select("id", { count: "exact", head: true }).eq("is_bot", false)
        .gte("first_seen", new Date(now - d * 86_400_000 - 3_600_000).toISOString()).lt("first_seen", new Date(now - d * 86_400_000).toISOString());
      base += count ?? 0;
    }
    const avg = base / 7;
    if ((lastHour ?? 0) >= 20 && (lastHour ?? 0) > avg * (1 + cfg.traffic_spike_pct / 100)) {
      alerts.push({ type: "traffic_spike", title: `Traffic spike: ${lastHour} sessions in the last hour`, body: `Usually ~${Math.round(avg)} at this hour. Check Traffic → Sources for where it's coming from.`, data: { sessions: lastHour, baseline: avg }, dedupe: `traffic:${new Date().toISOString().slice(0, 13)}` });
    }
  }

  if (!alerts.length) return { created: 0 };
  const keys = alerts.map((a) => a.dedupe);
  const existing = must(await db().from("notifications").select("data").in("data->>dedupe", keys), "notifications").map((n) => (n.data as { dedupe: string }).dedupe);
  const fresh = alerts.filter((a) => !existing.includes(a.dedupe));
  if (!fresh.length) return { created: 0 };
  must(await db().from("notifications").insert(fresh.map((a) => ({ type: a.type, title: a.title, body: a.body, data: { ...a.data, dedupe: a.dedupe } }))).select("id"), "insert notifications");

  const owners = must(await db().from("profiles").select("email").eq("role", "owner"), "owners").map((o) => o.email).filter(Boolean) as string[];
  const to = (settings.report_recipients as string[]).length ? (settings.report_recipients as string[]) : owners;
  if (to.length) {
    await sendEmail({
      to,
      subject: fresh.length === 1 ? `${settings.store_name}: ${fresh[0].title}` : `${settings.store_name}: ${fresh.length} new alerts`,
      html: `<ul>${fresh.map((a) => `<li><b>${esc(a.title)}</b><br>${esc(a.body)}</li>`).join("")}</ul><p><a href="${esc(env.siteUrl)}/admin/reports">View in dashboard</a></p>`,
    });
  }
  return { created: fresh.length };
}
