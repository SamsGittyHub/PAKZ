import "server-only";
import { db, must, rpc } from "@/lib/db";
import { redact, type AdminUser } from "@/lib/auth";

export async function getStock(admin: AdminUser, productId?: string) {
  const rows = await rpc<Record<string, unknown>[]>("admin_stock_overview", { p_product_id: productId ?? null });
  return redact(admin, rows);
}

export async function getAging(admin: AdminUser) {
  return redact(admin, await rpc<Record<string, unknown>[]>("admin_aging"));
}

export async function getValuation() {
  return rpc<{ category: string; units: number; skus: number; at_cost: number; at_retail: number; potential_profit: number }[]>("admin_inventory_valuation");
}

export async function getMovements(admin: AdminUser, opts: { variantId?: string; limit?: number } = {}) {
  let q = db()
    .from("inventory_movements")
    .select("id, change, reason, note, quantity_after, order_id, created_at, admin_id, product_variants(id, size, condition, products(id, title))")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.variantId) q = q.eq("variant_id", opts.variantId);
  const rows = must(await q, "movements") as unknown as {
    id: number; change: number; reason: string; note: string | null; quantity_after: number; order_id: string | null;
    created_at: string; admin_id: string | null;
    product_variants: { id: string; size: string | null; condition: string; products: { id: string; title: string } | null } | null;
  }[];
  const adminIds = [...new Set(rows.map((r) => r.admin_id).filter(Boolean))] as string[];
  const people = adminIds.length
    ? must(await db().from("profiles").select("id, email").in("id", adminIds), "profiles")
    : [];
  const who = new Map(people.map((p) => [p.id, p.email]));
  return redact(admin, rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    title: r.product_variants?.products?.title ?? "—",
    product_id: r.product_variants?.products?.id,
    variant_id: r.product_variants?.id,
    size: r.product_variants?.size,
    change: r.change,
    reason: r.reason,
    note: r.note,
    quantity_after: r.quantity_after,
    order_id: r.order_id,
    by: r.admin_id ? who.get(r.admin_id) ?? "admin" : r.order_id ? "checkout" : "system",
  })));
}

export async function getVariant(admin: AdminUser, variantId: string) {
  const v = must(
    await db().from("product_variants").select("*, products(id, title, status)").eq("id", variantId).maybeSingle(),
    "variant",
  ) as Record<string, unknown> | null;
  if (!v) return null;
  const costs = admin.canSeeCosts
    ? must(await db().from("product_costs").select("*").eq("variant_id", variantId).order("acquired_at", { ascending: false }), "costs")
    : [];
  return { variant: redact(admin, v), costs };
}
