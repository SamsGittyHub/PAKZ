import "server-only";
import { db, must, rpc } from "@/lib/db";
import { addDays, localDate, zonedMidnight } from "@/lib/dates";
import { esc, sendEmail } from "@/lib/email";
import { change, fmt } from "@/lib/format";
import { env } from "@/lib/env";

export type ReportPeriod = "weekly" | "monthly";

interface Kpis { revenue: number; profit: number; orders: number; units: number; aov: number; visitors: number; conversion_rate: number }

export async function buildReport(period: ReportPeriod) {
  const settings = must(await db().from("store_settings").select("*").eq("id", 1).single(), "settings");
  const tz = settings.timezone as string;
  const today = localDate(tz);
  let fromDate: string, prevFromDate: string;
  const toDate = today; // exclusive: up to the start of today
  if (period === "weekly") {
    fromDate = addDays(today, -7);
    prevFromDate = addDays(today, -14);
  } else {
    const firstThis = `${today.slice(0, 7)}-01`;
    fromDate = `${addDays(firstThis, -1).slice(0, 7)}-01`; // first of last month
    prevFromDate = `${addDays(fromDate, -1).slice(0, 7)}-01`;
  }
  const from = zonedMidnight(fromDate, tz);
  const to = period === "weekly" ? zonedMidnight(toDate, tz) : zonedMidnight(`${today.slice(0, 7)}-01`, tz);
  const prevFrom = zonedMidnight(prevFromDate, tz);

  const [cur, prev, top, forecast, recs, brief] = await Promise.all([
    rpc<Kpis>("admin_kpis", { p_from: from.toISOString(), p_to: to.toISOString() }),
    rpc<Kpis>("admin_kpis", { p_from: prevFrom.toISOString(), p_to: from.toISOString() }),
    rpc<{ label: string; revenue: number; profit: number; units: number }[]>("admin_breakdown", { p_from: from.toISOString(), p_to: to.toISOString(), p_dim: "product" }),
    db().from("forecasts").select("period, predicted_revenue, confidence_low, confidence_high, low_data, method").eq("scope", "overall").order("generated_at", { ascending: false }).limit(3),
    db().from("recommendations").select("title, reason, score").eq("status", "new").order("score", { ascending: false }).limit(5),
    period === "weekly" ? db().from("ai_briefs").select("content").order("generated_at", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);

  const kpiRow = (label: string, key: keyof Kpis, kind: "money" | "num" | "pct") => {
    const c = change(Number(cur[key]), Number(prev[key]));
    const f = (v: number) => (kind === "money" ? fmt.money(v) : kind === "pct" ? fmt.pct(v) : fmt.num(v));
    return `<tr><td style="padding:4px 12px 4px 0;color:#52514e">${label}</td><td style="padding:4px 12px 4px 0;font-weight:600">${f(Number(cur[key]))}</td><td style="color:#898781">${c == null ? "new" : `${c >= 0 ? "▲" : "▼"} ${(Math.abs(c) * 100).toFixed(1)}%`} vs ${f(Number(prev[key]))}</td></tr>`;
  };
  const topSellers = [...top].sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 5);
  const fc = must(forecast, "forecasts");
  const store = esc(settings.store_name);
  const label = period === "weekly" ? `Week of ${fmt.date(fromDate)}` : new Date(`${fromDate}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:600px;color:#0b0b0b">
<h2 style="margin:0 0 4px">${store} ${period} report</h2><p style="margin:0 0 16px;color:#52514e">${esc(label)}</p>
<table style="border-collapse:collapse;font-size:14px">${kpiRow("Revenue", "revenue", "money")}${kpiRow("Profit", "profit", "money")}${kpiRow("Orders", "orders", "num")}${kpiRow("Units sold", "units", "num")}${kpiRow("Avg order value", "aov", "money")}${kpiRow("Visitors", "visitors", "num")}${kpiRow("Conversion", "conversion_rate", "pct")}</table>
<h3 style="margin:20px 0 6px">Top sellers</h3><ol style="margin:0;padding-left:18px;font-size:14px">${topSellers.map((t) => `<li>${esc(t.label)} — ${fmt.money(t.revenue)} (${t.units} sold, ${fmt.money(t.profit)} profit)</li>`).join("") || "<li>No sales</li>"}</ol>
<h3 style="margin:20px 0 6px">Forecast</h3><ul style="margin:0;padding-left:18px;font-size:14px">${fc.map((f) => `<li>Next ${f.period} days: ${fmt.money(f.predicted_revenue)} (95%: ${fmt.money(f.confidence_low)}–${fmt.money(f.confidence_high)})${f.low_data ? " · low data" : ""}</li>`).join("") || "<li>Not yet generated</li>"}</ul>
<h3 style="margin:20px 0 6px">Top recommendations</h3><ol style="margin:0;padding-left:18px;font-size:14px">${must(recs, "recs").map((r) => `<li><b>${esc(r.title)}</b><br><span style="color:#52514e">${esc(r.reason)}</span></li>`).join("") || "<li>None right now</li>"}</ol>
${brief.data?.content ? `<h3 style="margin:20px 0 6px">Buying brief</h3><div style="font-size:14px;white-space:pre-wrap">${esc(brief.data.content)}</div>` : ""}
<p style="margin-top:24px;font-size:12px;color:#898781"><a href="${esc(env.siteUrl)}/admin">Open dashboard</a></p></div>`;
  return { subject: `${settings.store_name} ${period} report — ${label}`, html, recipients: settings.report_recipients as string[], settings };
}

/** Owner emails, used when no report recipients are configured. */
async function ownerEmails(): Promise<string[]> {
  const rows = must(await db().from("profiles").select("email").eq("role", "owner"), "owners");
  return rows.map((r) => r.email).filter(Boolean) as string[];
}

export async function sendReport(period: ReportPeriod, force = false) {
  const r = await buildReport(period);
  if (!force && ((period === "weekly" && !r.settings.report_weekly) || (period === "monthly" && !r.settings.report_monthly))) {
    return { sent: false, reason: "disabled in settings" };
  }
  const to = r.recipients.length ? r.recipients : await ownerEmails();
  if (!to.length) return { sent: false, reason: "no recipients" };
  const sent = await sendEmail({ to, subject: r.subject, html: r.html });
  return { sent, to: to.length };
}
