"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Lock, Minus, Plus, X } from "lucide-react";
import { cancelCheckout, getBagLines, startCheckout, type BagLine } from "@/app/(shop)/actions";
import { currentSessionId, track } from "@/lib/track/client";
import { bag, useBag } from "./bag-store";
import { price } from "./price";

export function BagView() {
  const items = useBag();
  const params = useSearchParams();
  const [lines, setLines] = useState<BagLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cancelled = useRef(false);

  // Came back from Stripe without paying: release the held stock straight away.
  useEffect(() => {
    const id = params.get("cancelled");
    if (id && !cancelled.current) { cancelled.current = true; void cancelCheckout(id); }
  }, [params]);

  const key = items.map((i) => i.variant_id).sort().join(",");
  useEffect(() => {
    let live = true;
    getBagLines(key ? key.split(",") : []).then((l) => { if (live) setLines(l); });
    return () => { live = false; };
  }, [key]);

  // Clamp quantities to live stock; drop lines that no longer exist.
  useEffect(() => {
    if (!lines) return;
    for (const i of items) {
      const l = lines.find((x) => x.variant_id === i.variant_id);
      if (!l) continue;
      if (l.available > 0 && i.quantity > l.available) bag.set(i.variant_id, l.available);
    }
  }, [lines, items]);

  if (!items.length) {
    return (
      <div className="py-10">
        <p className="text-lg">Your bag is empty.</p>
        <Link href="/shop" className="shop-btn mt-6">Start shopping</Link>
      </div>
    );
  }
  if (!lines) return <p className="text-[var(--ink-2)]" aria-busy="true">Loading your bag…</p>;

  const rows = items.map((i) => ({ item: i, line: lines.find((l) => l.variant_id === i.variant_id) })).filter((r) => r.line);
  const buyable = rows.filter((r) => r.line!.purchasable);
  const subtotal = buyable.reduce((a, r) => a + r.line!.price * Math.min(r.item.quantity, r.line!.available), 0);
  const unavailable = rows.filter((r) => !r.line!.purchasable);

  const checkout = () => start(async () => {
    setError(null);
    const payload = buyable.map((r) => ({ variant_id: r.item.variant_id, quantity: Math.min(r.item.quantity, r.line!.available) }));
    track("checkout_started", { value: subtotal });
    const res = await startCheckout(payload, currentSessionId());
    if (res.ok && res.data) window.location.href = res.data.url;
    else if (!res.ok) { setError(res.error); getBagLines(items.map((i) => i.variant_id)).then(setLines); }
  });

  return (
    <div className="grid gap-10 lg:grid-cols-[1.6fr_1fr]">
      <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {rows.map(({ item, line }) => (
          <li key={item.variant_id} className={`flex gap-4 py-4 ${line!.purchasable ? "" : "opacity-50"}`}>
            <Link href={`/product/${line!.slug}`} className="w-24 shrink-0 bg-[var(--surface-2)] sm:w-28">
              {line!.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={line!.image} alt={line!.title} className="aspect-[4/5] w-full object-cover" />
                : <div className="aspect-[4/5]" />}
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-2)]">{line!.brand}</div>
                  <Link href={`/product/${line!.slug}`} className="line-clamp-2 font-medium hover:underline">{line!.title}</Link>
                  <div className="text-sm text-[var(--ink-2)]">{line!.size ?? "One size"}</div>
                </div>
                <div className="tnum shrink-0 font-semibold">{price(line!.price * item.quantity)}</div>
              </div>
              <div className="mt-auto flex items-center justify-between pt-3">
                {line!.purchasable ? (
                  line!.available > 1 ? (
                    <div className="flex items-center border border-[var(--border)]">
                      <button className="p-2" aria-label="Decrease quantity" onClick={() => { bag.set(item.variant_id, item.quantity - 1); if (item.quantity === 1) track("remove_from_cart", { variant_id: item.variant_id }); }}><Minus size={14} /></button>
                      <span className="tnum w-8 text-center text-sm" aria-live="polite">{item.quantity}</span>
                      <button className="p-2" aria-label="Increase quantity" disabled={item.quantity >= line!.available} onClick={() => bag.set(item.variant_id, item.quantity + 1)}><Plus size={14} /></button>
                    </div>
                  ) : <span className="text-xs text-[var(--ink-3)]">1 of 1</span>
                ) : <span className="text-sm font-semibold text-[var(--critical)]">No longer available</span>}
                <button className="inline-flex items-center gap-1 text-sm text-[var(--ink-2)] hover:underline" onClick={() => { bag.remove(item.variant_id); track("remove_from_cart", { variant_id: item.variant_id }); }}>
                  <X size={14} /> Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <aside className="h-fit space-y-4 bg-[var(--surface-2)] p-6">
        <div className="flex justify-between text-sm"><span>Subtotal</span><span className="tnum font-semibold">{price(subtotal)}</span></div>
        <p className="text-xs text-[var(--ink-2)]">Shipping is chosen at checkout. Items are held for you for 30 minutes once you start checkout.</p>
        {unavailable.length > 0 && <p className="text-xs font-semibold text-[var(--critical)]">{unavailable.length} item{unavailable.length > 1 ? "s" : ""} in your bag sold — remove to continue.</p>}
        {error && <p role="alert" className="text-sm font-semibold text-[var(--critical)]">{error}</p>}
        <button className="shop-btn w-full" onClick={checkout} disabled={pending || !buyable.length || unavailable.length > 0}>
          <Lock size={14} /> {pending ? "Holding your items…" : "Checkout"}
        </button>
        <p className="text-center text-xs text-[var(--ink-3)]">Secure payment by Stripe</p>
      </aside>
    </div>
  );
}
