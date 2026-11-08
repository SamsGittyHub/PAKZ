import "server-only";
import { rpc } from "@/lib/db";
import { iso } from "./context";

export interface Pnl {
  gross_revenue: number; refunds: number; other_refunds: number; net_revenue: number; item_revenue: number; shipping_charged: number;
  payment_fees: number; shipping_costs: number; tax: number; cogs: number; gross_profit: number; expenses: number;
  net_profit: number; orders: number; units: number;
}
export interface BreakdownRow {
  key: string | null; label: string | null; revenue: number; cogs: number; fees: number; profit: number; units: number; orders: number; margin: number | null;
}
export const DIMENSIONS = ["category", "brand", "product", "size", "channel", "month"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

const n = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])) as T;

export async function getPnl(from: Date, to: Date): Promise<Pnl> {
  return n(await rpc<Pnl>("admin_pnl", { p_from: iso(from), p_to: iso(to) }));
}

export async function getBreakdown(from: Date, to: Date, dim: Dimension): Promise<BreakdownRow[]> {
  const rows = await rpc<BreakdownRow[]>("admin_breakdown", { p_from: iso(from), p_to: iso(to), p_dim: dim });
  return rows.map(n).map((r) => ({ ...r, label: r.label ?? r.key ?? "Unassigned" }));
}

export async function getDaysToSell(from: Date, to: Date) {
  return (await rpc<{ category: string; units: number; avg_days: number; median_days: number }[]>("admin_days_to_sell", { p_from: iso(from), p_to: iso(to) })).map(n);
}
