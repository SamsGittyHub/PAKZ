import { Suspense } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { getSettings } from "@/lib/admin/context";
import { db, must } from "@/lib/db";
import { integrationStatus } from "@/lib/env";
import { PageHeader, PageSkeleton, Section } from "@/components/admin/PageHeader";
import { DataTable } from "@/components/admin/DataTable";
import { ChangePasswordForm, StaffManager, StoreSettingsForm } from "./SettingsForms";

export default function SettingsPage() {
  return <Suspense fallback={<PageSkeleton />}><Settings /></Suspense>;
}

async function Settings() {
  const admin = await requireOwner();
  const [settings, staff, auditLog] = await Promise.all([
    getSettings(),
    db().from("profiles").select("id, email, full_name, role").in("role", ["owner", "staff"]).order("role"),
    db().from("audit_log").select("id, created_at, admin_email, action, entity, entity_id, diff").order("created_at", { ascending: false }).limit(500),
  ]);
  const integrations = integrationStatus();
  const status = (okay: boolean, label: string, hint: string) => (
    <li className="flex items-start gap-2 text-sm">
      {okay ? <CheckCircle2 size={16} className="mt-0.5 text-[var(--good)]" aria-hidden /> : <XCircle size={16} className="mt-0.5 text-[var(--critical)]" aria-hidden />}
      <div><span className="font-medium">{label}</span> <span className="sr-only">{okay ? "configured" : "not configured"}</span><div className="faint text-xs">{hint}</div></div>
    </li>
  );
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Store" className="lg:col-span-2"><StoreSettingsForm initial={settings as unknown as Record<string, unknown>} /></Section>
        <Section title="Integrations">
          <ul className="space-y-3">
            {status(integrations.database, "Database (Postgres + PostgREST)", "POSTGREST_URL, PGRST_JWT_SECRET")}
            {status(integrations.storage, "Image storage (S3 bucket)", "S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY")}
            {status(integrations.sessions, "Sign-in sessions", "SESSION_SECRET")}
            {status(integrations.stripe, `Stripe (${integrations.stripeMode})`, "STRIPE_SECRET_KEY — refunds and checkout")}
            {status(integrations.stripeWebhook, "Stripe webhook", "STRIPE_WEBHOOK_SECRET → /api/stripe/webhook")}
            {status(integrations.email, "Email (Resend)", "RESEND_API_KEY, EMAIL_FROM — shipping emails, reports, alerts")}
            {status(integrations.anthropic, "Claude Buying Brief", "ANTHROPIC_API_KEY — optional weekly AI summary")}
            {status(integrations.cron, "Cron", "CRON_SECRET — nightly forecasts, hourly alerts, reports")}
          </ul>
          <p className="faint mt-3 text-xs">Secrets live in environment variables and are never shown here.</p>
        </Section>
      </div>
      <Section title="Staff & roles" className="mt-4">
        <p className="faint mb-3 text-xs">Staff can manage listings, stock and orders but never see costs, margins or profit.</p>
        <StaffManager staff={must(staff, "staff") as { id: string; email: string; full_name: string | null; role: string }[]} me={admin.id} />
      </Section>
      <Section title="Change my password" className="mt-4"><ChangePasswordForm /></Section>
      <Section title="Audit log" className="mt-4">
        <DataTable
          data={must(auditLog, "audit").map((a) => ({ ...a, diff: a.diff ? JSON.stringify(a.diff).slice(0, 160) : "" }))}
          filename="audit-log"
          columns={[
            { key: "created_at", header: "When", type: "datetime" },
            { key: "admin_email", header: "Who" },
            { key: "action", header: "Action", type: "badge" },
            { key: "entity_id", header: "Entity", sub: "entity", hideMobile: true },
            { key: "diff", header: "Details", hideMobile: true },
          ]}
        />
      </Section>
    </>
  );
}
