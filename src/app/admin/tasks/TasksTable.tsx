"use client";
import { useTransition } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { setTaskStatus } from "../recommendations/actions";

export function TasksTable({ rows }: { rows: Record<string, unknown>[] }) {
  const [pending, start] = useTransition();
  return (
    <DataTable
      data={rows}
      filename="purchase-tasks"
      columns={[
        { key: "title", header: "Task", sub: "notes" },
        { key: "due_date", header: "Due", type: "date" },
        { key: "status", header: "Status", type: "badge" },
        { key: "created_at", header: "Created", type: "date", hideMobile: true },
      ]}
      rowActions={(r) => r.status === "open" ? (
        <>
          <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => { await setTaskStatus(String(r.id), "done"); })}>Done</button>
          <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => start(async () => { await setTaskStatus(String(r.id), "cancelled"); })}>Cancel</button>
        </>
      ) : (
        <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => start(async () => { await setTaskStatus(String(r.id), "open"); })}>Reopen</button>
      )}
    />
  );
}
