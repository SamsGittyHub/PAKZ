"use client";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { DataTable } from "@/components/admin/DataTable";
import { useNotice } from "@/components/admin/Toast";
import { addExpense, deleteExpense } from "./actions";

const CATS = ["packaging", "ads", "subscriptions", "shipping_supplies", "fees", "software", "travel", "other"] as const;

export function Expenses({ rows, today }: { rows: Record<string, unknown>[]; today: string }) {
  const [pending, start] = useTransition();
  const { notice, error } = useNotice();
  return (
    <>
      <form className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5" action={(f) => start(async () => {
        const r = await addExpense({ date: String(f.get("date")), category: String(f.get("category")) as "ads", description: String(f.get("description") ?? ""), amount: String(f.get("amount")) });
        if (!r.ok) error(r.error);
      })}>
        <input name="date" type="date" className="input" defaultValue={today} required aria-label="Date" />
        <select name="category" className="input" aria-label="Category">{CATS.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select>
        <input name="description" className="input sm:col-span-2" placeholder="Description (e.g. Instagram ads)" />
        <div className="flex gap-2"><input name="amount" className="input" inputMode="decimal" placeholder="Amount" required /><button className="btn" disabled={pending}>Add</button></div>
      </form>
      <DataTable
        data={rows}
        filename="expenses"
        initialSort={{ key: "date", desc: true }}
        columns={[
          { key: "date", header: "Date", type: "date" },
          { key: "category", header: "Category", type: "badge" },
          { key: "description", header: "Description" },
          { key: "amount", header: "Amount", type: "money2" },
        ]}
        rowActions={(r) => (
          <button className="btn btn-sm btn-ghost" aria-label="Delete expense" disabled={pending}
            onClick={() => confirm("Delete this expense?") && start(async () => { const x = await deleteExpense(String(r.id)); if (!x.ok) error(x.error); })}>
            <Trash2 size={14} />
          </button>
        )}
      />
      {notice}
    </>
  );
}
