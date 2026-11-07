import "server-only";
import { db, must, rpc } from "@/lib/supabase/admin";
import { addDays, localDate } from "@/lib/dates";
import { denseDaily, forecastSeries, horizonTotal } from "@/lib/analytics/forecast";
import { predictStockouts, type VariantVelocityRow } from "@/lib/analytics/stockout";
import { generateRecommendations, recoKey, type RecoInputs } from "@/lib/analytics/recommendations";
import { generateBuyingBrief } from "./brief";

const PERIODS = [7, 30, 90] as const;
const HISTORY_DAYS = 365;

async function tz(): Promise<string> {
  const { data } = await db().from("store_settings").select("timezone").eq("id", 1).single();
  return data?.timezone ?? "UTC";
}

export async function runLogged<T>(job: string, fn: () => Promise<T>): Promise<T> {
  const run = must(await db().from("cron_runs").insert({ job }).select("id").single(), "cron_runs");
  try {
    const result = await fn();
    await db().from("cron_runs").update({ finished_at: new Date().toISOString(), ok: true, detail: result as object }).eq("id", run.id);
    return result;
  } catch (e) {
    await db().from("cron_runs").update({ finished_at: new Date().toISOString(), ok: false, detail: { error: e instanceof Error ? e.message : String(e) } }).eq("id", run.id);
    throw e;
  }
}

/** Rebuild daily_metrics for the trailing window (late refunds/events can change recent days). */
export async function refreshRollups(days = 3) {
  const zone = await tz();
  const today = localDate(zone);
  const rows = await rpc<number>("refresh_daily_metrics", { p_from: addDays(today, -days), p_to: today });
  return { rows };
}

/** Forecast every scope and store 7/30/90-day horizons. */
export async function runForecasts() {
  const zone = await tz();
  const today = localDate(zone);
  const lastFull = addDays(today, -1);
  const start = addDays(today, -HISTORY_DAYS);
  const rows = await rpc<{ date: string; scope: string; scope_value: string; units: number; revenue: number }[]>(
    "admin_forecast_series", { p_days: HISTORY_DAYS + 1 },
  );

  const groups = new Map<string, { scope: string; value: string; units: Map<string, number>; revenue: Map<string, number>; sales: number }>();
  for (const r of rows) {
    if (r.date > lastFull) continue; // only complete days
    const k = `${r.scope}|${r.scope_value}`;
    const g = groups.get(k) ?? { scope: r.scope, value: r.scope_value, units: new Map(), revenue: new Map(), sales: 0 };
    g.units.set(r.date, Number(r.units));
    g.revenue.set(r.date, Number(r.revenue));
    g.sales += Number(r.units);
    groups.set(k, g);
  }
  if (!groups.has("overall|")) groups.set("overall|", { scope: "overall", value: "", units: new Map(), revenue: new Map(), sales: 0 });

  const generatedAt = new Date().toISOString();
  const inserts: Record<string, unknown>[] = [];
  for (const g of groups.values()) {
    // Products are usually one-offs: only forecast lines with repeat sales.
    if (g.scope === "product" && g.sales < 3) continue;
    const units = denseDaily(g.units, start, lastFull).y;
    const revenue = denseDaily(g.revenue, start, lastFull).y;
    const fu = forecastSeries(units, 90);
    const fr = forecastSeries(revenue, 90);
    for (const period of PERIODS) {
      const u = horizonTotal(fu, period);
      const r = horizonTotal(fr, period);
      inserts.push({
        scope: g.scope, scope_value: g.value, period, method: fr.method, low_data: fr.lowData || fu.lowData,
        predicted_units: round(u.value), units_low: round(u.low), units_high: round(u.high),
        predicted_revenue: round(r.value), confidence_low: round(r.low), confidence_high: round(r.high),
        series: period === 90 && (g.scope === "overall" || g.scope === "category")
          ? fr.points.map((p) => ({ date: addDays(lastFull, p.h), revenue: round(p.value), low: round(p.low), high: round(p.high) }))
          : null,
        generated_at: generatedAt,
      });
    }
  }
  for (let i = 0; i < inserts.length; i += 500) {
    must(await db().from("forecasts").insert(inserts.slice(i, i + 500)).select("id"), "insert forecasts");
  }
  // Keep two weeks of history for "forecast vs actual" checks.
  await db().from("forecasts").delete().lt("generated_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
  return { scopes: groups.size, rows: inserts.length };
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function computeRecommendations() {
  const [inputs, velocity] = await Promise.all([
    rpc<RecoInputs>("admin_reco_inputs", { p_days: 30 }),
    rpc<VariantVelocityRow[]>("admin_variant_velocity", { p_days: 30 }),
  ]);
  return generateRecommendations(inputs, predictStockouts(velocity, 30));
}

/** Upsert open recommendations; respect recent dismissals/actions; drop stale ones. */
export async function runRecommendations() {
  const recs = await computeRecommendations();
  const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const existing = must(
    await db().from("recommendations").select("id, type, scope, scope_value, status, updated_at")
      .or(`status.eq.new,and(status.eq.dismissed,updated_at.gt.${since(14)}),and(status.eq.actioned,updated_at.gt.${since(7)})`),
    "recommendations",
  );
  const byKey = new Map(existing.map((r) => [recoKey(r), r]));
  const seen = new Set<string>();
  let inserted = 0, updated = 0, skipped = 0;
  const toInsert: Record<string, unknown>[] = [];

  for (const r of recs) {
    const key = recoKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = byKey.get(key);
    if (prev && prev.status !== "new") { skipped++; continue; }
    if (prev) {
      await db().from("recommendations").update({ title: r.title, reason: r.reason, score: r.score, data: r.data, updated_at: new Date().toISOString() }).eq("id", prev.id);
      updated++;
    } else {
      toInsert.push({ ...r });
      inserted++;
    }
  }
  if (toInsert.length) must(await db().from("recommendations").insert(toInsert).select("id"), "insert recommendations");
  const stale = existing.filter((r) => r.status === "new" && !seen.has(recoKey(r))).map((r) => r.id);
  if (stale.length) await db().from("recommendations").delete().in("id", stale);
  return { generated: recs.length, inserted, updated, skipped, removed: stale.length };
}

export async function runNightly(opts: { brief?: boolean } = {}) {
  const zone = await tz();
  const published = await rpc<number>("publish_scheduled_products");
  const rollups = await refreshRollups(3);
  const forecasts = await runForecasts();
  const recommendations = await runRecommendations();
  // Monday morning (store time) → weekly Buying Brief.
  const isMonday = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(new Date()) === "Mon";
  let brief: string | null = null;
  if (opts.brief ?? isMonday) {
    try {
      const b = await generateBuyingBrief(zone);
      brief = b ? `generated (${b.model})` : "skipped (no ANTHROPIC_API_KEY or declined)";
    } catch (e) {
      brief = `failed: ${e instanceof Error ? e.message : e}`;
    }
  }
  return { published, rollups, forecasts, recommendations, brief };
}
