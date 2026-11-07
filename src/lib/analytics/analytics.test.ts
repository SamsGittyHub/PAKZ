import { describe, expect, it } from "vitest";
import {
  denseDaily, forecastSeries, hasEnoughData, holtWinters, horizonTotal, movingAverage, projectMonth, trimLeadingZeros,
} from "./forecast";
import { predictStockouts } from "./stockout";
import { aggregateGroups, generateRecommendations, percentileRanks, type ProductMetrics, type RecoInputs } from "./recommendations";

const weekly = (weeks: number, base = 10, trend = 0) =>
  Array.from({ length: weeks * 7 }, (_, i) => base + trend * i + [0, -2, -2, -1, 1, 4, 5][i % 7]);

describe("forecast", () => {
  it("uses Holt-Winters with ≥ 8 weeks of data and recovers weekly seasonality", () => {
    const y = weekly(10);
    expect(hasEnoughData(y)).toBe(true);
    const f = forecastSeries(y, 14);
    expect(f.method).toBe("holt_winters");
    expect(f.lowData).toBe(false);
    // Day 6 of the cycle (+5) should forecast higher than day 1 (-2).
    const next = f.points.map((p) => p.value);
    const dayIndex = (h: number) => (y.length + h - 1) % 7;
    const peak = f.points.find((p) => dayIndex(p.h) === 6)!;
    const trough = f.points.find((p) => dayIndex(p.h) === 1)!;
    expect(peak.value - trough.value).toBeGreaterThan(5);
    expect(Math.abs(next.reduce((a, b) => a + b, 0) / 14 - 10.7)).toBeLessThan(1.5);
  });

  it("falls back to moving average and flags low data when sparse", () => {
    const y = [0, 0, 0, 1, 0, 2, 0, 0, 1, 3, 0, 1];
    const f = forecastSeries(y, 30);
    expect(f.method).toBe("moving_average");
    expect(f.lowData).toBe(true);
    expect(f.points).toHaveLength(30);
    expect(f.points[0].high).toBeGreaterThan(f.points[0].value);
  });

  it("never forecasts negatives and bands contain the value", () => {
    const y = weekly(9, 2, -0.03);
    const f = holtWinters(y, 90);
    for (const p of f.points) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.low).toBeLessThanOrEqual(p.value);
      expect(p.high).toBeGreaterThanOrEqual(p.value);
    }
  });

  it("damped trend keeps 90-day forecasts bounded", () => {
    const y = weekly(12, 5, 0.2);
    const f = holtWinters(y, 90);
    const last = y[y.length - 1];
    expect(f.points[89].value).toBeLessThan(last * 3);
  });

  it("horizon totals sum steps and widen with horizon", () => {
    const f = movingAverage([2, 2, 3, 1, 2, 2, 2], 30);
    const t7 = horizonTotal(f, 7);
    const t30 = horizonTotal(f, 30);
    expect(t7.value).toBeCloseTo(14, 5);
    expect(t30.high - t30.value).toBeGreaterThan(t7.high - t7.value);
  });

  it("trims leading zeros and handles empty series", () => {
    expect(trimLeadingZeros([0, 0, 3, 0, 1])).toEqual([3, 0, 1]);
    const f = forecastSeries([0, 0, 0], 7);
    expect(f.points.every((p) => p.value === 0)).toBe(true);
  });

  it("zero-fills daily series", () => {
    const { dates, y } = denseDaily(new Map([["2026-01-02", 5]]), "2026-01-01", "2026-01-03");
    expect(dates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(y).toEqual([0, 5, 0]);
  });

  it("projects the month by pace and by forecast", () => {
    const f = movingAverage([100, 100, 100, 100, 100, 100, 100], 30);
    const p = projectMonth(1000, 10, 30, f);
    expect(p.pace).toBe(3000);
    expect(p.forecast).toBeCloseTo(3000, 5);
    expect(p.forecastLow).toBeLessThanOrEqual(p.forecast);
  });
});

