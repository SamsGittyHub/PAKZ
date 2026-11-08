import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { TasksTable } from "./TasksTable";

export default function TasksPage() {
  return <Suspense fallback={<PageSkeleton />}><Tasks /></Suspense>;
}

async function Tasks() {
  await requireAdmin();
  const rows = must(await db().from("purchase_tasks").select("*").order("status").order("due_date", { ascending: true, nullsFirst: false }).limit(500), "tasks");
  return (
    <>
      <PageHeader title="Purchase tasks" description={`${rows.filter((r) => r.status === "open").length} open · created from recommendations`} />
      <Section><TasksTable rows={rows} /></Section>
    </>
  );
}
