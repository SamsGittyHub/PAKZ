import { Suspense } from "react";
import { pageContext, iso, one, type SearchParams } from "@/lib/admin/context";
import { getTimeseries } from "@/lib/admin/overview";
import { getLookups } from "@/lib/admin/products";
import { rpc } from "@/lib/db";
import { fmt } from "@/lib/format";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { KpiCard } from "@/components/admin/KpiCard";
import { DateRangePicker } from "@/components/admin/DateRangePicker";
import { FilterBar } from "@/components/admin/FilterBar";
import { DataTable } from "@/components/admin/DataTable";
import { TimeSeriesChart } from "@/components/admin/Charts";
import { BarList, Funnel } from "@/components/admin/BarList";
import { CsvButton } from "@/components/admin/CsvButton";
import { RealtimeWidget } from "./Realtime";

interface Summary { sessions: number; visitors: number; page_views: number; bounce_rate: number | null; avg_session_seconds: number | null; new_sessions: number; returning_sessions: number; conversion_rate: number | null }

export default function TrafficPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Suspense fallback={<PageSkeleton />}><Traffic searchParams={searchParams} /></Suspense>;
}

async function Traffic({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { range, params } = await pageContext(searchParams);
  const p = { p_from: iso(range.from), p_to: iso(range.to) };
  const fCategory = one(params.f_category) || null;
  const fSource = one(params.f_source) || null;
  const fDevice = one(params.f_device) || null;

  const [summary, prev, rawSeries, sources, campaigns, funnel, topViewed, searches, filters, devices, countries, lookups] = await Promise.all([
    rpc<Summary>("admin_traffic_summary", p),
    rpc<Summary>("admin_traffic_summary", { p_from: iso(range.prevFrom), p_to: iso(range.prevTo) }),
    getTimeseries(range),
    rpc<{ source: string; sessions: number; visitors: number; conversions: number; conversion_rate: number; revenue: number }[]>("admin_sources", p),
    rpc<Record<string, unknown>[]>("admin_campaigns", p),
    rpc<{ step: number; name: string; sessions: number }[]>("admin_funnel", { ...p, p_category: fCategory, p_source: fSource, p_device: fDevice }),
    rpc<{ product_id: string; title: string; views: number; add_to_carts: number; purchases: number }[]>("admin_top_viewed", { ...p, p_limit: 20 }),
    rpc<{ query: string; searches: number; zero_result_searches: number; avg_results: number }[]>("admin_search_terms", { ...p, p_limit: 50 }),
    rpc<{ filter: string; value: string; uses: number }[]>("admin_filters_used", { ...p, p_limit: 30 }),
    rpc<{ key: string; sessions: number; conversions: number; conversion_rate: number }[]>("admin_session_breakdown", { ...p, p_dim: "device" }),
    rpc<{ key: string; sessions: number; conversions: number; conversion_rate: number }[]>("admin_session_breakdown", { ...p, p_dim: "country" }),
    getLookups(),
  ]);
  const c = range.compare;
  // Traffic charts only need traffic fields — never ship profit to the client here.
  const series = rawSeries.map(({ bucket, sessions, visitors, page_views }) => ({ bucket, sessions, visitors, page_views }));
  const zero = searches.filter((s) => Number(s.zero_result_searches) > 0).sort((a, b) => b.zero_result_searches - a.zero_result_searches);
  const sizes = filters.filter((f) => f.filter === "size");

  return (
    <>
      <PageHeader title="Traffic" description={`${range.label} · admin and bot traffic excluded`} actions={<DateRangePicker />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Visitors" value={summary.visitors} prev={prev.visitors} compare={c} />
        <KpiCard label="Sessions" value={summary.sessions} prev={prev.sessions} compare={c} />
        <KpiCard label="Page views" value={summary.page_views} prev={prev.page_views} compare={c} />
        <KpiCard label="Bounce rate" value={summary.bounce_rate} prev={prev.bounce_rate} kind="pct" invert compare={c} />
        <KpiCard label="Avg session" value={summary.avg_session_seconds} prev={prev.avg_session_seconds} compare={c} hint={fmt.duration(summary.avg_session_seconds) + " (multi-page sessions)"} />
        <KpiCard label="New sessions" value={summary.new_sessions} prev={prev.new_sessions} compare={c} />
        <KpiCard label="Returning sessions" value={summary.returning_sessions} prev={prev.returning_sessions} compare={c} hint="Consented visitors only" />
        <KpiCard label="Conversion rate" value={summary.conversion_rate} prev={prev.conversion_rate} kind="pct" compare={c} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title="Sessions over time" className="lg:col-span-2" actions={<CsvButton rows={series} filename="traffic" />}>
          <TimeSeriesChart data={series} kind="num" series={[{ key: "sessions", label: "Sessions", slot: 1 }, { key: "visitors", label: "Visitors", slot: 2 }]} />
        </Section>
        <Section title="Realtime"><RealtimeWidget /></Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Sources">
          <DataTable data={sources} rowKey="source" searchable={false} filename="traffic-sources" initialSort={{ key: "sessions", desc: true }}
            columns={[
              { key: "source", header: "Source", type: "label" },
              { key: "sessions", header: "Sessions", type: "num" },
              { key: "conversions", header: "Orders", type: "num", hideMobile: true },
              { key: "conversion_rate", header: "Conv.", type: "pct" },
              { key: "revenue", header: "Revenue", type: "money" },
            ]} />
        </Section>
        <Section title="Conversion funnel">
          <FilterBar filters={[
            { key: "f_category", label: "Category", options: lookups.categories.map((x) => ({ value: x.name, label: x.name })) },
            { key: "f_source", label: "Source", options: sources.map((s) => ({ value: s.source, label: fmt.label(s.source) })) },
            { key: "f_device", label: "Device", options: ["mobile", "desktop", "tablet"].map((d) => ({ value: d, label: fmt.label(d) })) },
          ]} />
          <Funnel steps={funnel.map((s) => ({ name: s.name, sessions: Number(s.sessions) }))} />
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Top viewed products" actions={<CsvButton rows={topViewed} filename="top-viewed" />}>
          <BarList rows={topViewed.slice(0, 12).map((t) => ({ label: t.title, value: Number(t.views), href: `/admin/products/${t.product_id}`, secondary: `${t.add_to_carts} ATC · ${t.purchases} sold` }))} />
        </Section>
        <Section title="UTM campaigns">
          <DataTable data={campaigns} rowKey="campaign" searchable={false} filename="campaigns" empty="No tagged campaigns. Add ?utm_campaign= to your links."
            columns={[
              { key: "campaign", header: "Campaign", sub: "source" },
              { key: "sessions", header: "Sessions", type: "num" },
              { key: "conversions", header: "Orders", type: "num" },
              { key: "revenue", header: "Revenue", type: "money" },
            ]} />
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title="Most searched" actions={<CsvButton rows={searches} filename="search-terms" />}>
          <BarList rows={searches.slice(0, 12).map((s) => ({ label: s.query, value: Number(s.searches), secondary: Number(s.zero_result_searches) ? `${s.zero_result_searches} no results` : undefined }))} />
        </Section>
        <Section title="Zero-result searches (demand signal)">
          {zero.length === 0 ? <p className="faint text-sm">Every search found something.</p> : (
            <BarList rows={zero.slice(0, 12).map((s) => ({ label: s.query, value: Number(s.zero_result_searches) }))} />
          )}
        </Section>
        <Section title="Filters & sizes used">
          <BarList rows={(sizes.length ? sizes : filters).slice(0, 12).map((f) => ({ label: sizes.length ? `Size ${f.value}` : `${fmt.label(f.filter)}: ${f.value}`, value: Number(f.uses) }))} />
          {sizes.length > 0 && filters.length > sizes.length && (
            <details className="mt-2 text-sm"><summary className="cursor-pointer faint">Other filters</summary>
              <BarList rows={filters.filter((f) => f.filter !== "size").slice(0, 10).map((f) => ({ label: `${fmt.label(f.filter)}: ${f.value}`, value: Number(f.uses) }))} />
            </details>
          )}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Devices">
          <BarList rows={devices.map((d) => ({ label: fmt.label(d.key), value: Number(d.sessions), secondary: `${fmt.pct(d.conversion_rate)} conv.` }))} />
        </Section>
        <Section title="Countries">
          <BarList rows={countries.slice(0, 12).map((d) => ({ label: d.key, value: Number(d.sessions), secondary: `${fmt.pct(d.conversion_rate)} conv.` }))} />
        </Section>
      </div>
    </>
  );
}
