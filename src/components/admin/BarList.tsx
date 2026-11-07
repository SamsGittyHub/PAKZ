import Link from "next/link";
import { fmt } from "@/lib/format";

type Kind = "money" | "num" | "pct";
const f = (v: number, k: Kind) => (k === "money" ? fmt.money(v) : k === "pct" ? fmt.pct(v) : fmt.num(v));

/** Ranked horizontal bars — one series, one colour. Value labels in ink, not series colour. */
export function BarList({ rows, kind = "num", secondary, max }: {
  rows: { label: string; value: number; href?: string; secondary?: string }[];
  kind?: Kind; secondary?: string; max?: number;
}) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 0);
  if (rows.length === 0) return <p className="faint py-4 text-center text-sm">No data for this period.</p>;
  return (
    <ul className="space-y-1.5">
      {secondary && <li className="faint flex justify-end text-xs">{secondary}</li>}
      {rows.map((r) => (
        <li key={r.label} className="relative">
          <div className="absolute inset-y-0 left-0 rounded-[4px] bg-[var(--series-1)] opacity-[0.16]" style={{ width: `${top ? (r.value / top) * 100 : 0}%` }} aria-hidden />
          <div className="relative flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
            <span className="min-w-0 truncate">{r.href ? <Link href={r.href} className="hover:underline" prefetch={false}>{r.label}</Link> : r.label}</span>
            <span className="tnum shrink-0">
              {f(r.value, kind)}{r.secondary && <span className="faint ml-2 text-xs">{r.secondary}</span>}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Funnel: ordinal blue ramp, drop-off % per step labelled in text. */
export function Funnel({ steps }: { steps: { name: string; sessions: number }[] }) {
  const top = steps[0]?.sessions || 0;
  const ramp = ["--ramp-650", "--ramp-550", "--ramp-450", "--ramp-350", "--ramp-250"];
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].sessions : null;
        const drop = prev ? 1 - s.sessions / prev : null;
        return (
          <li key={s.name}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span>{i + 1}. {s.name}</span>
              <span className="tnum">
                {fmt.num(s.sessions)} <span className="faint text-xs">({top ? fmt.pct(s.sessions / top) : "—"} of visits)</span>
              </span>
            </div>
            <div className="h-6 rounded-[4px] bg-[var(--surface-2)]">
              <div className="h-6 rounded-[4px]" style={{ width: `${top ? Math.max((s.sessions / top) * 100, 0.5) : 0}%`, background: `var(${ramp[i] ?? "--ramp-250"})` }} />
            </div>
            {drop != null && <div className="faint mt-0.5 text-xs">↓ {fmt.pct(drop)} drop-off from previous step</div>}
          </li>
        );
      })}
    </ol>
  );
}