describe("stockout", () => {
  it("predicts days left from sell-through rate", () => {
    const [a, b] = predictStockouts(
      [
        { variant_id: "a", product_id: "p", title: "Tee", size: "M", quantity: 6, reserved_quantity: 0, low_stock_threshold: 3, units_sold: 30, first_sale: null },
        { variant_id: "b", product_id: "p", title: "Tee", size: "L", quantity: 6, reserved_quantity: 0, low_stock_threshold: 3, units_sold: 0, first_sale: null },
      ],
      30,
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(a.daysLeft).toBe(6);
    expect(a.stockoutDate).toBe("2026-01-07");
    expect(b.daysLeft).toBeNull();
  });
});

const product = (over: Partial<ProductMetrics>): ProductMetrics => ({
  id: crypto.randomUUID(), title: "Item", status: "active", category: "Sneakers", brand: "Nike", days_listed: 10,
  views: 0, views_prev: 0, view_sessions: 0, add_to_carts: 0, purchase_sessions: 0, on_hand: 1, avg_price: 100,
  avg_cost: 60, units_sold: 0, revenue: 0, profit: 0, avg_days_to_sell: null, fast_sales: 0, offers: 0, waitlist: 0,
  ...over,
});

const inputs = (products: ProductMetrics[], extra: Partial<RecoInputs> = {}): RecoInputs => ({
  window_days: 30, products, sizes: [], size_filters: [], zero_result_searches: [], waitlist_unmatched: [],
  brands: ["Nike", "Adidas", "Stussy"], categories: ["Sneakers", "Hoodies", "Tees"], ...extra,
});

describe("recommendations", () => {
  it("percentile ranks handle ties and single peers", () => {
    expect(percentileRanks([5])).toEqual([0.5]);
    expect(percentileRanks([1, 2, 3])).toEqual([0, 0.5, 1]);
    const tied = percentileRanks([1, 1, 3]);
    expect(tied[0]).toBe(tied[1]);
  });

  it("scores hot categories above cold ones", () => {
    const hot = Array.from({ length: 6 }, () =>
      product({ category: "Sneakers", views: 120, views_prev: 60, view_sessions: 100, add_to_carts: 20, purchase_sessions: 8,
        units_sold: 3, on_hand: 0, revenue: 450, profit: 150, avg_days_to_sell: 2, fast_sales: 3, status: "sold" }));
    const cold = Array.from({ length: 6 }, () =>
      product({ category: "Hoodies", brand: "Adidas", views: 20, views_prev: 40, view_sessions: 18, add_to_carts: 0,
        units_sold: 0, on_hand: 4, days_listed: 80 }));
    const groups = aggregateGroups(inputs([...hot, ...cold]), "category");
    const s = groups.find((g) => g.name === "Sneakers")!;
    const h = groups.find((g) => g.name === "Hoodies")!;
    expect(s.demand_score).toBeGreaterThan(h.demand_score);

    const recs = generateRecommendations(inputs([...hot, ...cold]), []);
    expect(recs.some((r) => r.type === "stock_more" && r.scope_value === "Sneakers")).toBe(true);
    expect(recs.some((r) => r.type === "reprice" && r.scope === "category" && r.scope_value === "Sneakers")).toBe(true);
    expect(recs.filter((r) => r.type === "clearance")).toHaveLength(6);
    for (const r of recs) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.reason.length).toBeGreaterThan(10);
    }
  });

  it("flags viewed-but-unsold listings for a price drop, never below cost", () => {
    const p = product({ views: 80, view_sessions: 60, add_to_carts: 4, days_listed: 30, avg_price: 100, avg_cost: 95 });
    const recs = generateRecommendations(inputs([p]), []);
    const r = recs.find((x) => x.type === "reprice" && x.scope_value === p.id)!;
    expect(r.data.direction).toBe("down");
    expect(r.data.suggested_price).toBeGreaterThanOrEqual(100);
  });

  it("turns unmatched zero-result searches and waitlists into no-supply recs", () => {
    const recs = generateRecommendations(
      inputs([], {
        zero_result_searches: [{ query: "corteiz cargos", searches: 12 }, { query: "nike tech", searches: 9 }],
        waitlist_unmatched: [{ brand: "Arc'teryx", category: "", keyword: "beta jacket", size: "M", signups: 4 }],
      }),
      [],
    );
    expect(recs.some((r) => r.scope === "keyword" && r.scope_value === "corteiz cargos")).toBe(true);
    // "nike tech" matches a brand we carry, so it feeds the brand score instead of a keyword rec.
    expect(recs.some((r) => r.scope === "keyword" && r.scope_value === "nike tech")).toBe(false);
    expect(recs.some((r) => r.type === "no_supply" && r.title.includes("beta jacket"))).toBe(true);
  });

  it("raises restock-now for multi-quantity variants running out within a week", () => {
    const recs = generateRecommendations(inputs([]), [
      { variant_id: "v1", product_id: "p1", title: "Box logo tee", size: "M", quantity: 2, reserved_quantity: 0, low_stock_threshold: 3,
        units_sold: 15, first_sale: null, rate: 0.5, daysLeft: 4, stockoutDate: "2026-01-05" },
      { variant_id: "v2", product_id: "p2", title: "One-off jacket", size: "L", quantity: 1, reserved_quantity: 0, low_stock_threshold: 1,
        units_sold: 1, first_sale: null, rate: 0.03, daysLeft: 3, stockoutDate: "2026-01-04" },
    ]);
    expect(recs.filter((r) => r.type === "restock").map((r) => r.scope_value)).toEqual(["v1"]);
  });

  it("ranks best sizes per category by sell-through", () => {
    const recs = generateRecommendations(
      inputs([], {
        sizes: [
          { category: "Sneakers", size: "UK 9", on_hand: 0, units_sold: 6, avg_days_to_sell: 3 },
          { category: "Sneakers", size: "UK 12", on_hand: 5, units_sold: 2, avg_days_to_sell: 40 },
          { category: "Sneakers", size: "UK 8", on_hand: 1, units_sold: 4, avg_days_to_sell: 6 },
        ],
      }),
      [],
    );
    const r = recs.find((x) => x.type === "best_sizes")!;
    expect((r.data.sizes as { size: string }[])[0].size).toBe("UK 9");
    expect(r.title).toContain("UK 9, UK 8");
  });
});
