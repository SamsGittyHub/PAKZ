/**
 * Date ranges for the dashboard, resolved in the store timezone.
 * URL params: ?range=today|7d|30d|90d|ytd|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&compare=0|1
 */
export type RangePreset = "today" | "7d" | "30d" | "90d" | "ytd" | "custom";
export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "ytd", label: "Year to date" },
  { value: "custom", label: "Custom" },
];

export interface ResolvedRange {
  preset: RangePreset;
  /** inclusive local dates */
  fromDate: string;
  toDate: string;
  /** [from, to) instants */
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  compare: boolean;
  days: number;
  bucket: "day" | "week" | "month";
  label: string;
}

/** Offset (ms) of `tz` from UTC at instant `d`. */
export function tzOffsetMs(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The instant of local midnight for `date` (YYYY-MM-DD) in `tz`. */
export function zonedMidnight(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz); // second pass fixes DST edges
  return new Date(t);
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function localDate(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function resolveRange(params: Params, tz: string, now = new Date()): ResolvedRange {
  const today = localDate(tz, now);
  let preset = (one(params.range) as RangePreset) ?? "30d";
  if (!RANGE_PRESETS.some((p) => p.value === preset)) preset = "30d";

  let fromDate: string;
  let toDate = today;
  switch (preset) {
    case "today": fromDate = today; break;
    case "7d": fromDate = addDays(today, -6); break;
    case "90d": fromDate = addDays(today, -89); break;
    case "ytd": fromDate = `${today.slice(0, 4)}-01-01`; break;
    case "custom": {
      const f = one(params.from);
      const t = one(params.to);
      fromDate = f && ISO.test(f) ? f : addDays(today, -29);
      toDate = t && ISO.test(t) ? t : today;
      if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
      break;
    }
    default: fromDate = addDays(today, -29);
  }

  const days = daysBetween(fromDate, toDate) + 1;
  const from = zonedMidnight(fromDate, tz);
  const to = zonedMidnight(addDays(toDate, 1), tz);
  const prevFrom = zonedMidnight(addDays(fromDate, -days), tz);
  const prevTo = from;
  const bucket = days <= 45 ? "day" : days <= 200 ? "week" : "month";
  const label = RANGE_PRESETS.find((p) => p.value === preset)!.label;

  return {
    preset, fromDate, toDate, from, to, prevFrom, prevTo, days, bucket,
    compare: one(params.compare) !== "0",
    label: preset === "custom" ? `${fromDate} → ${toDate}` : label,
  };
}

/** Serialize the current range back to a query string (to keep it across nav). */
export function rangeQuery(r: Pick<ResolvedRange, "preset" | "fromDate" | "toDate" | "compare">): string {
  const q = new URLSearchParams({ range: r.preset });
  if (r.preset === "custom") { q.set("from", r.fromDate); q.set("to", r.toDate); }
  if (!r.compare) q.set("compare", "0");
  return q.toString();
}
