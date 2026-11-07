import { Suspense } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { getSettings, iso, one, type SearchParams } from "@/lib/admin/context";
import { requireOwner } from "@/lib/auth";
import { resolveRange, rangeQuery, localDate } from "@/lib/dates";
import { DIMENSIONS, getBreakdown, getDaysToSell, getPnl, type Dimension } from "@/lib/admin/revenue";
import { db, must } from "@/lib/supabase/admin";
import { fmt } from "@/lib/format";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { KpiCard } from "@/components/admin/KpiCard";
import { DateRangePicker } from "@/components/admin/DateRangePicker";
import { DataTable } from "@/components/admin/DataTable";
import { BarsChart } from "@/components/admin/Charts";
import { BarList } from "@/components/admin/BarList";
import { Expenses } from "./Expenses";

export default function RevenuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Suspense fallback={<PageSkeleton />}><Revenue searchParams={searchParams} /></Suspense>;
}

async function Revenue({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireOwner();
  const [settings, params] = await Promise.all([getSettings(), searchParams]);
  const range = resolveRange(params, settings.timezone);
  const dimParam = one(params.dim) as Dimension | undefined;
  const dim: Dimension = dimParam && DIMENSIONS.includes(dimParam) ? dimParam : "category";

  const [pnl, prev, breakdown, products, days, expenses] = await Promise.all([
    getPnl(range.from, range.to),
    getPnl(range.prevFrom, range.prevTo),
    getBreakdown(range.from, range.to, dim),
    dim === "product" ? Promise.resolve(null) : getBreakdown(range.from, range.to, "product"),
    getDaysToSell(range.from, range.to),
    db().from("expenses").select("*").gte("date", range.fromDate).lte("date", range.toDate).order("date", { ascending: false }),
  ]);
  const productRows = products ?? breakdown;
  const ranked = [...productRows].filter((r) => r.units > 0).sort((a, b) => b.profit - a.profit);
  const best = ranked.slice(0, 8);
  const worst = ranked.slice(-8).reverse().filter((r) => !best.includes(r));
  const margin = pnl.net_revenue ? pnl.net_profit / pnl.net_revenue : null;
  const prevMargin = prev.net_revenue ? prev.net_profit / prev.net_revenue : null;
  const q = rangeQuery(range);
  const c = range.compare;

  const waterfall: [string, number, boolean?][] = [
    ["Gross revenue (items + shipping)", pnl.gross_revenue],
    ["Refunds", -pnl.refunds],
    ["Net revenue", pnl.net_revenue, true],
    ["Cost of goods", -pnl.cogs],
    ["Payment fees (Stripe / platforms)", -pnl.payment_fees],
    ["Shipping costs", -pnl.shipping_costs],
    ...(pnl.tax ? [["VAT / tax", -pnl.tax] as [string, number]] : []),
    ["Gross profit", pnl.gross_profit, true],
    ["Expenses", -pnl.expenses],
    ["Net profit", pnl.net_profit, true],
  ];

  return (
    <>
      <PageHeader
        title="Revenue & profit"
        description={`${range.label} · ${fmt.date(range.fromDate)} – ${fmt.date(range.toDate)}`}
        actions={<>
          <DateRangePicker />
          <a className="btn" href={`/api/admin/export?dataset=pnl&format=xlsx&${q}`}><Download size={14} /> XLSX</a>
          <a className="btn" href={`/api/admin/export?dataset=sales&${q}`}><Download size={14} /> Sales CSV</a>
        </>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Net revenue" value={pnl.net_revenue} prev={prev.net_revenue} kind="money" compare={c} />
        <KpiCard label="Gross profit" value={pnl.gross_profit} prev={prev.gross_profit} kind="money" compare={c} />
        <KpiCard label="Net profit" value={pnl.net_profit} prev={prev.net_profit} kind="money" compare={c} hint="After expenses" />
        <KpiCard label="Net margin" value={margin} prev={prevMargin} kind="pct" compare={c} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title="Profit & loss">
          <dl className="space-y-1.5 text-sm">
            {waterfall.map(([k, v, total]) => (
              <div key={k} className={`flex justify-between ${total ? "border-t border-[var(--border)] pt-1.5 font-semibold" : ""}`}>
                <dt className={total ? "" : "muted"}>{k}</dt><dd className="tnum">{fmt.money2(v)}</dd>
              </div>
            ))}
          </dl>
          <p className="faint mt-3 text-xs">{fmt.num(pnl.orders)} orders · {fmt.num(pnl.units)} units. COGS uses the weighted-average cost at the time of sale.</p>
        </Section>
        <Section title="Breakdown" className="lg:col-span-2" actions={
          <nav className="flex flex-wrap gap-1" aria-label="Breakdown dimension">
            {DIMENSIONS.map((d) => (
              <Link key={d} href={`/admin/revenue?${q}&dim=${d}`} className={`btn btn-sm ${d === dim ? "btn-primary" : ""}`} aria-current={d === dim ? "true" : undefined}>{fmt.label(d)}</Link>
            ))}
          </nav>
        }>
          {dim === "month" ? (
            <BarsChart data={[...breakdown].sort((a, b) => String(a.key).localeCompare(String(b.key)))} x="label" series={[{ key: "revenue", label: "Revenue", slot: 1 }, { key: "profit", label: "Profit", slot: 3 }]} height={220} />
          ) : (
            <BarList rows={breakdown.slice(0, 10).map((r) => ({ label: r.label ?? "—", value: r.profit, secondary: `${fmt.pct(r.margin)} margin`, href: dim === "product" && r.key ? `/admin/products/${r.key}` : undefined }))} kind="money" secondary="Profit · margin" />
          )}
          <div className="mt-4">
            <DataTable
              data={breakdown}
              rowKey="label"
              filename={`breakdown-${dim}-${range.fromDate}`}
              initialSort={{ key: "profit", desc: true }}
              columns={[
                { key: "label", header: fmt.label(dim), ...(dim === "product" ? { href: "/admin/products/{key}" } : {}) },
                { key: "units", header: "Units", type: "num" },
                { key: "revenue", header: "Revenue", type: "money" },
                { key: "cogs", header: "COGS", type: "money", hideMobile: true },
                { key: "fees", header: "Fees + ship", type: "money", hideMobile: true },
                { key: "profit", header: "Profit", type: "money" },
                { key: "margin", header: "Margin", type: "pct" },
              ]}
            />
          </div>
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title="Best performers by profit">
          <BarList rows={best.map((r) => ({ label: r.label ?? "—", value: r.profit, href: r.key ? `/admin/products/${r.key}` : undefined, secondary: fmt.pct(r.margin, 0) }))} kind="money" />
        </Section>
        <Section title="Worst performers by profit">
          {worst.length === 0 ? <p className="faint text-sm">Not enough sales.</p> : (
            <ul className="space-y-1.5 text-sm">
              {worst.map((r) => (
                <li key={r.key ?? r.label} className="flex justify-between gap-3">
                  <Link href={`/admin/products/${r.key}`} className="truncate hover:underline">{r.label}</Link>
                  <span className={`tnum shrink-0 ${r.profit < 0 ? "text-[var(--critical)]" : ""}`}>{fmt.money(r.profit)} <span className="faint text-xs">{fmt.pct(r.margin, 0)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Average days to sell">
          <BarList rows={days.map((d) => ({ label: d.category, value: Number(d.avg_days), secondary: `median ${d.median_days} · ${d.units} sold` }))} kind="num" />
        </Section>
      </div>

      <Section title="Expense log" className="mt-4" actions={<span className="faint text-xs">Included in net profit · {fmt.money2(pnl.expenses)} this period</span>}>
        <Expenses rows={must(expenses, "expenses")} today={localDate(settings.timezone)} />
      </Section>
      <p className="faint mt-3 text-xs">Range {iso(range.from).slice(0, 10)} → {iso(range.to).slice(0, 10)} (store time: {settings.timezone}).</p>
    </>
  );
}
