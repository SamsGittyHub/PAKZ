const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY ?? "GBP";
const LOCALE = process.env.NEXT_PUBLIC_LOCALE ?? "en-GB";

const money0 = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat(LOCALE);
const compact = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });

export const fmt = {
  money: (n: number | string | null | undefined, cents = false) =>
    n == null || n === "" ? "—" : (cents ? money2 : money0).format(Number(n)),
  money2: (n: number | string | null | undefined) => (n == null ? "—" : money2.format(Number(n))),
  num: (n: number | string | null | undefined) => (n == null ? "—" : num.format(Number(n))),
  compact: (n: number | string | null | undefined) => (n == null ? "—" : compact.format(Number(n))),
  pct: (n: number | string | null | undefined, dp = 1) =>
    n == null || Number.isNaN(Number(n)) ? "—" : `${(Number(n) * 100).toFixed(dp)}%`,
  date: (d: string | Date | null | undefined) =>
    d ? new Date(d).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" }) : "—",
  dateTime: (d: string | Date | null | undefined) =>
    d ? new Date(d).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—",
  shortDate: (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" }),
  duration: (s: number | null | undefined) => {
    if (s == null) return "—";
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
  },
  label: (s: string | null | undefined) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—"),
};

/** % change vs previous; null when the previous period is zero. */
export function change(cur: number, prev: number): number | null {
  if (!prev) return cur ? null : 0;
  return (cur - prev) / Math.abs(prev);
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
