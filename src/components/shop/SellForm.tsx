"use client";
import { useState, useTransition } from "react";
import { ImagePlus, X } from "lucide-react";
import { compressImage } from "@/lib/image";
import { submitSellRequest } from "@/app/(shop)/actions";

export function SellForm() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (msg?.ok) return <div role="status" className="border border-[var(--border)] p-6"><p className="text-lg font-semibold">{msg.text}</p></div>;

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); start(async () => {
      setMsg(null);
      f.delete("photos");
      for (const p of photos) {
        try {
          const { blob } = await compressImage(p, 1600, 0.82);
          f.append("photos", new File([blob], "photo.webp", { type: blob.type }));
        } catch { /* skip unreadable files */ }
      }
      const r = await submitSellRequest(f);
      setMsg(r.ok ? { ok: true, text: r.message ?? "Thanks!" } : { ok: false, text: r.error });
    }); }}>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label="Your name" required />
        <Field name="email" label="Email" type="email" required />
        <Field name="brand" label="Brand" placeholder="e.g. Jordan" />
        <Field name="item" label="Item" placeholder="e.g. Jordan 4 Bred Reimagined" required />
        <Field name="size" label="Size" />
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Condition</span>
          <select name="condition" className="shop-input" defaultValue="">
            <option value="">Select…</option>
            <option value="new">New / deadstock</option>
            <option value="new_defects">New with flaws</option>
            <option value="used_excellent">Used — excellent</option>
            <option value="used_good">Used — good</option>
            <option value="used_fair">Used — fair</option>
          </select>
        </label>
        <Field name="asking_price" label="Asking price (optional)" inputMode="decimal" />
        <Field name="phone" label="Phone (optional)" type="tel" />
      </div>
      <label className="block text-sm"><span className="mb-1 block font-medium">Anything else?</span><textarea name="notes" rows={3} className="shop-input" /></label>
      <div>
        <span className="mb-1 block text-sm font-medium">Photos (up to 4)</span>
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative h-20 w-20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(p)} alt="" className="h-full w-full object-cover" />
              <button type="button" aria-label="Remove photo" className="absolute right-0 top-0 bg-[var(--ink)] p-0.5 text-[var(--page)]" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}><X size={12} /></button>
            </div>
          ))}
          {photos.length < 4 && (
            <label className="grid h-20 w-20 cursor-pointer place-items-center border-[1.5px] border-dashed border-[var(--ink-3)]" aria-label="Add photos">
              <ImagePlus size={20} />
              <input type="file" accept="image/*" multiple hidden onChange={(e) => setPhotos([...photos, ...Array.from(e.target.files ?? [])].slice(0, 4))} />
            </label>
          )}
        </div>
      </div>
      {msg && !msg.ok && <p role="alert" className="text-sm font-semibold text-[var(--critical)]">{msg.text}</p>}
      <button className="shop-btn w-full" disabled={pending}>{pending ? "Sending…" : "Get my offer"}</button>
    </form>
  );
}

function Field({ name, label, ...rest }: { name: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input name={name} className="shop-input" {...rest} />
    </label>
  );
}
