import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { STORE_NAME } from "@/lib/shop/config";

const PAGES: Record<string, { title: string; body: string[] }> = {
  shipping: {
    title: "Shipping",
    body: [
      "Orders ship within 1–2 working days with tracking. You'll get an email with your tracking number as soon as your parcel is on its way.",
      "Shipping options and prices are shown at checkout before you pay.",
    ],
  },
  returns: {
    title: "Returns",
    body: [
      "Changed your mind? Return unworn items in the condition you received them within 14 days of delivery for a refund. Get in touch first so we can confirm the return.",
      "Refunds go back to your original payment method once we've checked the item. Return postage is your responsibility unless the item isn't as described.",
    ],
  },
  authenticity: {
    title: "Authenticity",
    body: [
      `Every item ${STORE_NAME} sells is checked by hand before it's listed: tags, stitching, materials, boxes and labels.`,
      "If anything you buy from us isn't authentic, we'll refund you in full, including shipping.",
    ],
  },
  privacy: {
    title: "Privacy & cookies",
    body: [
      "We use first-party cookies only — no ads, no third-party trackers. They help us understand what people browse so we can stock what you want.",
      "If you decline cookies we still count visits anonymously, without storing anything on your device or linking visits together.",
      "Order details are used to fulfil your order. Payments are handled by Stripe; we never see your card details.",
      `Questions or data requests: contact ${STORE_NAME} through the email on your order confirmation.`,
    ],
  },
};

type Params = Promise<{ page: string }>;

export function generateStaticParams() {
  return Object.keys(PAGES).map((page) => ({ page }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const page = PAGES[(await params).page];
  return page ? { title: page.title } : { title: "Not found" };
}

export default async function InfoPage({ params }: { params: Params }) {
  const page = PAGES[(await params).page];
  if (!page) notFound();
  return (
    <article className="mx-auto max-w-2xl px-4 pt-8 sm:px-6">
      <h1 className="shop-display mb-8 text-5xl sm:text-7xl">{page.title}</h1>
      <div className="space-y-4 text-lg leading-relaxed">{page.body.map((p, i) => <p key={i}>{p}</p>)}</div>
    </article>
  );
}
