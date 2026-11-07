"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { RANGE_PRESETS } from "@/lib/dates";

export function DateRangePicker({ showCompare = true }: { showCompare?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const range = params.get("range") ?? "30d";
  const compare = params.get("compare") !== "0";

  const update = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([k, v]) => (v == null ? q.delete(k) : q.set(k, v)));
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative flex items-center">
        <CalendarDays size={14} className="faint pointer-events-none absolute left-2.5" aria-hidden />
        <span className="sr-only">Date range</span>
        <select
          className="input !w-auto pl-8"
          value={range}
          onChange={(e) => update({ range: e.target.value, ...(e.target.value !== "custom" ? { from: null, to: null } : {}) })}
        >
          {RANGE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      {range === "custom" && (
        <>
          <input type="date" aria-label="From" className="input !w-auto" defaultValue={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value })} />
          <span className="faint text-sm">→</span>
          <input type="date" aria-label="To" className="input !w-auto" defaultValue={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value })} />
        </>
      )}
      {showCompare && (
        <label className="flex items-center gap-1.5 text-sm text-[var(--ink-2)]">
          <input type="checkbox" checked={compare} onChange={(e) => update({ compare: e.target.checked ? null : "0" })} />
          Compare to previous
        </label>
      )}
    </div>
  );
}
