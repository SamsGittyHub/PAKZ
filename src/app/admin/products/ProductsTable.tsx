"use client";
import { useState, useTransition } from "react";
import { BarChart2 } from "lucide-react";
import { DataTable, type ColSpec } from "@/components/admin/DataTable";
import { Drawer, useNotice } from "@/components/admin/Toast";
import { bulkProducts } from "./actions";
import { ProductInsight } from "./ProductInsight";

export function ProductsTable({ rows, canSeeCosts }: { rows: object[]; canSeeCosts: boolean }) {
  const [pending, start] = useTransition();
  const [insight, setInsight] = useState<{ id: string; title: string } | null>(null);
  const { notice, ok, error } = useNotice();

  const columns: ColSpec[] = [
    { key: "image", header: "", type: "image" },
    { key: "title", header: "Title", href: "/admin/products/{id}", sub: "brand" },
    { key: "variants", header: "Variants", type: "num", hideMobile: true },
    { key: "stock", header: "Stock", type: "num" },
    { key: "price", header: "Price", type: "money" },
    ...(canSeeCosts ? [
      { key: "cost", header: "Cost", type: "money", hideMobile: true } as ColSpec,
      { key: "margin", header: "Margin", type: "pct", hideMobile: true } as ColSpec,
    ] : []),
    { key: "views", header: "Views 30d", type: "num", hideMobile: true },
    { key: "conversion", header: "Conv.", type: "pct", hideMobile: true },
    { key: "days_listed", header: "Days", type: "num", hideMobile: true },
    { key: "status", header: "Status", type: "badge" },
  ];

  const run = (ids: string[], action: Parameters<typeof bulkProducts>[0]["action"], value?: string | number, clear?: () => void) =>
    start(async () => {
      if (action === "delete" && !confirm(`Delete ${ids.length} product(s)? Products with sales are archived instead.`)) return;
      const res = await bulkProducts({ ids, action, value });
      if (res.ok) { ok(res.message ?? "Done"); clear?.(); } else error(res.error);
    });

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        filename="products"
        searchable={false}
        selectable
        initialSort={{ key: "days_listed", desc: false }}
        rowActions={(r) => (
          <button className="btn btn-sm btn-ghost" title="Insights" aria-label={`Insights for ${r.title}`}
            onClick={() => setInsight({ id: String(r.id), title: String(r.title) })}>
            <BarChart2 size={14} />
          </button>
        )}
        toolbar={(ids, clear) => (
          <>
            <button disabled={pending} className="btn btn-sm" onClick={() => run(ids, "publish", undefined, clear)}>Publish</button>
            <button disabled={pending} className="btn btn-sm" onClick={() => run(ids, "unpublish", undefined, clear)}>Unpublish</button>
            <button disabled={pending} className="btn btn-sm" onClick={() => run(ids, "feature", undefined, clear)}>Feature</button>
            <button disabled={pending} className="btn btn-sm" onClick={() => run(ids, "unfeature", undefined, clear)}>Unfeature</button>
            <button disabled={pending} className="btn btn-sm" onClick={() => {
              const v = prompt("Change price by % (e.g. -10 or 15):");
              if (v) run(ids, "price_pct", Number(v), clear);
            }}>Price ±%</button>
            <button disabled={pending} className="btn btn-sm" onClick={() => {
              const v = prompt("Change price by a fixed amount (e.g. -5 or 10):");
              if (v) run(ids, "price_fixed", Number(v), clear);
            }}>Price ±amount</button>
            <button disabled={pending} className="btn btn-sm" onClick={() => {
              const v = prompt("Tag to add:");
              if (v) run(ids, "add_tag", v, clear);
            }}>Add tag</button>
            <button disabled={pending} className="btn btn-sm" onClick={() => confirm("Mark as sold and remove remaining stock? This does not record revenue.") && run(ids, "mark_sold", undefined, clear)}>Mark sold</button>
            <button disabled={pending} className="btn btn-sm" onClick={() => run(ids, "archive", undefined, clear)}>Archive</button>
            <button disabled={pending} className="btn btn-sm btn-danger" onClick={() => run(ids, "delete", undefined, clear)}>Delete</button>
          </>
        )}
      />
      <Drawer open={!!insight} onClose={() => setInsight(null)} title={insight ? `Insights · ${insight.title}` : ""}>
        {insight && <ProductInsight productId={insight.id} />}
      </Drawer>
      {notice}
    </>
  );
}
