import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { pageContext, iso, type SearchParams } from "@/lib/admin/context";
import { db, must, rpc } from "@/lib/supabase/admin";
import { addDays, localDate, zonedMidnight } from "@/lib/dates";
import { denseDaily, forecastSeries, projectMonth } from "@/lib/analytics/forecast";
import { predictStockouts, type VariantVelocityRow } from "@/lib/analytics/stockout";
import { getKpis } from "@/lib/admin/overview";
import { fmt } from "@/lib/format";
import { PageHeader, PageSkeleton, Section, Empty } from "@/components/admin/PageHeader";
import { KpiCard } from "@/components/admin/KpiCard";
import { ForecastChart } from "@/components/admin/Charts";
import { DataTable } from "@/components/admin/DataTable";
import { ActionButton } from "@/components/admin/ActionButton";
import { recomputeAnalytics } from "./actions";

interface ForecastRow {
  scope: string; scope_value: string; period: number; method: string; low_data: boolean; predicted_units: number;
  predicted_revenue: number; confidence_low: number; confidence_high: number; units_low: number; units_high: number;
  series: { date: string; revenue: number; low: number; high: number }[] | null; generated_at: string;
}

export default function ForecastsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Suspense fallback={<PageSkeleton />}><Forecasts searchParams={searchParams} /></Suspense>;
}

