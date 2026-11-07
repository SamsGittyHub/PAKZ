/** Minimal RFC 4180 CSV writer (no dependency, safe for Excel: formula-injection guarded). */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? Array.from(rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set<string>()));
  const cell = (v: unknown): string => {
    if (v == null) return "";
    let s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}
