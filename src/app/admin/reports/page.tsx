import { Suspense } from "react";
import { pageContext, type SearchParams } from "@/lib/admin/context";
import { db, must } from "@/lib/supabase/admin";
import { buildReport } from "@/lib/jobs/report";
import { fmt } from "@/lib/format";
import { PageHeader, PageSkeleton, Section, Empty } from "@/components/admin/PageHeader";
import { DataTable } from "@/components/admin/DataTable";
import { AlertSettingsForm, MarkReadButton, SendReportButtons } from "./ReportControls";

export default function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Suspense fallback={<PageSkeleton />}><Reports searchParams={searchParams} /></Suspense>;
}

async function Reports({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { admin, settings } = await pageContext(searchParams);
  const isOwner = admin.role === "owner";
  const [notifications, runs, preview] = await Promise.all([
    db().from("notifications").select("id, type, title, body, created_at, read_at").order("created_at", { ascending: false }).limit(200),
    db().from("cron_runs").select("job, started_at, finished_at, ok, detail").order("started_at", { ascending: false }).limit(30),
    isOwner ? buildReport("weekly") : Promise.resolve(null),
  ]);
  const notes = must(notifications, "notifications");
  return (
    <>
      <PageHeader title="Reports & alerts" description={`${notes.filter((n) => !n.read_at).length} unread alerts`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Alerts" actions={<MarkReadButton />}>
          {notes.length === 0 ? <Empty>No alerts yet. They&apos;re checked hourly.</Empty> : (
            <ul className="max-h-[28rem] space-y-2 overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id} className={`rounded-lg border border-[var(--border)] p-2.5 text-sm ${n.read_at ? "opacity-60" : ""}`}>
                  <div className="flex justify-between gap-2"><span className="font-medium">{n.title}</span><span className="faint shrink-0 text-xs">{fmt.dateTime(n.created_at)}</span></div>
                  {n.body && <div className="muted text-xs">{n.body}</div>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Alert & report settings">
          <AlertSettingsForm isOwner={isOwner} initial={{ report_recipients: settings.report_recipients, report_weekly: settings.report_weekly, report_monthly: settings.report_monthly, alerts: settings.alerts }} />
        </Section>
      </div>
      {preview && (
        <Section title="Weekly report preview" className="mt-4" actions={<SendReportButtons />}>
          <iframe title="Report preview" srcDoc={preview.html} className="h-[36rem] w-full rounded-lg border border-[var(--border)] bg-white" sandbox="" />
        </Section>
      )}
      <Section title="Scheduled jobs" className="mt-4">
        <DataTable
          data={must(runs, "runs").map((r) => ({ ...r, id: `${r.job}-${r.started_at}`, result: r.ok == null ? "running" : r.ok ? "ok" : "failed", detail: JSON.stringify(r.detail ?? {}).slice(0, 200) }))}
          filename="cron-runs"
          searchable={false}
          columns={[
            { key: "job", header: "Job" },
            { key: "started_at", header: "Started", type: "datetime" },
            { key: "result", header: "Result", type: "badge" },
            { key: "detail", header: "Detail", hideMobile: true },
          ]}
        />
      </Section>
    </>
  );
}
