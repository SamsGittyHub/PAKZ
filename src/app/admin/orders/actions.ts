"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { db, must } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { esc, sendEmail, shippedEmail, trackingUrl } from "@/lib/email";
import { stripe, toMinor } from "@/lib/stripe";
import { searchVariants as search } from "@/lib/admin/orders";
import { CHANNELS } from "@/lib/admin/orders";

type Result<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({
  ok: false, error: e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : e instanceof Error ? e.message : String(e),
});

async function storeName() {
  const { data } = await db().from("store_settings").select("store_name").eq("id", 1).single();
  return data?.store_name ?? "PAKZ";
}

export async function markShipped(input: { orderId: string; carrier: string; tracking: string; notify: boolean }): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const o = must(await db().from("orders").select("id, number, status, customers(name, email)").eq("id", input.orderId).single(), "order") as unknown as {
      id: string; number: number; status: string; customers: { name: string | null; email: string | null } | null;
    };
    must(await db().from("orders").update({
      status: "shipped", shipped_at: new Date().toISOString(), carrier: input.carrier || null, tracking_number: input.tracking || null,
    }).eq("id", o.id).select("id"), "update order");
    await db().from("order_events").insert({ order_id: o.id, type: "shipped", message: `Shipped${input.carrier ? ` via ${input.carrier}` : ""}${input.tracking ? ` · ${input.tracking}` : ""}`, admin_id: admin.id });

    let message = "Marked shipped";
    if (input.notify && o.customers?.email) {
      const mail = shippedEmail({ number: o.number, name: o.customers.name, carrier: input.carrier, tracking: input.tracking, trackingUrl: trackingUrl(input.carrier, input.tracking), store: await storeName() });
      const sent = await sendEmail({ to: o.customers.email, ...mail });
      await db().from("order_events").insert({ order_id: o.id, type: "email_sent", message: sent ? `Shipping email sent to ${o.customers.email}` : "Shipping email not sent (email not configured)", admin_id: admin.id });
      message += sent ? " · customer emailed" : " · email not configured";
    }
    await audit(admin, "order.ship", "order", o.id, input);
    refresh();
    return { ok: true, message };
  } catch (e) { return fail(e); }
}

export async function setOrderStatus(orderId: string, status: "delivered" | "cancelled" | "paid"): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const patch: Record<string, unknown> = { status };
    if (status === "delivered") patch.delivered_at = new Date().toISOString();
    must(await db().from("orders").update(patch).eq("id", orderId).select("id"), "status");
    await db().from("order_events").insert({ order_id: orderId, type: "status", message: `Status → ${status}`, admin_id: admin.id });
    await audit(admin, "order.status", "order", orderId, { status });
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function addOrderNote(orderId: string, text: string): Promise<Result> {
  try {
    const admin = await assertAdmin();
    if (!text.trim()) throw new Error("Note is empty");
    await db().from("order_events").insert({ order_id: orderId, type: "note", message: text.trim().slice(0, 2000), admin_id: admin.id });
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

const Refund = z.object({
  orderId: z.string().uuid(),
  amount: z.coerce.number().positive("Enter a refund amount"),
  items: z.array(z.object({ order_item_id: z.string().uuid(), quantity: z.coerce.number().int().min(1) })).default([]),
  restock: z.boolean(),
  reason: z.string().max(500).optional(),
});

/** Full/partial refund. Web orders are refunded through Stripe first; the ledger is updated only if that succeeds. */
export async function refundOrder(input: z.input<typeof Refund>): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const r = Refund.parse(input);
    const o = must(await db().from("orders").select("id, channel, total, refunded_amount, stripe_payment_intent_id").eq("id", r.orderId).single(), "order");
    if (r.amount > Number(o.total) - Number(o.refunded_amount) + 0.005) throw new Error("Refund exceeds the remaining order total");

    let stripeRefundId: string | null = null;
    if (o.stripe_payment_intent_id) {
      const refund = await stripe().refunds.create(
        { payment_intent: o.stripe_payment_intent_id, amount: toMinor(r.amount), reason: "requested_by_customer", metadata: { order_id: o.id } },
        { idempotencyKey: `refund-${o.id}-${toMinor(Number(o.refunded_amount))}-${toMinor(r.amount)}` },
      );
      stripeRefundId = refund.id;
    }
    const { error } = await db().rpc("record_refund", {
      p_order_id: o.id, p_amount: r.amount, p_items: r.items, p_restock: r.restock, p_reason: r.reason ?? null,
      p_stripe_refund_id: stripeRefundId, p_admin_id: admin.id,
    });
    if (error) throw new Error(`${error.message}${stripeRefundId ? ` — Stripe refund ${stripeRefundId} WAS issued; reconcile manually.` : ""}`);
    await audit(admin, "order.refund", "order", o.id, { ...r, stripeRefundId });
    refresh();
    return { ok: true, message: stripeRefundId ? `Refunded via Stripe (${stripeRefundId})` : "Refund recorded" };
  } catch (e) { return fail(e); }
}

