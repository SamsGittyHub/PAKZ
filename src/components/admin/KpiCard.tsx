import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { change, fmt } from "@/lib/format";

type Kind = "money" | "num" | "pct";

export function formatValue(v: number | null | undefined, kind: Kind) {
  if (v == null) return "—";
  return kind === "money" ? fmt.money(v) : kind === "pct" ? fmt.pct(v) : fmt.num(Math.round(v * 100) / 100);
}

/**
 * KPI tile: value + % change vs previous period. `invert` = lower is better.
 * Delta is carried by an icon + sign + text, never colour alone.
 */
export function KpiCard({ label, value, prev, kind = "num", invert = false, hint, compare = true }: {
  label: string; value: number | null | undefined; prev?: number | null; kind?: Kind; invert?: boolean; hint?: string; compare?: boolean;
}) {
  const c = compare && prev != null && value != null ? change(value, prev) : undefined;
  const good = c != null && c !== 0 && (c > 0) !== invert;
  const Icon = c == null || c === 0 ? Minus : c > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="card card-pad min-w-0">
      <div className="muted truncate text-xs font-medium">{label}</div>
      <div className="mt-1 truncate text-2xl font-semibold tracking-tight">{formatValue(value, kind)}</div>
      {c !== undefined && (
        <div className={`mt-1 flex items-center gap-1 text-xs ${c == null || c === 0 ? "faint" : good ? "text-[var(--good-ink)]" : "text-[var(--critical)]"}`}>
          <Icon size={14} aria-hidden />
          <span className="tnum">{c == null ? "new" : `${c > 0 ? "+" : ""}${(c * 100).toFixed(1)}%`}</span>
          <span className="faint">vs prev · {formatValue(prev, kind)}</span>
        </div>
      )}
      {hint && <div className="faint mt-1 truncate text-xs">{hint}</div>}
    </div>
  );
}
