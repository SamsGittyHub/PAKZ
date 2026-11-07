import { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, HandCoins, Lightbulb, PackageX, Repeat, Truck } from "lucide-react";
import { pageContext, type SearchParams } from "@/lib/admin/context";
import { getAlerts, getInventoryValue, getKpis, getTimeseries, overlayPrevious } from "@/lib/admin/overview";
import { fmt } from "@/lib/format";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { KpiCard } from "@/components/admin/KpiCard";
import { DateRangePicker } from "@/components/admin/DateRangePicker";
import { TimeSeriesChart, BarsChart } from "@/components/admin/Charts";
import { CsvButton } from "@/components/admin/CsvButton";

export default function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

async function Overview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { admin, range } = await pageContext(searchParams);
  const [kpis, prev, inventory, series, prevSeries, alerts] = await Promise.all([
    getKpis(range.from, range.to),
    getKpis(range.prevFrom, range.prevTo),
    getInventoryValue(),
    getTimeseries(range),
    range.compare ? getTimeseries(range, range.prevFrom, range.prevTo) : Promise.resolve([]),
    getAlerts(),
  ]);
  const costs = admin.canSeeCosts;
  const c = range.compare;
  // Staff never receive profit, not even inside chart data.
  const visible = series.map(({ profit, ...r }) => (costs ? { ...r, profit } : r));
  const chartData = c ? overlayPrevious(series, prevSeries, ["revenue", "sessions"]).map(({ profit, ...r }) => (costs ? { ...r, profit } : r)) : visible;
  const exportRows = visible;

  return (
    <>
      <PageHeader title="Overview" description={`${range.label} · ${fmt.date(range.fromDate)} – ${fmt.date(range.toDate)}`} actions={<DateRangePicker />} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Revenue" value={kpis.revenue} prev={prev.revenue} kind="money" compare={c} />
        {costs && <KpiCard label="Profit" value={kpis.profit} prev={prev.profit} kind="money" compare={c} hint="Before expenses" />}
        <KpiCard label="Orders" value={kpis.orders} prev={prev.orders} compare={c} />
        <KpiCard label="Units sold" value={kpis.units} prev={prev.units} compare={c} />
        <KpiCard label="Avg order value" value={kpis.aov} prev={prev.aov} kind="money" compare={c} />
        <KpiCard label="Conversion rate" value={kpis.conversion_rate} prev={prev.conversion_rate} kind="pct" compare={c} hint="Sessions that purchased" />
        <KpiCard label="Visitors" value={kpis.visitors} prev={prev.visitors} compare={c} />
        {costs
          ? <KpiCard label="Inventory value" value={inventory.at_cost} kind="money" hint={`At cost · ${fmt.money(inventory.at_retail)} at retail`} compare={false} />
          : <KpiCard label="Inventory at retail" value={inventory.at_retail} kind="money" hint={`${fmt.num(inventory.units)} units`} compare={false} />}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section
          title={costs ? "Revenue & profit" : "Revenue"}
          className="lg:col-span-2"
          actions={<CsvButton rows={exportRows} filename={`overview-${range.fromDate}-${range.toDate}`} />}
        >
          <TimeSeriesChart
            data={chartData}
            series={[
              { key: "revenue", label: "Revenue", slot: 1 },
              ...(costs ? [{ key: "profit", label: "Profit", slot: 3 }] : []),
              ...(c ? [{ key: "prev_revenue", label: "Revenue (prev. period)", slot: 1, dashed: true }] : []),
            ]}
          />
        </Section>
        <AlertsPanel alerts={alerts} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Orders">
          <BarsChart data={visible} x="bucket" series={[{ key: "orders", label: "Orders" }]} kind="num" height={200} />
        </Section>
        <Section title="Traffic">
          <TimeSeriesChart
            data={chartData}
            kind="num"
            height={200}
            series={[
              { key: "sessions", label: "Sessions", slot: 1 },
              ...(c ? [{ key: "prev_sessions", label: "Sessions (prev. period)", slot: 1, dashed: true }] : []),
            ]}
          />
        </Section>
      </div>
    </>
  );
}

function AlertsPanel({ alerts }: { alerts: Awaited<ReturnType<typeof getAlerts>> }) {
  const items = [
    { icon: PackageX, label: "Low stock", count: alerts.low_stock.length, href: "/admin/inventory?filter=low",
      detail: alerts.low_stock.slice(0, 2).map((a) => `${a.title}${a.size ? ` (${a.size})` : ""}: ${a.quantity} left`).join(" · ") },
    { icon: Clock, label: "Reserved > 24h", count: alerts.reserved_stuck.length, href: "/admin/inventory?filter=reserved",
      detail: alerts.reserved_stuck.slice(0, 2).map((a) => a.title).join(" · ") },
    { icon: HandCoins, label: "Pending offers", count: alerts.pending_offers.length, href: "/admin/offers",
      detail: alerts.pending_offers.slice(0, 2).map((o) => `${fmt.money(o.amount)} on ${o.title}`).join(" · ") },
    { icon: Truck, label: "Unshipped > 48h", count: alerts.unshipped.length, href: "/admin/orders?status=paid",
      detail: alerts.unshipped.slice(0, 3).map((o) => `#${o.number}`).join(", ") },
    { icon: Repeat, label: "New sell requests", count: alerts.sell_requests.length, href: "/admin/sell-requests",
      detail: alerts.sell_requests.slice(0, 2).map((s) => [s.brand, s.item].filter(Boolean).join(" ")).join(" · ") },
  ];
  const r = alerts.top_recommendation;
  return (
    <Section title="Needs attention">
      <ul className="space-y-1">
        {items.map(({ icon: Icon, label, count, href, detail }) => (
          <li key={label}>
            <Link href={href} className="flex items-start gap-2.5 rounded-lg p-2 hover:bg-[var(--surface-2)]" prefetch={false}>
              <Icon size={16} className={count ? "mt-0.5 text-[var(--serious)]" : "faint mt-0.5"} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{label}</span>
                  <span className={`tnum ${count ? "font-semibold" : "faint"}`}>{count}</span>
                </div>
                {count > 0 && detail && <div className="faint truncate text-xs">{detail}</div>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {r && (
        <Link href="/admin/recommendations" className="mt-3 block rounded-lg border border-[var(--border)] p-3 hover:bg-[var(--surface-2)]" prefetch={false}>
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)]"><Lightbulb size={14} aria-hidden /> Top recommendation · score {Math.round(r.score)}</div>
          <div className="mt-1 text-sm font-medium">{r.title}</div>
          <div className="faint mt-0.5 line-clamp-2 text-xs">{r.reason}</div>
        </Link>
      )}
      {items.every((i) => i.count === 0) && !r && (
        <p className="faint mt-2 flex items-center gap-1.5 text-xs"><AlertTriangle size={12} /> All clear.</p>
      )}
    </Section>
  );
}
