/**
 * "What should I stock?" — demand scoring and buying recommendations.
 *
 * Pure functions over the aggregates returned by the `admin_reco_inputs` RPC plus stockout predictions.
 * The nightly job persists the output into `recommendations`.
 */
import type { StockoutPrediction } from "./stockout";

export interface ProductMetrics {
  id: string;
  title: string;
  status: string;
  category: string;
  brand: string;
  days_listed: number;
  views: number;
  views_prev: number;
  view_sessions: number;
  add_to_carts: number;
  purchase_sessions: number;
  on_hand: number;
  avg_price: number | null;
  avg_cost: number | null;
  units_sold: number; // last max(window, 90) days
  revenue: number;
  profit: number;
  avg_days_to_sell: number | null;
  fast_sales: number; // sold within 3 days of listing
  offers: number;
  waitlist: number;
}

export interface SizeMetrics {
  category: string;
  size: string;
  on_hand: number;
  units_sold: number;
  avg_days_to_sell: number | null;
}

export interface RecoInputs {
  window_days: number;
  products: ProductMetrics[];
  sizes: SizeMetrics[];
  size_filters: { size: string; uses: number }[];
  zero_result_searches: { query: string; searches: number }[];
  waitlist_unmatched: { brand: string; category: string; keyword: string; size: string; signups: number }[];
  brands: string[];
  categories: string[];
}

export type RecoType =
  | "restock"
  | "stock_more"
  | "stock_less"
  | "reprice"
  | "promote"
  | "clearance"
  | "no_supply"
  | "best_sizes";

export type RecoScope = "category" | "brand" | "size" | "product" | "variant" | "keyword";

export interface Recommendation {
  type: RecoType;
  scope: RecoScope;
  scope_value: string;
  title: string;
  reason: string;
  score: number;
  data: Record<string, unknown>;
}

export interface GroupMetrics {
  scope: "category" | "brand";
  name: string;
  products: number;
  views: number;
  views_prev: number;
  view_sessions: number;
  add_to_carts: number;
  purchase_sessions: number;
  on_hand: number;
  units_sold: number;
  revenue: number;
  profit: number;
  avg_days_to_sell: number | null;
  fast_sales: number;
  offers: number;
  waitlist: number;
  zero_result_searches: number;
  // derived
  views_trend: number;
  atc_rate: number;
  conversion: number;
  sell_through: number;
  margin: number;
  demand_score: number;
  components: Record<string, number>;
}

/** Weights for the demand score. Sum = 1. */
export const DEMAND_WEIGHTS = {
  views_trend: 0.1,
  atc_rate: 0.14,
  conversion: 0.14,
  sell_through: 0.16,
  speed: 0.14,
  margin: 0.1,
  waitlist: 0.08,
  offers: 0.06,
  zero_results: 0.08,
} as const;

const MIN_VIEWS_FOR_CONFIDENCE = 25;

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Percentile rank in [0,1]; ties share the average rank; a single peer gets 0.5. */
export function percentileRanks(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 0.5);
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    let lo = 0;
    while (lo < sorted.length && sorted[lo] < v) lo++;
    let hi = lo;
    while (hi < sorted.length && sorted[hi] === v) hi++;
    const avgRank = (lo + hi - 1) / 2;
    return avgRank / (sorted.length - 1);
  });
}

function matchesQuery(name: string, query: string): boolean {
  const n = name.toLowerCase().trim();
  if (n.length < 2) return false;
  const q = ` ${query.toLowerCase()} `;
  return q.includes(` ${n} `) || q.includes(` ${n}s `) || q.trim().startsWith(n);
}

