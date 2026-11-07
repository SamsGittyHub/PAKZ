"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface FilterSpec {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

/** URL-driven select filters (server re-renders with the new params). */
export function FilterBar({ filters, search }: { filters: FilterSpec[]; search?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (k: string, v: string) => {
    const q = new URLSearchParams(params.toString());
    if (v) q.set(k, v); else q.delete(k);
    router.replace(`${pathname}?${q}`, { scroll: false });
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {search && (
        <form onSubmit={(e) => { e.preventDefault(); set(search, String(new FormData(e.currentTarget).get("q") ?? "")); }}>
          <input name="q" defaultValue={params.get(search) ?? ""} placeholder="Search titles…" className="input !w-48" aria-label="Search" />
        </form>
      )}
      {filters.map((f) => (
        <label key={f.key} className="text-sm">
          <span className="sr-only">{f.label}</span>
          <select className="input !w-auto" value={params.get(f.key) ?? ""} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">{f.label}: all</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
      {filters.some((f) => params.get(f.key)) && (
        <button className="btn btn-sm btn-ghost" onClick={() => {
          const q = new URLSearchParams(params.toString());
          filters.forEach((f) => q.delete(f.key));
          if (search) q.delete(search);
          router.replace(`${pathname}?${q}`);
        }}>Clear filters</button>
      )}
    </div>
  );
}
