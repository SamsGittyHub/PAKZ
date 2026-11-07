"use client";
import { useTransition } from "react";
import { Check, X } from "lucide-react";
import { DataTable } from "@/components/admin/DataTable";
import { useNotice } from "@/components/admin/Toast";
import { setRecommendationStatus } from "./actions";

/** Clearance candidates are numerous and similar — a table scans better than cards. */
export function ClearanceTable({ rows }: { rows: Record<string, unknown>[] }) {
  const [pending, start] = useTransition();
  const { notice, error } = useNotice();
  const set = (id: string, status: "dismissed" | "actioned") =>
    start(async () => { const r = await setRecommendationStatus(id, status); if (!r.ok) error(r.error); });
  return (
    <>
      <DataTable
        data={rows}
        filename="clearance-candidates"
        initialSort={{ key: "score", desc: true }}
        pageSize={15}
        columns={[
          { key: "product", header: "Product", href: "/admin/products/{scope_value}" },
          { key: "days_listed", header: "Days listed", type: "num" },
          { key: "views_30d", header: "Views 30d", type: "num", hideMobile: true },
          { key: "on_hand", header: "Qty", type: "num", hideMobile: true },
          { key: "price", header: "Price", type: "money" },
          { key: "suggested_markdown_pct", header: "Markdown %", type: "num" },
          { key: "suggested_price", header: "Suggested", type: "money" },
          { key: "score", header: "Score", type: "num", hideMobile: true },
        ]}
        rowActions={(r) => r.status === "new" ? (
          <>
            <button className="btn btn-sm" disabled={pending} title="Mark actioned" aria-label="Mark actioned" onClick={() => set(String(r.id), "actioned")}><Check size={14} /></button>
            <button className="btn btn-sm btn-ghost" disabled={pending} title="Dismiss" aria-label="Dismiss" onClick={() => set(String(r.id), "dismissed")}><X size={14} /></button>
          </>
        ) : null}
      />
      {notice}
    </>
  );
}