async function Forecasts({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { admin, settings } = await pageContext(searchParams);
  const tz = settings.timezone;
  const today = localDate(tz);

  const latest = must(await db().from("forecasts").select("generated_at").order("generated_at", { ascending: false }).limit(1), "latest");
  const generatedAt = latest[0]?.generated_at as string | undefined;
  const rows: ForecastRow[] = generatedAt
    ? (must(await db().from("forecasts").select("*").eq("generated_at", generatedAt).limit(5000), "forecasts") as ForecastRow[])
    : [];

  // History for the chart (last 60 days of actuals, overall).
  const histStart = addDays(today, -60);
  const series = await rpc<{ date: string; scope: string; units: number; revenue: number }[]>("admin_forecast_series", { p_days: 62 });
  const overallHist = denseDaily(new Map(series.filter((s) => s.scope === "overall").map((s) => [s.date, Number(s.revenue)])), histStart, addDays(today, -1));
  const overall90 = rows.find((r) => r.scope === "overall" && r.period === 90);
  const chart = [
    ...overallHist.dates.map((d, i) => ({ date: d, actual: overallHist.y[i] })),
    ...(overall90?.series ?? []).map((p) => ({ date: p.date, forecast: p.revenue, low: p.low, high: p.high })),
  ];

  // Month projection: actual MTD + forecast of remaining days (computed live from current data).
  const monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysElapsed = Number(today.slice(8, 10)) - 1;
  const [mtd, trailing, velocity] = await Promise.all([
    getKpis(zonedMidnight(monthStart, tz), zonedMidnight(today, tz)),
    getKpis(zonedMidnight(addDays(today, -90), tz), zonedMidnight(today, tz)),
    rpc<VariantVelocityRow[]>("admin_variant_velocity", { p_days: 30 }),
  ]);
  const yearSeries = await rpc<{ date: string; scope: string; revenue: number }[]>("admin_forecast_series", { p_days: 366 });
  const dense = denseDaily(new Map(yearSeries.filter((s) => s.scope === "overall").map((s) => [s.date, Number(s.revenue)])), addDays(today, -365), addDays(today, -1));
  const monthForecast = forecastSeries(dense.y, Math.max(daysInMonth - daysElapsed, 1));
  const proj = projectMonth(mtd.revenue, daysElapsed, daysInMonth, monthForecast);
  const trailingMargin = trailing.revenue ? trailing.profit / trailing.revenue : 0;

  const stockouts = predictStockouts(velocity, 30)
    .filter((s) => s.daysLeft != null && s.quantity > 0)
    .sort((a, b) => a.daysLeft! - b.daysLeft!)
    .slice(0, 100)
    .map((s) => ({ ...s, per_week: Math.round(s.rate * 7 * 10) / 10, days_left: Math.round(s.daysLeft! * 10) / 10 }));

  const table = (scope: string) => {
    const by = new Map<string, Record<string, unknown>>();
    for (const r of rows.filter((x) => x.scope === scope)) {
      const row = by.get(r.scope_value) ?? { name: r.scope_value || "All", low_data: false, method: r.method };
      row[`rev_${r.period}`] = Number(r.predicted_revenue);
      row[`units_${r.period}`] = Number(r.predicted_units);
      if (r.period === 30) row.band_30 = `${fmt.money(r.confidence_low)} – ${fmt.money(r.confidence_high)}`;
      row.low_data = Boolean(row.low_data) || r.low_data;
      row.method = r.method === "holt_winters" ? "Holt-Winters" : "Moving avg";
      row.confidence = row.low_data ? "Low data" : "OK";
      by.set(r.scope_value, row);
    }
    // Scopes with nothing forecast (no recent sales) add noise — leave them out.
    return [...by.values()].filter((r) => Number(r.rev_90 ?? 0) > 0 || Number(r.units_90 ?? 0) > 0).sort((a, b) => Number(b.rev_30 ?? 0) - Number(a.rev_30 ?? 0));
  };
  const cols = [
    { key: "name", header: "Name" },
    { key: "rev_7", header: "Rev 7d", type: "money" as const },
    { key: "rev_30", header: "Rev 30d", type: "money" as const },
    { key: "band_30", header: "30d 95% band", hideMobile: true },
    { key: "rev_90", header: "Rev 90d", type: "money" as const, hideMobile: true },
    { key: "units_30", header: "Units 30d", type: "num" as const },
    { key: "method", header: "Method", hideMobile: true },
    { key: "confidence", header: "Data", type: "badge" as const },
  ];

  return (
    <>
      <PageHeader
        title="Forecasts"
        description={generatedAt ? `Generated ${fmt.dateTime(generatedAt)} · Holt-Winters with ≥ 8 weeks of data, moving average otherwise` : "Not generated yet — runs nightly"}
        actions={admin.role === "owner" ? <ActionButton action={recomputeAnalytics}>Recompute now</ActionButton> : undefined}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Revenue month-to-date" value={proj.monthToDate} kind="money" compare={false} hint={`${daysElapsed} of ${daysInMonth} days`} />
        <KpiCard label="Projected (current pace)" value={proj.pace} kind="money" compare={false} hint="MTD ÷ days × month" />
        <KpiCard label="Projected (forecast)" value={proj.forecast} kind="money" compare={false} hint={`${fmt.money(proj.forecastLow)} – ${fmt.money(proj.forecastHigh)}${monthForecast.lowData ? " · low data" : ""}`} />
        {admin.canSeeCosts && <KpiCard label="Projected profit" value={proj.forecast * trailingMargin} kind="money" compare={false} hint={`At ${fmt.pct(trailingMargin)} trailing 90-day margin`} />}
      </div>

      <Section title="Revenue: last 60 days and next 90" className="mt-4">
        {overall90?.low_data && (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-[var(--ink-2)]"><AlertTriangle size={14} className="text-[var(--warning)]" aria-hidden /> Low data: fewer than 8 weeks of sales history, so this is a moving average with wide bands.</p>
        )}
        {chart.length ? <ForecastChart data={chart} /> : <Empty>No sales yet.</Empty>}
        <p className="faint mt-2 text-xs">Bands are approximate 95% intervals; horizon totals assume independent daily errors.</p>
      </Section>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Section title="By category"><DataTable data={table("category")} rowKey="name" columns={cols} filename="forecast-categories" searchable={false} /></Section>
        <Section title="By brand"><DataTable data={table("brand")} rowKey="name" columns={cols} filename="forecast-brands" searchable={false} /></Section>
        <Section title="By size"><DataTable data={table("size")} rowKey="name" columns={cols} filename="forecast-sizes" /></Section>
        <Section title="Predicted stockouts">
          <DataTable
            data={stockouts}
            rowKey="variant_id"
            filename="stockouts"
            initialSort={{ key: "days_left", desc: false }}
            empty="Nothing is selling fast enough to run out."
            columns={[
              { key: "title", header: "Product", href: "/admin/inventory/{variant_id}", sub: "size" },
              { key: "quantity", header: "Left", type: "num" },
              { key: "per_week", header: "Per week", type: "num" },
              { key: "days_left", header: "Days left", type: "num", warnAtOrBelow: 7 },
              { key: "stockoutDate", header: "Runs out", type: "date" },
            ]}
          />
        </Section>
      </div>
      <p className="faint mt-3 text-xs">Range {iso(zonedMidnight(monthStart, tz)).slice(0, 10)} onward · store timezone {tz}</p>
    </>
  );
}
