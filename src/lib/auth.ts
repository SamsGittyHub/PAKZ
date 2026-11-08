import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { sessionUserId } from "@/lib/session";
import { db } from "@/lib/db";

export type AdminRole = "owner" | "staff";

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  /** Staff can't see costs, margins or profit. */
  canSeeCosts: boolean;
}

/** The signed-in admin for this request, or null. Deduped per request. */
export const getAdmin = cache(async (): Promise<AdminUser | null> => {
  const uid = await sessionUserId();
  if (!uid) return null;
  const { data: profile } = await db()
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", uid)
    .maybeSingle();
  // Removing someone's role (or deleting them) revokes access on their next request.
  if (!profile || (profile.role !== "owner" && profile.role !== "staff")) return null;
  return {
    id: uid,
    email: profile.email ?? "",
    name: profile.full_name,
    role: profile.role,
    canSeeCosts: profile.role === "owner",
  };
});

export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdmin();
  if (!admin) redirect("/login?next=/admin");
  return admin;
}

export async function requireOwner(): Promise<AdminUser> {
  const admin = await requireAdmin();
  if (admin.role !== "owner") redirect("/admin?denied=owner");
  return admin;
}

/** Throwing variant for Server Actions / Route Handlers. */
export async function assertAdmin(owner = false): Promise<AdminUser> {
  const admin = await getAdmin();
  if (!admin) throw new Error("Not authorised");
  if (owner && admin.role !== "owner") throw new Error("Owner access required");
  return admin;
}

const COST_KEYS = new Set([
  "cost", "cost_price", "unit_cost", "avg_cost", "cogs", "profit", "gross_profit", "net_profit", "margin",
  "at_cost", "potential_profit", "purchase_price", "predicted_profit", "fees", "payment_fees", "shipping_cost",
  "shipping_costs", "expenses",
]);

/** Deep-strip cost/profit fields for staff. Owners get the value untouched. */
export function redact<T>(admin: AdminUser, value: T): T {
  if (admin.canSeeCosts) return value;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).filter(([k]) => !COST_KEYS.has(k)).map(([k, x]) => [k, walk(x)]),
      );
    }
    return v;
  };
  return walk(value) as T;
}
