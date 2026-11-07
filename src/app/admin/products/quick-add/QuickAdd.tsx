"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Camera } from "lucide-react";
import { toUploadForm } from "@/lib/image";
import { useNotice } from "@/components/admin/Toast";
import { saveProduct, uploadProductImage } from "../actions";

type Lookup = { id: string; name: string };

export function QuickAdd({ categories, brands, canSeeCosts }: { categories: Lookup[]; brands: Lookup[]; canSeeCosts: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [pending, start] = useTransition();
  const [last, setLast] = useState<{ id: string; title: string } | null>(null);
  const { notice, ok, error } = useNotice();
  const [formKey, setFormKey] = useState(0);

  const submit = (form: FormData) => start(async () => {
    const title = String(form.get("title") ?? "");
    const res = await saveProduct({
      title,
      brand_id: String(form.get("brand_id") || "") || null,
      category_id: String(form.get("category_id") || "") || null,
      status: form.get("publish") ? "active" : "draft",
      allow_offers: Boolean(form.get("allow_offers")),
      variants: [{
        size: String(form.get("size") || "") || null,
        condition: String(form.get("condition")) as "new",
        price: String(form.get("price")),
        cost_price: String(form.get("cost") || "") || undefined,
        initial_quantity: Number(form.get("quantity") || 1),
        purchase_source: String(form.get("source")) as "retail",
        low_stock_threshold: 1,
        status: "active",
      }],
    });
    if (!res.ok) { error(res.error); return; }
    for (const file of files) {
      const up = await uploadProductImage(res.data!.id, await toUploadForm(file));
      if (!up.ok) error(up.error);
    }
    ok(`Listed "${title}"`);
    setLast({ id: res.data!.id, title });
    setFiles([]);
    setFormKey((k) => k + 1);
  });

  return (
    <form key={formKey} action={submit} className="mx-auto max-w-md space-y-3">
      <label className="card flex cursor-pointer flex-col items-center justify-center gap-2 p-6 text-sm">
        <Camera size={28} aria-hidden />
        <span>{files.length ? `${files.length} photo(s) ready` : "Take or choose photos"}</span>
        <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => setFiles((f) => [...f, ...(e.target.files ? [...e.target.files] : [])])} />
      </label>
      {files.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {files.map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt="" className="aspect-square rounded-md object-cover" />)}
        </div>
      )}
      <input name="title" required placeholder="Title" className="input" />
      <div className="grid grid-cols-2 gap-2">
        <select name="brand_id" className="input" aria-label="Brand"><option value="">Brand</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select name="category_id" className="input" aria-label="Category"><option value="">Category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input name="size" placeholder="Size" className="input" />
        <select name="condition" className="input" aria-label="Condition" defaultValue="used_excellent">
          <option value="new">New</option><option value="new_defects">New (defects)</option><option value="used_excellent">Used – excellent</option><option value="used_good">Used – good</option><option value="used_fair">Used – fair</option>
        </select>
        <input name="price" required inputMode="decimal" placeholder="Price" className="input" />
        <input name="cost" inputMode="decimal" placeholder={canSeeCosts ? "Cost" : "Cost (write-only)"} className="input" />
        <input name="quantity" inputMode="numeric" defaultValue="1" placeholder="Qty" className="input" />
        <select name="source" className="input" aria-label="Purchase source"><option value="resale">Resale</option><option value="retail">Retail</option><option value="consignment">Consignment</option><option value="private">Private</option></select>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="publish" defaultChecked /> Publish now</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allow_offers" /> Allow offers</label>
      <button className="btn btn-primary w-full py-3" disabled={pending}>{pending ? "Listing…" : "List it"}</button>
      {last && <p className="faint text-center text-sm">Last: <Link className="underline" href={`/admin/products/${last.id}`}>{last.title}</Link></p>}
      {notice}
    </form>
  );
}
