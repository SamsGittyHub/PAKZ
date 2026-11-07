import "server-only";
import { db, must } from "@/lib/supabase/admin";
import { redact, type AdminUser } from "@/lib/auth";

export const ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled", "refunded", "partially_refunded"] as const;
export const CHANNELS = ["web", "in_person", "instagram", "vinted", "ebay", "depop", "other"] as const;

export async function listOrders(admin: AdminUser, f: { status?: string; channel?: string; from?: Date; to?: Date }) {
  let q = db()
    .from("orders")
    .select("id, number, status, channel, total, refunded_amount, payment_fees, shipping_cost, paid_at, created_at, shipped_at, tracking_number, customers(name, email, instagram_handle), order_items(quantity)")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (f.status) q = q.eq("status", f.status);
  if (f.channel) q = q.eq("channel", f.channel);
  if (f.from) q = q.gte("created_at", f.from.toISOString());
  if (f.to) q = q.lt("created_at", f.to.toISOString());
  const rows = must(await q, "orders") as unknown as {
    id: string; number: number; status: string; channel: string; total: number; refunded_amount: number; payment_fees: number;
    shipping_cost: number; paid_at: string | null; created_at: string; shipped_at: string | null; tracking_number: string | null;
    customers: { name: string | null; email: string | null; instagram_handle: string | null } | null; order_items: { quantity: number }[];
  }[];
  const now = Date.now();
  return redact(admin, rows.map((o) => ({
    id: o.id,
    number: `#${o.number}`,
    customer: o.customers?.name || o.customers?.email || (o.customers?.instagram_handle ? `@${o.customers.instagram_handle}` : "Guest"),
    email: o.customers?.email,
    status: o.status,
    channel: o.channel,
    items: o.order_items.reduce((a, i) => a + i.quantity, 0),
    total: Number(o.total) - Number(o.refunded_amount),
    fees: Number(o.payment_fees) + Number(o.shipping_cost),
    paid_at: o.paid_at ?? o.created_at,
    waiting_hours: o.status === "paid" && o.channel === "web" && !o.shipped_at && o.paid_at ? Math.floor((now - Date.parse(o.paid_at)) / 3_600_000) : null,
  })));
}

export async function getOrder(admin: AdminUser, id: string) {
  const o = must(
    await db().from("orders").select("*, customers(*), order_items(*), order_events(*), refunds(*)").eq("id", id).maybeSingle(),
    "order",
  ) as (Record<string, unknown> & {
    id: string; number: number; status: string; channel: string; total: number; subtotal: number; refunded_amount: number;
    shipping_charged: number; discount: number; tax: number; payment_fees: number; shipping_cost: number;
    stripe_payment_intent_id: string | null; shipping_address: Record<string, string> | null; carrier: string | null;
    tracking_number: string | null; paid_at: string | null; created_at: string; shipped_at: string | null; note: string | null;
    customers: { id: string; name: string | null; email: string | null; phone: string | null; instagram_handle: string | null } | null;
    order_items: { id: string; title: string; size: string | null; condition: string | null; quantity: number; unit_price: number; unit_cost: number; refunded_qty: number; product_id: string | null; variant_id: string | null }[];
    order_events: { id: number; type: string; message: string | null; created_at: string; admin_id: string | null }[];
    refunds: { id: string; amount: number; reason: string | null; restocked: boolean; created_at: string }[];
  }) | null;
  if (!o) return null;
  o.order_events.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return redact(admin, o);
}

export async function searchVariants(q: string) {
  const res = await db()
    .from("product_variants")
    .select("id, size, condition, price, quantity, products!inner(title, status)")
    .gt("quantity", 0)
    .ilike("products.title", `%${q}%`)
    .limit(20);
  return (must(res, "variants") as unknown as { id: string; size: string | null; condition: string; price: number; quantity: number; products: { title: string } }[])
    .map((v) => ({ id: v.id, label: `${v.products.title}${v.size ? ` · ${v.size}` : ""} · ${v.condition.replace(/_/g, " ")}`, price: Number(v.price), quantity: v.quantity }));
}
