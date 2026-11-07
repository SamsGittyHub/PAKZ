import "server-only";
import { rpc } from "@/lib/supabase/admin";
import type { ResolvedRange } from "@/lib/dates";
import { iso } from "./context";

export interface Kpis {
  revenue: number; profit: number; cogs: number; orders: number; units: number; aov: number;
  sessions: number; visitors: number; conversion_rate: number;
}
export interface InventoryValue { units: number; skus: number; at_cost: number; at_retail: number; potential_profit: number }
export interface TimePoint {
  bucket: string; revenue: number; profit: number; orders: number; units: number; sessions: number; visitors: number; page_views: number;
}
export interface Alerts {
  low_stock: { variant_id: string; product_id: string; title: string; size: string | null; quantity: number; low_stock_threshold: number }[];
  reserved_stuck: { variant_id: string; product_id: string; title: string; size: string | null; reserved_quantity: number; reserved_since: string }[];
  pending_offers: { id: string; amount: number; email: string; created_at: string; title: string; product_id: string }[];
  unshipped: { id: string; number: number; paid_at: string; total: number }[];
  sell_requests: { id: string; name: string; brand: string | null; item: string; asking_price: number | null; created_at: string }[];
  top_recommendation: { id: string; type: string; title: string; reason: string; score: number } | null;
}

const num = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])) as T;

export async function getKpis(from: Date, to: Date): Promise<Kpis> {
  return num(await rpc<Kpis>("admin_kpis", { p_from: iso(from), p_to: iso(to) }));
}

export async function getInventoryValue(): Promise<InventoryValue> {
  return num(await rpc<InventoryValue>("admin_inventory_value"));
}

export async function getTimeseries(range: ResolvedRange, from = range.from, to = range.to): Promise<TimePoint[]> {
  const rows = await rpc<TimePoint[]>("admin_timeseries", { p_from: iso(from), p_to: iso(to), p_bucket: range.bucket });
  return rows.map(num);
}

export async function getAlerts(): Promise<Alerts> {
  return rpc<Alerts>("admin_alerts", { p_unshipped_hours: 48 });
}

/** Merge current and previous period series by index for a "vs previous" overlay. */
export function overlayPrevious(cur: TimePoint[], prev: TimePoint[], keys: (keyof TimePoint)[]) {
  return cur.map((p, i) => {
    const row: Record<string, unknown> = { ...p };
    for (const k of keys) row[`prev_${k}`] = prev[i]?.[k] ?? null;
    return row;
  });
}