export function aggregateGroups(inputs: RecoInputs, scope: "category" | "brand"): GroupMetrics[] {
  const groups = new Map<string, GroupMetrics>();
  const names = scope === "category" ? inputs.categories : inputs.brands;
  const ensure = (name: string): GroupMetrics => {
    let g = groups.get(name);
    if (!g) {
      g = {
        scope, name, products: 0, views: 0, views_prev: 0, view_sessions: 0, add_to_carts: 0, purchase_sessions: 0,
        on_hand: 0, units_sold: 0, revenue: 0, profit: 0, avg_days_to_sell: null, fast_sales: 0, offers: 0,
        waitlist: 0, zero_result_searches: 0, views_trend: 0, atc_rate: 0, conversion: 0, sell_through: 0,
        margin: 0, demand_score: 0, components: {},
      };
      groups.set(name, g);
    }
    return g;
  };
  names.forEach((n) => n && ensure(n));

  const daysWeighted = new Map<string, { sum: number; units: number }>();
  for (const p of inputs.products) {
    const name = scope === "category" ? p.category : p.brand;
    if (!name) continue;
    const g = ensure(name);
    g.products++;
    g.views += p.views;
    g.views_prev += p.views_prev;
    g.view_sessions += p.view_sessions;
    g.add_to_carts += p.add_to_carts;
    g.purchase_sessions += p.purchase_sessions;
    g.on_hand += p.on_hand;
    g.units_sold += p.units_sold;
    g.revenue += Number(p.revenue);
    g.profit += Number(p.profit);
    g.fast_sales += p.fast_sales;
    g.offers += p.offers;
    g.waitlist += p.waitlist;
    if (p.avg_days_to_sell != null && p.units_sold > 0) {
      const d = daysWeighted.get(name) ?? { sum: 0, units: 0 };
      d.sum += Number(p.avg_days_to_sell) * p.units_sold;
      d.units += p.units_sold;
      daysWeighted.set(name, d);
    }
  }
  for (const w of inputs.waitlist_unmatched) {
    const name = scope === "category" ? w.category : w.brand;
    if (name && groups.has(name)) groups.get(name)!.waitlist += w.signups;
  }
  for (const s of inputs.zero_result_searches) {
    for (const g of groups.values()) if (matchesQuery(g.name, s.query)) g.zero_result_searches += s.searches;
  }

  const list = [...groups.values()];
  for (const g of list) {
    const d = daysWeighted.get(g.name);
    g.avg_days_to_sell = d && d.units > 0 ? round(d.sum / d.units, 1) : null;
    g.views_trend = Math.max(-1, Math.min(2, safeDiv(g.views - g.views_prev, Math.max(g.views_prev, 1))));
    g.atc_rate = safeDiv(g.add_to_carts, g.view_sessions);
    g.conversion = safeDiv(g.purchase_sessions, g.view_sessions);
    g.sell_through = safeDiv(g.units_sold, g.units_sold + g.on_hand);
    g.margin = safeDiv(g.profit, g.revenue);
  }
  scoreGroups(list);
  return list;
}

/** Demand score 0–100: weighted percentile ranks, shrunk toward 50 when traffic is too thin to trust. */
export function scoreGroups(groups: GroupMetrics[]): void {
  const features: Record<keyof typeof DEMAND_WEIGHTS, number[]> = {
    views_trend: groups.map((g) => g.views_trend),
    atc_rate: groups.map((g) => g.atc_rate),
    conversion: groups.map((g) => g.conversion),
    sell_through: groups.map((g) => g.sell_through),
    // faster = higher; unknown speed sits at the bottom
    speed: groups.map((g) => (g.avg_days_to_sell == null ? -1 : 1 / (1 + g.avg_days_to_sell))),
    margin: groups.map((g) => g.margin),
    waitlist: groups.map((g) => g.waitlist),
    offers: groups.map((g) => g.offers),
    zero_results: groups.map((g) => g.zero_result_searches),
  };
  const ranks = Object.fromEntries(
    Object.entries(features).map(([k, v]) => [k, percentileRanks(v)]),
  ) as Record<keyof typeof DEMAND_WEIGHTS, number[]>;

  groups.forEach((g, i) => {
    let raw = 0;
    const components: Record<string, number> = {};
    for (const k of Object.keys(DEMAND_WEIGHTS) as (keyof typeof DEMAND_WEIGHTS)[]) {
      components[k] = round(ranks[k][i], 3);
      raw += DEMAND_WEIGHTS[k] * ranks[k][i];
    }
    const confidence = Math.min(1, (g.views + g.units_sold * 10) / MIN_VIEWS_FOR_CONFIDENCE);
    g.demand_score = round(100 * (0.5 + (raw - 0.5) * confidence), 1);
    g.components = components;
  });
}

