import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { ClearBag } from "@/components/shop/ClearBag";

export const metadata: Metadata = { title: "Order confirmed", robots: { index: false } };

export default function SuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-16 text-center sm:px-6">
      <ClearBag />
      <h1 className="shop-display text-6xl sm:text-8xl">Thank you</h1>
      <Suspense fallback={<p className="mt-4 text-[var(--ink-2)]">Confirming your order…</p>}>
        <Status searchParams={searchParams} />
      </Suspense>
      <Link href="/shop" className="shop-btn mt-10">Keep shopping</Link>
    </div>
  );
}

async function Status({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id } = await searchParams;
  await connection();
  const id = session_id && /^cs_[A-Za-z0-9_]+$/.test(session_id) ? session_id : null;
  const order = id ? (await db().from("orders").select("number").eq("stripe_checkout_session_id", id).maybeSingle()).data : null;
  return order
    ? <p className="mt-4 text-lg">Order <b>#{order.number}</b> is confirmed. You&apos;ll get an email with tracking as soon as it ships.</p>
    : <p className="mt-4 text-lg">Your payment went through. We&apos;re confirming your order now — you&apos;ll get an email receipt shortly.</p>;
}
