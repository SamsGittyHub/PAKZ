"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Copy, GripVertical, ImagePlus, Star, Trash2 } from "lucide-react";
import { toUploadForm } from "@/lib/image";
import { fmt } from "@/lib/format";
import { useNotice } from "@/components/admin/Toast";
import { duplicateProduct, saveProduct, uploadProductImage, type ProductInput } from "./actions";

type Lookup = { id: string; name: string };
const CONDITIONS = [
  ["new", "New"], ["new_defects", "New (defects)"], ["used_excellent", "Used – excellent"], ["used_good", "Used – good"], ["used_fair", "Used – fair"],
] as const;
type Condition = (typeof CONDITIONS)[number][0];

interface VariantState {
  key: string; id?: string; size: string; condition: Condition; sku: string; price: string; cost_price: string;
  low_stock_threshold: string; status: "active" | "hidden" | "archived" | "sold_out"; quantity?: number; reserved?: number;
  initial_quantity: string; purchase_source: "retail" | "resale" | "consignment" | "private"; remove?: boolean;
}
interface ImageState { key: string; id?: string; url: string; is_cover: boolean; file?: File }

export interface ProductFormInitial {
  id?: string; title: string; slug: string; description: string; category_id: string; brand_id: string; status: string;
  tags: string[]; featured: boolean; allow_offers: boolean; offer_floor_price: string; seo_title: string; seo_description: string;
  authenticity_notes: string; publish_at: string; drop_id: string;
  variants: Omit<VariantState, "key" | "initial_quantity" | "purchase_source">[];
  images: { id: string; url: string; is_cover: boolean }[];
}

const k = () => crypto.randomUUID();
const blankVariant = (): VariantState => ({
  key: k(), size: "", condition: "new", sku: "", price: "", cost_price: "", low_stock_threshold: "1", status: "active",
  initial_quantity: "1", purchase_source: "retail",
});