const ManualSale = z.object({
  channel: z.enum(CHANNELS),
  paid_at: z.string().optional(),
  customer: z.object({ email: z.string().email().optional().or(z.literal("")), name: z.string().optional(), instagram: z.string().optional() }),
  items: z.array(z.object({ variant_id: z.string().uuid(), quantity: z.coerce.number().int().min(1), unit_price: z.coerce.number().min(0) })).min(1, "Add at least one item"),
  shipping_charged: z.coerce.number().min(0).default(0),
  shipping_cost: z.coerce.number().min(0).default(0),
  payment_fees: z.coerce.number().min(0).default(0),
  external_ref: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
  mark_shipped: z.boolean().default(false),
});

/** Record an offline/marketplace sale so all revenue lives in one place. */
export async function recordManualSale(input: z.input<typeof ManualSale>): Promise<Result<{ id: string }>> {
  try {
    const admin = await assertAdmin();
    const s = ManualSale.parse(input);
    let customerId: string | null = null;
    const email = s.customer.email?.trim().toLowerCase() || null;
    const ig = s.customer.instagram?.replace(/^@/, "").trim() || null;
    if (email) {
      const c = must(await db().from("customers").upsert({ email, name: s.customer.name || null, ...(ig ? { instagram_handle: ig } : {}) }, { onConflict: "email" }).select("id").single(), "customer");
      customerId = c.id;
    } else if (s.customer.name || ig) {
      const existing = ig ? (await db().from("customers").select("id").eq("instagram_handle", ig).maybeSingle()).data : null;
      customerId = existing?.id ?? must(await db().from("customers").insert({ name: s.customer.name || null, instagram_handle: ig }).select("id").single(), "customer").id;
    }
    const { data, error } = await db().rpc("record_sale", {
      p_channel: s.channel, p_items: s.items, p_customer_id: customerId,
      p_shipping_charged: s.shipping_charged, p_shipping_cost: s.shipping_cost, p_payment_fees: s.payment_fees,
      p_paid_at: s.paid_at ? new Date(s.paid_at).toISOString() : new Date().toISOString(),
      p_external_ref: s.external_ref || null, p_note: s.note || null, p_admin_id: admin.id,
    });
    if (error) throw new Error(error.message);
    const id = data as string;
    if (s.mark_shipped || s.channel === "in_person") {
      await db().from("orders").update({ status: s.channel === "in_person" ? "delivered" : "shipped", shipped_at: new Date().toISOString() }).eq("id", id);
    }
    await audit(admin, "order.manual_sale", "order", id, { channel: s.channel, items: s.items.length });
    refresh();
    return { ok: true, data: { id } };
  } catch (e) { return fail(e); }
}

