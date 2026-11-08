"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import type { ShopVariant } from "@/lib/shop/catalog";
import { track } from "@/lib/track/client";
import { makeOffer } from "@/app/(shop)/actions";
import { bag, useBag } from "./bag-store";
import { price } from "./price";
import { WaitlistForm } from "./WaitlistForm";

const CONDITION: Record<string, string> = {
  new: "New", new_defects: "New with flaws", used_excellent: "Used — excellent", used_good: "Used — good", used_fair: "Used — fair",
};

export function BuyBox({ product, variants }: {
  product: { id: string; title: string; brand: string; category: string; allowOffers: boolean; available: boolean };
  variants: ShopVariant[];
}) {
  const inStock = variants.filter((v) => v.available > 0);
  const [selected, setSelected] = useState<string | null>(inStock.length === 1 ? inStock[0].id : null);
  const [added, setAdded] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const items = useBag();
  const v = variants.find((x) => x.id === selected) ?? null;
  const inBag = v ? items.find((i) => i.variant_id === v.id)?.quantity ?? 0 : 0;
  const multipleConditions = new Set(variants.map((x) => x.condition)).size > 1;
  const shownPrice = v?.price ?? (inStock.length ? Math.min(...inStock.map((x) => x.price)) : variants[0]?.price ?? 0);
  const label = (x: ShopVariant) => [x.size ?? "One size", multipleConditions ? CONDITION[x.condition] : null].filter(Boolean).join(" · ");

  const add = () => {
    if (!v || v.available - inBag <= 0) return;
    bag.add(v.id, 1, v.available);
    track("add_to_cart", { product_id: product.id, variant_id: v.id, category: product.category, brand: product.brand, value: v.price });
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  };

  return (
    <div className="mt-4">
      <div className="tnum text-2xl font-semibold">{price(shownPrice)}</div>
      {variants.length === 1 && (
        <dl className="mt-3 flex gap-6 text-sm">
          <div><dt className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Size</dt><dd className="mt-0.5 font-semibold">{variants[0].size ?? "One size"}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Condition</dt><dd className="mt-0.5 font-semibold">{CONDITION[variants[0].condition] ?? variants[0].condition}</dd></div>
        </dl>
      )}

      {variants.length > 1 && (
        <fieldset className="mt-6">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Select size</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {variants.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={selected === x.id} disabled={x.available <= 0}
                className="shop-chip" onClick={() => setSelected(x.id)} title={x.available <= 0 ? "Sold out" : price(x.price)}>
                {label(x)}
              </button>
            ))}
          </div>
          {v && v.available > 0 && v.available <= 2 && <p className="mt-2 text-xs font-semibold text-[var(--serious)]">Only {v.available} left</p>}
        </fieldset>
      )}

      {product.available ? (
        <div className="mt-6 space-y-2">
          <button className="shop-btn w-full" onClick={add} disabled={!v || v.available - inBag <= 0}>
            {added ? <><Check size={16} /> Added to bag</> : !v ? "Select a size" : v.available - inBag <= 0 ? "All in your bag" : "Add to bag"}
          </button>
          {added && <Link href="/bag" className="block text-center text-sm font-semibold underline">View bag & check out</Link>}
          {product.allowOffers && <button className="shop-btn shop-btn-outline w-full" onClick={() => setOfferOpen(!offerOpen)} aria-expanded={offerOpen}>Make an offer</button>}
          {offerOpen && <OfferForm productId={product.id} variantId={v?.id} listPrice={shownPrice} />}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <div className="shop-btn w-full cursor-default opacity-60">Sold</div>
          <p className="text-sm text-[var(--ink-2)]">Want another pair? We&apos;ll email you when one comes in.</p>
          <WaitlistForm productId={product.id} brand={product.brand} category={product.category} />
        </div>
      )}
    </div>
  );
}

function OfferForm({ productId, variantId, listPrice }: { productId: string; variantId?: string; listPrice: number }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (msg?.ok) return <p role="status" className="border border-[var(--border)] p-3 text-sm">{msg.text}</p>;
  return (
    <form className="space-y-2 border border-[var(--border)] p-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); start(async () => {
      const amount = Number(f.get("amount"));
      const r = await makeOffer({ product_id: productId, variant_id: variantId, email: String(f.get("email")), amount, message: String(f.get("message") ?? "") || undefined, website: String(f.get("website") ?? "") });
      if (r.ok) track("offer_made", { product_id: productId, variant_id: variantId, value: amount });
      setMsg(r.ok ? { ok: r.data?.status !== "auto_declined", text: r.message ?? "Offer sent" } : { ok: false, text: r.error });
    }); }}>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <div className="grid grid-cols-2 gap-2">
        <label><span className="sr-only">Your offer</span><input name="amount" inputMode="decimal" required placeholder={`Your offer (list ${price(listPrice)})`} className="shop-input" /></label>
        <label><span className="sr-only">Email</span><input name="email" type="email" required placeholder="Email" className="shop-input" /></label>
      </div>
      <label className="block"><span className="sr-only">Message</span><input name="message" placeholder="Message (optional)" className="shop-input" /></label>
      <button className="shop-btn w-full" disabled={pending}>{pending ? "Sending…" : "Send offer"}</button>
      {msg && <p role="alert" className={`text-sm ${msg.ok ? "" : "text-[var(--critical)]"}`}>{msg.text}</p>}
    </form>
  );
}
