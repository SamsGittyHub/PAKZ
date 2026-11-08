"use client";
import { useState, useTransition } from "react";
import { enterRaffle } from "@/app/(shop)/actions";

export function RaffleEntry({ raffleId, sizes }: { raffleId: string; sizes: string[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (msg?.ok) return <p role="status" className="font-semibold">{msg.text}</p>;
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); start(async () => {
      const r = await enterRaffle({ raffle_id: raffleId, email: String(f.get("email")), size: String(f.get("size") ?? "") || undefined, website: String(f.get("website") ?? "") });
      setMsg(r.ok ? { ok: true, text: r.message ?? "Entered" } : { ok: false, text: r.error });
    }); }}>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <div className="flex gap-2">
        {sizes.length > 0 && (
          <label><span className="sr-only">Size</span>
            <select name="size" required className="shop-input !w-auto">
              <option value="">Size</option>
              {sizes.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        )}
        <label className="flex-1"><span className="sr-only">Email</span><input name="email" type="email" required placeholder="your@email.com" className="shop-input" /></label>
      </div>
      <button className="shop-btn w-full" disabled={pending}>{pending ? "Entering…" : "Enter raffle"}</button>
      {msg && <p role="alert" className="text-sm text-[var(--critical)]">{msg.text}</p>}
    </form>
  );
}