export function ProductForm({ initial, categories, brands, drops, canSeeCosts }: {
  initial: ProductFormInitial; categories: Lookup[]; brands: Lookup[]; drops: Lookup[]; canSeeCosts: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();
  const [f, setF] = useState(initial);
  const [newCategory, setNewCategory] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [tagInput, setTagInput] = useState(initial.tags.join(", "));
  const [variants, setVariants] = useState<VariantState[]>(
    initial.variants.length
      ? initial.variants.map((v) => ({ ...v, key: k(), initial_quantity: "0", purchase_source: "retail" }))
      : [blankVariant()],
  );
  const [images, setImages] = useState<ImageState[]>(initial.images.map((i) => ({ ...i, key: k() })));
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [matrix, setMatrix] = useState({ sizes: "", conditions: ["new"] as Condition[], price: "", cost: "", qty: "1" });
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof ProductFormInitial>(key: K, v: ProductFormInitial[K]) => setF((s) => ({ ...s, [key]: v }));
  const setVar = (key: string, patch: Partial<VariantState>) => setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  const addFiles = (files: FileList | File[]) => {
    const list = [...files].filter((x) => x.type.startsWith("image/"));
    setImages((imgs) => [
      ...imgs,
      ...list.map((file, i) => ({ key: k(), url: URL.createObjectURL(file), file, is_cover: imgs.length === 0 && i === 0 })),
    ]);
  };

  const generateMatrix = () => {
    const sizes = matrix.sizes.split(",").map((s) => s.trim()).filter(Boolean);
    const rows: VariantState[] = [];
    for (const size of sizes.length ? sizes : [""]) {
      for (const condition of matrix.conditions) {
        if (variants.some((v) => !v.remove && v.size === size && v.condition === condition)) continue;
        rows.push({ ...blankVariant(), size, condition, price: matrix.price, cost_price: matrix.cost, initial_quantity: matrix.qty });
      }
    }
    setVariants((vs) => [...vs.filter((v) => v.id || v.price || v.size), ...rows]);
  };

  const submit = (statusOverride?: string) => start(async () => {
    const payload: ProductInput = {
      id: f.id,
      title: f.title,
      slug: f.slug || null,
      description: f.description || null,
      category_id: newCategory ? null : f.category_id || null,
      new_category: newCategory || null,
      brand_id: newBrand ? null : f.brand_id || null,
      new_brand: newBrand || null,
      status: (statusOverride ?? f.status) as ProductInput["status"],
      tags: tagInput.split(",").map((t) => t.trim()).filter(Boolean),
      featured: f.featured,
      allow_offers: f.allow_offers,
      offer_floor_price: f.offer_floor_price || null,
      seo_title: f.seo_title || null,
      seo_description: f.seo_description || null,
      authenticity_notes: f.authenticity_notes || null,
      publish_at: f.publish_at || null,
      drop_id: f.drop_id || null,
      variants: variants.map((v) => ({
        id: v.id,
        size: v.size || null,
        condition: v.condition,
        sku: v.sku || null,
        price: v.price,
        cost_price: v.cost_price === "" ? undefined : v.cost_price,
        low_stock_threshold: v.low_stock_threshold || 1,
        status: v.status,
        initial_quantity: v.id ? undefined : v.initial_quantity || 0,
        purchase_source: v.purchase_source,
        remove: v.remove,
      })) as ProductInput["variants"],
      images: images.filter((i) => i.id).map((i) => ({ id: i.id!, position: images.indexOf(i), is_cover: i.is_cover })),
      removed_image_ids: removedImages,
    };
    const res = await saveProduct(payload);
    if (!res.ok) { error(res.error); return; }
    const id = res.data!.id;

    // Upload new images after the product exists (compressed to WebP client-side).
    const pendingUploads = images.filter((i) => i.file);
    for (const img of pendingUploads) {
      try {
        const up = await uploadProductImage(id, await toUploadForm(img.file!));
        if (!up.ok) throw new Error(up.error);
      } catch (e) {
        error(`Image upload failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    ok("Saved");
    if (!f.id) router.push(`/admin/products/${id}`);
    else router.refresh();
  });

  const coverIdx = images.findIndex((i) => i.is_cover);
  const totalStock = variants.filter((v) => !v.remove).reduce((a, v) => a + (v.quantity ?? Number(v.initial_quantity || 0)), 0);

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <section className="card card-pad space-y-3">
          <h2 className="text-sm font-semibold">Details</h2>
          <div>
            <label className="label" htmlFor="title">Title</label>
            <input id="title" className="input" required value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Nike Dunk Low Panda" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="brand">Brand</label>
              <select id="brand" className="input" value={newBrand ? "__new" : f.brand_id} onChange={(e) => { if (e.target.value === "__new") setNewBrand(" "); else { setNewBrand(""); set("brand_id", e.target.value); } }}>
                <option value="">—</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                <option value="__new">+ New brand…</option>
              </select>
              {newBrand && <input className="input mt-2" autoFocus placeholder="New brand name" value={newBrand.trimStart()} onChange={(e) => setNewBrand(e.target.value || " ")} />}
            </div>
            <div>
              <label className="label" htmlFor="category">Category</label>
              <select id="category" className="input" value={newCategory ? "__new" : f.category_id} onChange={(e) => { if (e.target.value === "__new") setNewCategory(" "); else { setNewCategory(""); set("category_id", e.target.value); } }}>
                <option value="">—</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new">+ New category…</option>
              </select>
              {newCategory && <input className="input mt-2" placeholder="New category name" value={newCategory.trimStart()} onChange={(e) => setNewCategory(e.target.value || " ")} />}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="desc">Description</label>
            <textarea id="desc" className="input" rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="tags">Tags <span className="faint">(comma separated)</span></label>
            <input id="tags" className="input" value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="y2k, grail, deadstock" />
          </div>
          <div>
            <label className="label" htmlFor="auth">Authenticity notes</label>
            <textarea id="auth" className="input" rows={2} value={f.authenticity_notes} onChange={(e) => set("authenticity_notes", e.target.value)} placeholder="Legit-checked via…, receipt available" />
          </div>
        </section>

        <section className="card card-pad">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Variants <span className="faint font-normal">· {totalStock} in stock</span></h2>
            <button type="button" className="btn btn-sm" onClick={() => setVariants((vs) => [...vs, blankVariant()])}>+ Variant</button>
          </div>
          <details className="mb-3 rounded-lg border border-[var(--border)] p-3 text-sm">
            <summary className="cursor-pointer font-medium">Generate size × condition matrix</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input className="input" placeholder="Sizes: UK 7, UK 8, UK 9" value={matrix.sizes} onChange={(e) => setMatrix({ ...matrix, sizes: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                {CONDITIONS.map(([v, l]) => (
                  <label key={v} className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={matrix.conditions.includes(v)} onChange={(e) => setMatrix({ ...matrix, conditions: e.target.checked ? [...matrix.conditions, v] : matrix.conditions.filter((c) => c !== v) })} /> {l}
                  </label>
                ))}
              </div>
              <input className="input" inputMode="decimal" placeholder="Price" value={matrix.price} onChange={(e) => setMatrix({ ...matrix, price: e.target.value })} />
              <div className="flex gap-2">
                <input className="input" inputMode="decimal" placeholder="Unit cost" value={matrix.cost} onChange={(e) => setMatrix({ ...matrix, cost: e.target.value })} />
                <input className="input" inputMode="numeric" placeholder="Qty each" value={matrix.qty} onChange={(e) => setMatrix({ ...matrix, qty: e.target.value })} />
              </div>
            </div>
            <button type="button" className="btn btn-sm mt-2" onClick={generateMatrix}>Add rows</button>
          </details>
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="table min-w-[720px]">
              <thead>
                <tr><th>Size</th><th>Condition</th><th className="num">Price</th><th className="num">{f.id ? "Cost" : "Unit cost"}</th><th className="num">Qty</th><th className="num">Low at</th><th>SKU</th><th /></tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.key} className={v.remove ? "opacity-40" : ""}>
                    <td><input className="input !w-24" value={v.size} onChange={(e) => setVar(v.key, { size: e.target.value })} placeholder="One size" aria-label="Size" /></td>
                    <td>
                      <select className="input !w-36" value={v.condition} onChange={(e) => setVar(v.key, { condition: e.target.value as Condition })} aria-label="Condition">
                        {CONDITIONS.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
                      </select>
                    </td>
                    <td className="num"><input className="input !w-24 text-right" required inputMode="decimal" value={v.price} onChange={(e) => setVar(v.key, { price: e.target.value })} aria-label="Price" /></td>
                    <td className="num">
                      {canSeeCosts || !v.id
                        ? <input className="input !w-24 text-right" inputMode="decimal" value={v.cost_price} onChange={(e) => setVar(v.key, { cost_price: e.target.value })} aria-label="Cost" placeholder={canSeeCosts ? "0" : "write-only"} />
                        : <span className="faint">hidden</span>}
                    </td>
                    <td className="num">
                      {v.id
                        ? <span className="tnum" title={v.reserved ? `${v.reserved} reserved` : undefined}>{v.quantity}{v.reserved ? <span className="faint"> +{v.reserved}r</span> : null}</span>
                        : <input className="input !w-16 text-right" inputMode="numeric" value={v.initial_quantity} onChange={(e) => setVar(v.key, { initial_quantity: e.target.value })} aria-label="Initial quantity" />}
                    </td>
                    <td className="num"><input className="input !w-16 text-right" inputMode="numeric" value={v.low_stock_threshold} onChange={(e) => setVar(v.key, { low_stock_threshold: e.target.value })} aria-label="Low stock threshold" /></td>
                    <td><input className="input !w-28" value={v.sku} onChange={(e) => setVar(v.key, { sku: e.target.value })} aria-label="SKU" /></td>
                    <td>
                      <button type="button" className="btn btn-sm btn-ghost" aria-label="Remove variant"
                        onClick={() => v.id ? setVar(v.key, { remove: !v.remove }) : setVariants((vs) => vs.filter((x) => x.key !== v.key))}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {f.id && <p className="faint mt-2 text-xs">Stock on existing variants changes through <Link className="underline" href="/admin/inventory">Inventory</Link> (adjust / receive) so every change is logged.</p>}
        </section>

        <section className="card card-pad">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Images</h2>
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> Add</button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </div>
          <div
            className="grid grid-cols-3 gap-2 rounded-lg border border-dashed border-[var(--border)] p-2 sm:grid-cols-5"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          >
            {images.length === 0 && <p className="faint col-span-full py-8 text-center text-sm">Drop photos here. They&apos;re compressed to WebP before upload.</p>}
            {images.map((img, i) => (
              <div
                key={img.key}
                draggable
                onDragStart={() => setDragKey(img.key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.stopPropagation();
                  if (!dragKey || dragKey === img.key) return;
                  setImages((imgs) => {
                    const from = imgs.findIndex((x) => x.key === dragKey);
                    const next = [...imgs];
                    const [moved] = next.splice(from, 1);
                    next.splice(i, 0, moved);
                    return next;
                  });
                  setDragKey(null);
                }}
                className={`group relative aspect-square overflow-hidden rounded-md border ${img.is_cover ? "border-[var(--series-1)] ring-2 ring-[var(--series-1)]" : "border-[var(--border)]"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                  <GripVertical size={14} className="cursor-grab text-white" aria-hidden />
                  <button type="button" aria-label="Set as cover" onClick={() => setImages((imgs) => imgs.map((x) => ({ ...x, is_cover: x.key === img.key })))}>
                    <Star size={14} className="text-white" fill={img.is_cover ? "white" : "none"} />
                  </button>
                  <button type="button" aria-label="Remove image" onClick={() => {
                    if (img.id) setRemovedImages((r) => [...r, img.id!]);
                    setImages((imgs) => imgs.filter((x) => x.key !== img.key));
                  }}><Trash2 size={14} className="text-white" /></button>
                </div>
                {img.file && <span className="badge absolute left-1 top-1 bg-[var(--surface)]">new</span>}
              </div>
            ))}
          </div>
          {coverIdx === -1 && images.length > 0 && <p className="faint mt-2 text-xs">Tip: star an image to set the cover.</p>}
        </section>

        <section className="card card-pad space-y-3">
          <h2 className="text-sm font-semibold">SEO</h2>
          <div>
            <label className="label" htmlFor="slug">URL slug</label>
            <input id="slug" className="input" value={f.slug} onChange={(e) => set("slug", e.target.value)} placeholder="auto from title" />
          </div>
          <div>
            <label className="label" htmlFor="seot">SEO title <span className="faint">({f.seo_title.length}/60)</span></label>
            <input id="seot" className="input" value={f.seo_title} onChange={(e) => set("seo_title", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="seod">SEO description <span className="faint">({f.seo_description.length}/160)</span></label>
            <textarea id="seod" className="input" rows={2} value={f.seo_description} onChange={(e) => set("seo_description", e.target.value)} />
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <section className="card card-pad space-y-3">
          <h2 className="text-sm font-semibold">Publishing</h2>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select id="status" className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
              {["draft", "scheduled", "active", "sold", "archived"].map((s) => <option key={s} value={s}>{fmt.label(s)}</option>)}
            </select>
          </div>
          {(f.status === "scheduled" || f.publish_at) && (
            <div>
              <label className="label" htmlFor="pub">Publish at</label>
              <input id="pub" type="datetime-local" className="input" value={f.publish_at} onChange={(e) => set("publish_at", e.target.value)} />
            </div>
          )}
          <div>
            <label className="label" htmlFor="drop">Drop</label>
            <select id="drop" className="input" value={f.drop_id} onChange={(e) => set("drop_id", e.target.value)}>
              <option value="">None</option>
              {drops.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.featured} onChange={(e) => set("featured", e.target.checked)} /> Featured</label>
        </section>

        <section className="card card-pad space-y-3">
          <h2 className="text-sm font-semibold">Offers</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.allow_offers} onChange={(e) => set("allow_offers", e.target.checked)} /> Allow offers</label>
          {f.allow_offers && (
            <div>
              <label className="label" htmlFor="floor">Auto-decline below</label>
              <input id="floor" className="input" inputMode="decimal" value={f.offer_floor_price} onChange={(e) => set("offer_floor_price", e.target.value)} placeholder="e.g. 120" />
            </div>
          )}
        </section>

        <div className="card card-pad sticky bottom-4 flex flex-wrap gap-2">
          <button className="btn btn-primary flex-1" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
          {f.status === "draft" && <button type="button" className="btn flex-1" disabled={pending} onClick={() => submit("active")}>Save & publish</button>}
          {f.id && (
            <button type="button" className="btn" disabled={pending} onClick={() => start(async () => {
              const res = await duplicateProduct(f.id!);
              if (res.ok) router.push(`/admin/products/${res.data!.id}`); else error(res.error);
            })}><Copy size={14} /> Duplicate</button>
          )}
        </div>
      </div>
      {notice}
    </form>
  );
}
