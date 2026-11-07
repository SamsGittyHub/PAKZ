"use client";
import { Download } from "lucide-react";
import { toCsv } from "@/lib/csv";

/** Client-side CSV export of data already on the page (already redacted for staff server-side). */
export function CsvButton({ rows, filename, columns, label = "CSV" }: {
  rows: object[]; filename: string; columns?: string[]; label?: string;
}) {
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={rows.length === 0}
      onClick={() => {
        const blob = new Blob([toCsv(rows as Record<string, unknown>[], columns)], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }}
    >
      <Download size={14} aria-hidden /> {label}
    </button>
  );
}
