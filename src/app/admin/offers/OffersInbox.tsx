"use client";
import { useTransition } from "react";
import { Check, Reply, X } from "lucide-react";
import { DataTable } from "@/components/admin/DataTable";
import { useNotice } from "@/components/admin/Toast";
import { respondOffer } from "../orders/actions";

export function OffersInbox({ rows }: { rows: Record<string, unknown>[] }) {
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();
  const act = (id: string, action: "accept" | "decline" | "counter", counter?: number) =>
    start(async () => { const r = await respondOffer({ id, action, counter }); if (r.ok) ok(r.message ?? "Done"); else error(r.error); });
  return (
    <>
      <DataTable
        data={rows}
        filename="offers"
        initialSort={{ key: "created_at", desc: true }}
        columns={[
          { key: "created_at", header: "Received", type: "datetime" },
          { key: "title", header: "Item", href: "/admin/products/{product_id}", sub: "message" },
          { key: "email", header: "From", hideMobile: true },
          { key: "amount", header: "Offer", type: "money2" },
          { key: "list_price", header: "List", type: "money", hideMobile: true },
          { key: "pct_of_list", header: "% of list", type: "pct", hideMobile: true },
          { key: "counter_amount", header: "Counter", type: "money2", hideMobile: true },
          { key: "status", header: "Status", type: "badge" },
        ]}
        rowActions={(r) => r.status === "pending" ? (
          <>
            <button disabled={pending} className="btn btn-sm" aria-label="Accept" title="Accept" onClick={() => act(String(r.id), "accept")}><Check size={14} /></button>
            <button disabled={pending} className="btn btn-sm" aria-label="Counter" title="Counter" onClick={() => { const v = prompt("Counter offer amount:"); if (v) act(String(r.id), "counter", Number(v)); }}><Reply size={14} /></button>
            <button disabled={pending} className="btn btn-sm btn-danger" aria-label="Decline" title="Decline" onClick={() => act(String(r.id), "decline")}><X size={14} /></button>
          </>
        ) : null}
      />
      {notice}
    </>
  );
}
