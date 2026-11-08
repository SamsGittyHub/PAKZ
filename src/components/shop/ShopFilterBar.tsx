"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { track } from "@/lib/track/client";

interface Facets { categories: { slug: string; name: string }[]; brands: { slug: string; name: string }[]; sizes: string[] }
const CONDITIONS = [["new", "New"], ["new_defects", "New (flaws)"], ["used_excellent", "Used – excellent"], ["used_good", "Used – good"], ["used_fair", "Used – fair"]];
const SORTS = [["new", "Newest"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"]];

export function ShopFilterBar({ facets }: { facets: Facets }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const set = (key: string, value: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (value) q.set(key, value); else q.delete(key);
    if (value && key !== "sort" && key !== "q") track("filter_used", { props: { filter: key, value } });
    router.replace(`${pathname}?${q}`, { scroll: false });
  };
  const active = ["category", "brand", "size", "condition", "min", "max", "sold"].filter((k) => params.get(k));

  const select = (key: string, label: string, options: string[][]) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">{label}</span>
      <select className="shop-input" value={params.get(key) ?? ""} onChange={(e) => set(key, e.target.value || null)}>
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-2">
        <button className="shop-chip inline-flex items-center gap-2" aria-expanded={open} onClick={() => setOpen(!open)}>
          <SlidersHorizontal size={14} /> Filters{active.length ? ` (${active.length})` : ""}
        </button>
        {facets.sizes.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Size">
            {facets.sizes.slice(0, 14).map((s) => (
              <button key={s} className="shop-chip" aria-pressed={params.get("size") === s} onClick={() => set("size", params.get("size") === s ? null : s)}>{s}</button>
            ))}
          </div>
        )}
        <label className="ml-auto">
          <span className="sr-only">Sort</span>
          <select className="shop-input !w-auto !py-2 text-sm" value={params.get("sort") ?? "new"} onChange={(e) => set("sort", e.target.value)}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      {open && (
        <div className="mt-4 grid gap-4 border border-[var(--border)] p-4 sm:grid-cols-2 lg:grid-cols-5">
          {select("category", "Category", facets.categories.map((c) => [c.slug, c.name]))}
          {select("brand", "Brand", facets.brands.map((b) => [b.slug, b.name]))}
          {select("condition", "Condition", CONDITIONS)}
          <div className="grid grid-cols-2 gap-2">
            <label><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Min £</span>
              <input className="shop-input" inputMode="numeric" defaultValue={params.get("min") ?? ""} onBlur={(e) => set("min", e.target.value || null)} /></label>
            <label><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Max £</span>
              <input className="shop-input" inputMode="numeric" defaultValue={params.get("max") ?? ""} onBlur={(e) => set("max", e.target.value || null)} /></label>
          </div>
          <label className="flex items-center gap-2 self-end pb-3 text-sm">
            <input type="checkbox" checked={params.get("sold") === "1"} onChange={(e) => set("sold", e.target.checked ? "1" : null)} /> Show recently sold
          </label>
        </div>
      )}
      {active.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {active.map((k) => (
            <button key={k} className="inline-flex items-center gap-1 bg-[var(--surface-2)] px-2 py-1" onClick={() => set(k, null)}>
              {k}: {params.get(k)} <X size={12} aria-label="remove" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
