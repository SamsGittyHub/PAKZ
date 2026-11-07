"use client";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/format";
import { TimeSeriesChart } from "@/components/admin/Charts";

interface Insight {
  views: number; view_sessions: number; add_to_carts: number; purchases: number; offers: number;
  avg_seconds_on_page: number | null;
  sources: { source: string; sessions: number }[];
  daily_views: { date: string; views: number }[];
  price_history: { changed_at: string; old_price: number | null; new_price: number; size: string | null }[];
  comparables: { title: string; size: string | null; condition: string; price: number; paid_at: string; days_to_sell: number | null }[];
}

export function ProductInsight({ productId, days = 30 }: { productId: string; days?: number }) {
  const [data, setData] = useState<Insight | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/admin/products/${productId}/insight?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => live && setData(d))
      .catch((e) => live && setErr(String(e.message)));
    return () => { live = false; };
  }, [productId, days]);

  if (err) return <p className="text-sm text-[var(--critical)]">Couldn&apos;t load insights: {err}</p>;
  if (!data) return <p className="faint text-sm">Loading…</p>;
  const conv = data.view_sessions ? data.purchases / data.view_sessions : null;
  const atcRate = data.view_sessions ? data.add_to_carts / data.view_sessions : null;
  const totalSrc = data.sources.reduce((a, s) => a + Number(s.sessions), 0);

  return (
    <div className="space-y-5 text-sm">
      <p className="faint text-xs">Last {days} days</p>
      <dl className="grid grid-cols-3 gap-3">
        {[
          ["Views", fmt.num(data.views)],
          ["Add to carts", `${fmt.num(data.add_to_carts)} (${fmt.pct(atcRate)})`],
          ["Conversion", fmt.pct(conv)],
          ["Time on page", fmt.duration(data.avg_seconds_on_page)],
          ["Offers", fmt.num(data.offers)],
          ["Purchases", fmt.num(data.purchases)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-[var(--border)] p-2">
            <dt className="faint text-xs">{k}</dt>
            <dd className="mt-0.5 font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {data.daily_views.length > 1 && (
        <div>
          <h3 className="mb-1 font-medium">Views per day</h3>
          <TimeSeriesChart data={data.daily_views} x="date" kind="num" height={140} series={[{ key: "views", label: "Views" }]} />
        </div>
      )}
      <div>
        <h3 className="mb-1 font-medium">Traffic sources</h3>
        {data.sources.length === 0 ? <p className="faint">No views yet.</p> : (
          <ul className="space-y-1">
            {data.sources.map((s) => (
              <li key={s.source} className="flex justify-between"><span className="capitalize">{s.source}</span><span className="tnum">{s.sessions} <span className="faint">({fmt.pct(Number(s.sessions) / totalSrc, 0)})</span></span></li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-1 font-medium">Price history</h3>
        {data.price_history.length === 0 ? <p className="faint">No changes.</p> : (
          <ul className="space-y-1">
            {data.price_history.map((p, i) => (
              <li key={i} className="flex justify-between">
                <span>{fmt.date(p.changed_at)}{p.size ? ` · ${p.size}` : ""}</span>
                <span className="tnum">{p.old_price != null ? `${fmt.money(p.old_price)} → ` : "Listed at "}{fmt.money(p.new_price)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-1 font-medium">Comparable sold items (same brand & category)</h3>
        {data.comparables.length === 0 ? <p className="faint">None sold in the last year.</p> : (
          <table className="table">
            <thead><tr><th>Item</th><th className="num">Sold for</th><th className="num">Days</th></tr></thead>
            <tbody>
              {data.comparables.map((c, i) => (
                <tr key={i}>
                  <td>{c.title}<div className="faint text-xs">{[c.size, fmt.label(c.condition), fmt.date(c.paid_at)].filter(Boolean).join(" · ")}</div></td>
                  <td className="num">{fmt.money(c.price)}</td>
                  <td className="num">{c.days_to_sell ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
