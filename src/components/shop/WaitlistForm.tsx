"use client";
import { useState, useTransition } from "react";
import { joinWaitlist } from "@/app/(shop)/actions";
import { track } from "@/lib/track/client";

export function WaitlistForm({ productId, variantId, size, brand, category, keyword, cta = "Notify me" }: {
  productId?: string; variantId?: string; size?: string; brand?: string; category?: string; keyword?: string; cta?: string;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (msg?.ok) return <p role="status" className="text-sm font-semibold">{msg.text}</p>;
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); start(async () => {
      const r = await joinWaitlist({ product_id: productId, variant_id: variantId, size, brand, category, keyword: keyword || undefined, email: String(f.get("email")), website: String(f.get("website") ?? "") });
      if (r.ok) track("waitlist_signup", { product_id: productId, props: { brand: brand ?? null, size: size ?? null, keyword: keyword ?? null } });
      setMsg(r.ok ? { ok: true, text: r.message ?? "You're on the list." } : { ok: false, text: r.error });
    }); }}>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <label className="flex-1"><span className="sr-only">Email</span><input name="email" type="email" required placeholder="your@email.com" className="shop-input" /></label>
      <button className="shop-btn shop-btn-outline" disabled={pending}>{cta}</button>
      {msg && !msg.ok && <p role="alert" className="text-sm text-[var(--critical)]">{msg.text}</p>}
    </form>
  );
}