export async function searchVariants(q: string) {
  await assertAdmin();
  return q.trim().length < 2 ? [] : search(q.trim());
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------
export async function respondOffer(input: { id: string; action: "accept" | "decline" | "counter"; counter?: number }): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const o = must(await db().from("offers").select("id, email, amount, status, products(title)").eq("id", input.id).single(), "offer") as unknown as {
      id: string; email: string; amount: number; status: string; products: { title: string } | null;
    };
    if (o.status !== "pending" && o.status !== "countered") throw new Error("Offer already handled");
    const status = input.action === "accept" ? "accepted" : input.action === "decline" ? "declined" : "countered";
    if (status === "countered" && !(Number(input.counter) > 0)) throw new Error("Enter a counter amount");
    must(await db().from("offers").update({ status, counter_amount: status === "countered" ? input.counter : null, responded_at: new Date().toISOString() }).eq("id", o.id).select("id"), "offer");
    const store = await storeName();
    const title = o.products?.title ?? "your item";
    const body = status === "accepted"
      ? `<p>Good news — your offer of <b>${esc(o.amount)}</b> for <b>${esc(title)}</b> was accepted. We'll send a payment link shortly.</p>`
      : status === "countered"
        ? `<p>Thanks for your offer on <b>${esc(title)}</b>. We can do <b>${esc(input.counter)}</b> — reply to this email to accept.</p>`
        : `<p>Thanks for your offer on <b>${esc(title)}</b>. Unfortunately we can't accept it this time.</p>`;
    await sendEmail({ to: o.email, subject: `Your offer on ${title} — ${store}`, html: body });
    await audit(admin, `offer.${input.action}`, "offer", o.id, input);
    refresh();
    return { ok: true, message: `Offer ${status}` };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Sell-to-us requests
// ---------------------------------------------------------------------------
export async function updateSellRequest(input: { id: string; status: string; offer_price?: number | null; notes?: string }): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const status = z.enum(["new", "reviewing", "offer_sent", "accepted", "rejected", "completed"]).parse(input.status);
    must(await db().from("sell_requests").update({ status, offer_price: input.offer_price ?? null, notes: input.notes ?? null }).eq("id", input.id).select("id"), "sell request");
    await audit(admin, "sell_request.update", "sell_request", input.id, input);
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Drops & raffles
// ---------------------------------------------------------------------------
export async function saveDrop(input: { id?: string; name: string; description?: string; starts_at?: string; ends_at?: string; status: string }): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const row = {
      name: z.string().trim().min(2).parse(input.name),
      description: input.description || null,
      starts_at: input.starts_at ? new Date(input.starts_at).toISOString() : null,
      ends_at: input.ends_at ? new Date(input.ends_at).toISOString() : null,
      status: z.enum(["draft", "scheduled", "live", "ended"]).parse(input.status),
    };
    const res = input.id ? await db().from("drops").update(row).eq("id", input.id).select("id").single() : await db().from("drops").insert(row).select("id").single();
    const id = must(res, "drop").id;
    // Going live publishes the drop's scheduled listings.
    if (row.status === "live") await db().from("products").update({ status: "active" }).eq("drop_id", id).in("status", ["draft", "scheduled"]);
    await audit(admin, input.id ? "drop.update" : "drop.create", "drop", id, row);
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function saveRaffle(input: { name: string; product_id?: string; drop_id?: string; starts_at?: string; ends_at?: string }): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const row = must(await db().from("raffles").insert({
      name: z.string().trim().min(2).parse(input.name), product_id: input.product_id || null, drop_id: input.drop_id || null,
      starts_at: input.starts_at ? new Date(input.starts_at).toISOString() : null, ends_at: input.ends_at ? new Date(input.ends_at).toISOString() : null,
      status: "open",
    }).select("id").single(), "raffle");
    await audit(admin, "raffle.create", "raffle", row.id, input);
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Draw a uniformly random winner (crypto RNG) and email them. */
export async function drawRaffle(raffleId: string): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const entries = must(await db().from("raffle_entries").select("id, email, size").eq("raffle_id", raffleId), "entries");
    if (entries.length === 0) throw new Error("No entries");
    const idx = crypto.getRandomValues(new Uint32Array(1))[0] % entries.length;
    const winner = entries[idx];
    await db().from("raffle_entries").update({ is_winner: true }).eq("id", winner.id);
    await db().from("raffles").update({ status: "drawn", winner_entry_id: winner.id }).eq("id", raffleId);
    const store = await storeName();
    await sendEmail({ to: winner.email, subject: `You won the ${store} raffle!`, html: `<p>Congratulations — you've won${winner.size ? ` (size ${esc(winner.size)})` : ""}. We'll be in touch with a payment link.</p>` });
    await audit(admin, "raffle.draw", "raffle", raffleId, { winner: winner.id, entries: entries.length });
    refresh();
    return { ok: true, message: `Winner: ${winner.email} (1 of ${entries.length})` };
  } catch (e) { return fail(e); }
}
