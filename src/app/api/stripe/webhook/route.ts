import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, fromMinor } from "@/lib/stripe";
import { env } from "@/lib/env";
import { db, must } from "@/lib/db";
import { invalidateCatalog } from "@/lib/shop/catalog";

/**
 * Stripe → orders, for Checkout Sessions opened by the storefront (src/app/(shop)/actions.ts).
 * Stock was reserved when the session opened; here it becomes a sale (paid) or is released (expired/failed).
 * Every handler is idempotent, so Stripe retries are safe.
 */
export async function POST(req: NextRequest) {
  const secret = env.stripeWebhookSecret();
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch (e) {
    return NextResponse.json({ error: `bad signature: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status === "paid" || session.payment_status === "no_payment_required") await completeCheckout(session);
        else await db().rpc("checkout_mark_awaiting", { p_stripe_session_id: session.id });
        break;
      }
      case "checkout.session.async_payment_succeeded":
        await completeCheckout(event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await db().rpc("checkout_release", { p_stripe_session_id: session.id });
        invalidateCatalog();
        break;
      }
      case "charge.refunded": {
        // Refunds made in the Stripe dashboard (refunds made in PAKZ admin are recorded at source).
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
        break;
      }
    }
  } catch (e) {
    console.error("[stripe webhook]", event.type, e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // Stripe retries
  }
  return NextResponse.json({ received: true });
}

async function completeCheckout(session: Stripe.Checkout.Session) {
  const email = session.customer_details?.email?.toLowerCase() ?? null;
  let customerId: string | null = null;
  if (email) {
    customerId = must(await db().from("customers").upsert(
      { email, name: session.customer_details?.name ?? null, phone: session.customer_details?.phone ?? null },
      { onConflict: "email" },
    ).select("id").single(), "customer").id;
  }

  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  let fee = 0;
  if (piId) {
    try {
      const pi = await stripe().paymentIntents.retrieve(piId, { expand: ["latest_charge.balance_transaction"] });
      const bt = (pi.latest_charge as Stripe.Charge | null)?.balance_transaction as Stripe.BalanceTransaction | null;
      fee = fromMinor(bt?.fee);
    } catch (e) {
      console.warn("[stripe webhook] could not read fee", e); // the sale still records; fee can be edited later
    }
  }

  const shipping = session.collected_information?.shipping_details;
  const address = shipping?.address ?? session.customer_details?.address ?? null;
  const { error } = await db().rpc("checkout_complete", {
    p_stripe_session_id: session.id,
    p_customer_id: customerId,
    p_shipping_charged: fromMinor(session.shipping_cost?.amount_total),
    p_payment_fees: fee,
    p_tax: fromMinor(session.total_details?.amount_tax),
    p_discount: fromMinor(session.total_details?.amount_discount),
    p_paid_at: new Date((session.created ?? Date.now() / 1000) * 1000).toISOString(),
    p_payment_intent_id: piId,
    p_shipping_address: address ? { name: shipping?.name ?? session.customer_details?.name ?? null, ...address } : null,
  });
  if (error) throw new Error(error.message);
  invalidateCatalog();
}
