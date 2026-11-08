import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { requireAdmin, type AdminUser } from "@/lib/auth";
import { resolveRange, type ResolvedRange } from "@/lib/dates";

export type SearchParams = Record<string, string | string[] | undefined>;

export interface StoreSettings {
  store_name: string;
  currency: string;
  timezone: string;
  contact_email: string | null;
  shipping_rates: { name: string; price: number; free_over?: number }[];
  vat_registered: boolean;
  vat_rate: number;
  prices_include_vat: boolean;
  vat_scheme: "standard" | "margin";
  email_from: string | null;
  report_recipients: string[];
  report_weekly: boolean;
  report_monthly: boolean;
  alerts: { low_stock: boolean; big_order_threshold: number; offer_received: boolean; traffic_spike_pct: number };
  low_stock_default: number;
}

export const getSettings = cache(async (): Promise<StoreSettings> => {
  const { data, error } = await db().from("store_settings").select("*").eq("id", 1).single();
  if (error) throw new Error(`settings: ${error.message}`);
  return data as StoreSettings;
});

/** Everything a dashboard page needs: the authorised admin, settings and the resolved date range. */
export async function pageContext(searchParams: Promise<SearchParams>): Promise<{
  admin: AdminUser; settings: StoreSettings; range: ResolvedRange; params: SearchParams;
}> {
  // Authorise first: it reads cookies (request-time), so nothing below runs during prerender or for non-admins.
  const admin = await requireAdmin();
  const [settings, params] = await Promise.all([getSettings(), searchParams]);
  return { admin, settings, range: resolveRange(params, settings.timezone), params };
}

export const iso = (d: Date) => d.toISOString();
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