function groupNumbers(g: GroupMetrics) {
  return {
    demand_score: g.demand_score,
    views_30d: g.views,
    views_prev_30d: g.views_prev,
    add_to_cart_rate: round(g.atc_rate, 4),
    conversion_rate: round(g.conversion, 4),
    sell_through: round(g.sell_through, 4),
    avg_days_to_sell: g.avg_days_to_sell,
    margin: round(g.margin, 4),
    on_hand: g.on_hand,
    units_sold: g.units_sold,
    waitlist: g.waitlist,
    offers: g.offers,
    zero_result_searches: g.zero_result_searches,
    components: g.components,
  };
}

export function generateRecommendations(inputs: RecoInputs, stockouts: StockoutPrediction[]): Recommendation[] {
  const recs: Recommendation[] = [];
  const W = inputs.window_days;
  const groups = [...aggregateGroups(inputs, "category"), ...aggregateGroups(inputs, "brand")];

  for (const g of groups) {
    const label = g.scope === "category" ? g.name : `${g.name} (brand)`;
    const restockFloor = Math.max(2, Math.ceil(g.units_sold * 0.25));

    // STOCK MORE — strong demand, sells through fast, little left.
    const stockMore = g.demand_score >= 65 && g.sell_through >= 0.5 && g.units_sold >= 2 && g.on_hand <= restockFloor;
    if (stockMore) {
      recs.push({
        type: "stock_more", scope: g.scope, scope_value: g.name,
        title: `Stock more ${label}`,
        reason: `${label} has a demand score of ${Math.round(g.demand_score)}/100: ${pct(g.sell_through)} sell-through` +
          (g.avg_days_to_sell != null ? `, selling in ${g.avg_days_to_sell} days on average` : "") +
          `, and only ${g.on_hand} left in stock.`,
        score: g.demand_score,
        data: groupNumbers(g),
      });
    }

    // HIGH INTEREST, NO SUPPLY — people want it, nothing listed.
    const interest = g.views + g.waitlist * 10 + g.zero_result_searches * 5;
    if (!stockMore && g.on_hand === 0 && (g.views >= 40 || g.waitlist >= 3 || g.zero_result_searches >= 5)) {
      recs.push({
        type: "no_supply", scope: g.scope, scope_value: g.name,
        title: `High interest, no stock: ${label}`,
        reason: `Nothing in stock for ${label}, but in the last ${W} days it had ${g.views} views, ` +
          `${g.waitlist} waitlist signups and ${g.zero_result_searches} searches that found nothing.`,
        score: Math.min(100, 50 + Math.log2(1 + interest) * 6),
        data: groupNumbers(g),
      });
    }

    // REPRICE UP — consistently sells in under 3 days.
    if (g.units_sold >= 3 && g.fast_sales / g.units_sold >= 0.7) {
      recs.push({
        type: "reprice", scope: g.scope, scope_value: g.name,
        title: `Raise prices on ${label}`,
        reason: `${g.fast_sales} of ${g.units_sold} recent ${label} sales went within 3 days of listing — ` +
          `it's likely underpriced. Try +5–10% on new listings.`,
        score: 55 + 40 * (g.fast_sales / g.units_sold) * Math.min(1, g.units_sold / 8),
        data: { ...groupNumbers(g), direction: "up", fast_sales: g.fast_sales, suggested_change_pct: 7.5 },
      });
    }

    // STOCK LESS — slow and thin-margin.
    const slow = (g.avg_days_to_sell != null && g.avg_days_to_sell > 45) || (g.on_hand >= 3 && g.sell_through < 0.2);
    if (slow && g.margin < 0.15 && g.units_sold + g.on_hand >= 3) {
      recs.push({
        type: "stock_less", scope: g.scope, scope_value: g.name,
        title: `Buy less ${label}`,
        reason: `${label} is slow (${g.avg_days_to_sell ?? "no"} avg days to sell, ${pct(g.sell_through)} sell-through) ` +
          `and earns just ${pct(g.margin)} margin. Capital is better spent elsewhere.`,
        score: 40 + 40 * (1 - Math.max(0, g.margin) / 0.15),
        data: groupNumbers(g),
      });
    }
  }

  // Product-level pricing & clearance.
  for (const p of inputs.products) {
    if (p.status !== "active" || p.on_hand <= 0) continue;
    const numbers = {
      views_30d: p.views, add_to_carts: p.add_to_carts, offers: p.offers, days_listed: p.days_listed,
      price: p.avg_price, cost: p.avg_cost, on_hand: p.on_hand, units_sold: p.units_sold,
    };
    const price = Number(p.avg_price ?? 0);
    const cost = Number(p.avg_cost ?? 0);
    const floor = Math.ceil(cost * 1.05);

    if (p.days_listed >= 60) {
      const markdown = p.days_listed >= 90 ? 25 : 15;
      recs.push({
        type: "clearance", scope: "product", scope_value: p.id,
        title: `Clear out: ${p.title}`,
        reason: `Listed ${p.days_listed} days with ${p.units_sold} sold and ${p.views} views in ${W} days. ` +
          `Mark down ~${markdown}%` + (cost > 0 ? " — the suggested price stays above cost." : "."),
        score: Math.min(72, 42 + (p.days_listed - 60) / 3),
        data: { ...numbers, suggested_markdown_pct: markdown, suggested_price: Math.max(Math.round(price * (1 - markdown / 100)), floor) },
      });
    } else if (p.views >= 30 && p.units_sold === 0 && p.days_listed >= 21) {
      recs.push({
        type: "reprice", scope: "product", scope_value: p.id,
        title: `Lower price: ${p.title}`,
        reason: `${p.views} views and ${p.add_to_carts} add-to-carts in ${W} days but no sale after ${p.days_listed} days — ` +
          `people are interested but the price isn't landing.` + (p.offers > 0 ? ` ${p.offers} offers received.` : ""),
        score: Math.min(82, 42 + Math.log2(p.views) * 4),
        data: { ...numbers, direction: "down", suggested_change_pct: -10, suggested_price: Math.max(Math.round(price * 0.9), floor) },
      });
    } else if (p.fast_sales >= 2 && p.on_hand > 0) {
      recs.push({
        type: "reprice", scope: "product", scope_value: p.id,
        title: `Raise price: ${p.title}`,
        reason: `${p.fast_sales} units of this sold within 3 days of listing. Try a higher price on the remaining ${p.on_hand}.`,
        score: 60 + Math.min(30, p.fast_sales * 5),
        data: { ...numbers, direction: "up", suggested_change_pct: 10, suggested_price: Math.round(price * 1.1) },
      });
    }
  }

  // PROMOTE — converts well but under-seen.
  const active = inputs.products.filter((p) => p.status === "active" && p.on_hand > 0 && p.view_sessions >= 5);
  if (active.length >= 5) {
    const sortedViews = active.map((p) => p.views).sort((a, b) => a - b);
    const medianViews = sortedViews[Math.floor(sortedViews.length / 2)];
    const overallConv = safeDiv(
      active.reduce((a, p) => a + p.purchase_sessions + p.add_to_carts * 0.3, 0),
      active.reduce((a, p) => a + p.view_sessions, 0),
    );
    for (const p of active) {
      const conv = safeDiv(p.purchase_sessions + p.add_to_carts * 0.3, p.view_sessions);
      if (p.views < medianViews && conv >= overallConv * 2 && conv > 0) {
        recs.push({
          type: "promote", scope: "product", scope_value: p.id,
          title: `Promote: ${p.title}`,
          reason: `Converts ${round(conv / Math.max(overallConv, 1e-9), 1)}× better than average but gets fewer views than most listings. ` +
            `Feature it or post it on Instagram/TikTok.`,
          score: Math.min(85, 50 + 10 * (conv / Math.max(overallConv, 1e-9))),
          data: { views_30d: p.views, view_sessions: p.view_sessions, add_to_carts: p.add_to_carts, purchase_sessions: p.purchase_sessions },
        });
      }
    }
  }

  // RESTOCK NOW — predicted stockout within 7 days (multi-quantity lines only).
  for (const s of stockouts) {
    if (s.daysLeft == null || s.low_stock_threshold <= 1) continue;
    if (s.daysLeft <= 7) {
      const label = `${s.title}${s.size ? ` (${s.size})` : ""}`;
      recs.push({
        type: "restock", scope: "variant", scope_value: s.variant_id,
        title: `Restock now: ${label}`,
        reason: s.quantity === 0
          ? `Sold out — it was selling ${round(s.rate * 7, 1)} per week.`
          : `${s.quantity} left, selling ${round(s.rate * 7, 1)} per week — runs out in about ${Math.max(1, Math.round(s.daysLeft))} days (${s.stockoutDate}).`,
        score: Math.min(100, 70 + (7 - s.daysLeft) * 4),
        data: { quantity: s.quantity, units_sold_window: s.units_sold, per_week: round(s.rate * 7, 2), days_left: round(s.daysLeft, 1), stockout_date: s.stockoutDate, product_id: s.product_id },
      });
    }
  }

  // HIGH INTEREST, NO SUPPLY — keyword-level, from zero-result searches not matching any brand/category we carry.
  const known = [...inputs.brands, ...inputs.categories];
  for (const s of inputs.zero_result_searches) {
    if (s.searches < 5 || known.some((k) => matchesQuery(k, s.query))) continue;
    recs.push({
      type: "no_supply", scope: "keyword", scope_value: s.query,
      title: `People are searching for "${s.query}"`,
      reason: `"${s.query}" was searched ${s.searches} times in ${W} days with zero results. Consider sourcing it.`,
      score: Math.min(90, 45 + Math.log2(s.searches) * 8),
      data: { searches: s.searches },
    });
  }
  for (const w of inputs.waitlist_unmatched) {
    const what = [w.brand, w.keyword, w.category].filter(Boolean).join(" ");
    if (w.signups < 3 || !what) continue;
    recs.push({
      type: "no_supply", scope: "keyword", scope_value: `${what}${w.size ? ` · ${w.size}` : ""}`.toLowerCase(),
      title: `Waitlist demand: ${what}${w.size ? ` in ${w.size}` : ""}`,
      reason: `${w.signups} people joined the waitlist for ${what}${w.size ? ` in ${w.size}` : ""} in ${W} days.`,
      score: Math.min(90, 50 + w.signups * 4),
      data: { ...w },
    });
  }

  // BEST SIZES per category.
  const filterUses = new Map(inputs.size_filters.map((f) => [f.size, f.uses]));
  const totalFilterUses = inputs.size_filters.reduce((a, f) => a + f.uses, 0);
  const byCategory = new Map<string, SizeMetrics[]>();
  for (const s of inputs.sizes) {
    if (!s.category) continue;
    byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s]);
  }
  for (const [category, sizes] of byCategory) {
    const scored = sizes
      .filter((s) => s.units_sold >= 2)
      .map((s) => {
        const sellThrough = safeDiv(s.units_sold, s.units_sold + s.on_hand);
        const speed = s.avg_days_to_sell == null ? 0 : 1 / (1 + s.avg_days_to_sell / 7);
        const filterShare = safeDiv(filterUses.get(s.size) ?? 0, totalFilterUses);
        return { ...s, sellThrough, score: 0.6 * sellThrough + 0.25 * speed + 0.15 * Math.min(1, filterShare * 5) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (scored.length === 0) continue;
    recs.push({
      type: "best_sizes", scope: "category", scope_value: category,
      title: `Best sizes to buy in ${category}: ${scored.map((s) => s.size).join(", ")}`,
      reason: scored
        .map((s) => `${s.size}: ${pct(s.sellThrough)} sell-through, ${s.units_sold} sold` + (s.avg_days_to_sell != null ? `, ${s.avg_days_to_sell}d to sell` : ""))
        .join("; ") + ".",
      score: round(50 + 45 * scored[0].score, 1),
      data: { sizes: scored.map((s) => ({ size: s.size, sell_through: round(s.sellThrough, 3), units_sold: s.units_sold, on_hand: s.on_hand, avg_days_to_sell: s.avg_days_to_sell })) },
    });
  }

  return recs.map((r) => ({ ...r, score: round(Math.max(0, Math.min(100, r.score)), 1) }));
}

export function recoKey(r: Pick<Recommendation, "type" | "scope" | "scope_value">): string {
  return `${r.type}|${r.scope}|${r.scope_value}`;
}
