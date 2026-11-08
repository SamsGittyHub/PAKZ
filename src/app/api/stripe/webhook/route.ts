import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, fromMinor } from "@/lib/stripe";
import { env } from "@/lib/env";
import { db, must } from "@/lib/db";

/**
 * Stripe → orders. Expects Checkout Sessions created by the storefront with metadata:
 *   items: JSON [{variant_id, quantity, unit_price}], session_id: analytics session id, reserved: "1" if stock was reserved.
 * Idempotent on the checkout session id.
 */
export async function POST(req: NextRequest) {
  const secret = env.stripeWebhookSecret();
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig ?? "", secret);
  } catch (e) {
    return NextResponse.json({ error: `bad signature: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid") return NextResponse.json({ received: true, skipped: "unpaid" });
      await recordCheckout(session);
    } else if (event.type === "charge.refunded") {
      // Refunds issued from the dashboard are recorded at source; this catches refunds made in the Stripe UI.
      const charge = event.data.object as Stripe.Charge;
      const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (pi) {
        const order = (await db().from("orders").select("id, refunded_amount").eq("stripe_payment_intent_id", pi).maybeSingle()).data;
        const stripeTotal = fromMinor(charge.amount_refunded);
        if (order && stripeTotal > Number(order.refunded_amount) + 0.005) {
          await db().rpc("record_refund", {
            p_order_id: order.id, p_amount: Math.round((stripeTotal - Number(order.refunded_amount)) * 100) / 100, p_items: [],
            p_restock: false, p_reason: "Refunded in Stripe dashboard", p_stripe_refund_id: null, p_admin_id: null,
          });
        }
      }
    }
  } catch (e) {
    console.error("[stripe webhook]", e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // Stripe retries
  }
  return NextResponse.json({ received: true });
}

async function recordCheckout(session: Stripe.Checkout.Session) {
  const existing = (await db().from("orders").select("id").eq("stripe_checkout_session_id", session.id).maybeSingle()).data;
  if (existing) return existing.id;

  const items = JSON.parse(session.metadata?.items ?? "[]") as { variant_id: string; quantity: number; unit_price?: number }[];
  if (!items.length) throw new Error(`Checkout ${session.id} has no items metadata`);
  const fromReserved = session.metadata?.reserved === "1";

  // Customer
  const email = session.customer_details?.email?.toLowerCase() ?? null;
  let customerId: string | null = null;
  if (email) {
    customerId = must(await db().from("customers").upsert({ email, name: session.customer_details?.name ?? null, phone: session.customer_details?.phone ?? null }, { onConflict: "email" }).select("id").single(), "customer").id;
  }

  // Stripe fee from the balance transaction.
  let fee = 0;
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (piId) {
    const pi = await stripe().paymentIntents.retrieve(piId, { expand: ["latest_charge.balance_transaction"] });
    const charge = pi.latest_charge as Stripe.Charge | null;
    const bt = charge?.balance_transaction as Stripe.BalanceTransaction | null;
    fee = fromMinor(bt?.fee);
  }

  const addr = session.collected_information?.shipping_details?.address ?? session.customer_details?.address ?? null;
  const { data: orderId, error } = await db().rpc("record_sale", {
    p_channel: "web",
    p_items: items.map((i) => ({ ...i, from_reserved: fromReserved })),
    p_customer_id: customerId,
    p_shipping_charged: fromMinor(session.shipping_cost?.amount_total),
    p_payment_fees: fee,
    p_tax: fromMinor(session.total_details?.amount_tax),
    p_discount: fromMinor(session.total_details?.amount_discount),
    p_paid_at: new Date(session.created * 1000).toISOString(),
    p_session_id: session.metadata?.session_id ?? null,
    p_stripe_payment_intent_id: piId,
    p_stripe_checkout_session_id: session.id,
    p_shipping_address: addr ? { name: session.collected_information?.shipping_details?.name ?? session.customer_details?.name, ...addr } : null,
  });
  if (error) throw new Error(error.message);
  if (session.metadata?.session_id) {
    await db().rpc("track_purchase", { p_session_id: session.metadata.session_id, p_order_id: orderId });
  }
  return orderId as string;
}
