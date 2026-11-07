"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { db, must } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { sendReport, type ReportPeriod } from "@/lib/jobs/report";

type Result = { ok: true; message?: string } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : e instanceof Error ? e.message : String(e) });

const Settings = z.object({
  store_name: z.string().trim().min(1).max(100),
  contact_email: z.string().email().or(z.literal("")).optional(),
  currency: z.string().length(3).toUpperCase(),
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown timezone"),
  vat_registered: z.boolean(),
  vat_rate: z.coerce.number().min(0).max(50),
  prices_include_vat: z.boolean(),
  vat_scheme: z.enum(["standard", "margin"]),
  email_from: z.string().max(200).optional(),
  low_stock_default: z.coerce.number().int().min(0).max(1000),
  shipping_rates: z.array(z.object({ name: z.string().min(1), price: z.coerce.number().min(0), free_over: z.coerce.number().min(0).optional() })).max(20),
});

export async function saveSettings(input: z.input<typeof Settings>): Promise<Result> {
  try {
    const admin = await assertAdmin(true);
    const s = Settings.parse(input);
    must(await db().from("store_settings").update({ ...s, contact_email: s.contact_email || null, email_from: s.email_from || null, updated_at: new Date().toISOString() }).eq("id", 1).select("id"), "settings");
    await audit(admin, "settings.update", "settings", "1", s);
    refresh();
    return { ok: true, message: "Settings saved" };
  } catch (e) { return fail(e); }
}

const Alerts = z.object({
  report_recipients: z.array(z.string().email()).max(20),
  report_weekly: z.boolean(),
  report_monthly: z.boolean(),
  alerts: z.object({
    low_stock: z.boolean(),
    big_order_threshold: z.coerce.number().min(0),
    offer_received: z.boolean(),
    traffic_spike_pct: z.coerce.number().min(0).max(10000),
  }),
});

export async function saveAlertSettings(input: z.input<typeof Alerts>): Promise<Result> {
  try {
    const admin = await assertAdmin(true);
    const a = Alerts.parse(input);
    must(await db().from("store_settings").update({ ...a, updated_at: new Date().toISOString() }).eq("id", 1).select("id"), "settings");
    await audit(admin, "settings.alerts", "settings", "1", a);
    refresh();
    return { ok: true, message: "Alert settings saved" };
  } catch (e) { return fail(e); }
}

export async function sendReportNow(period: ReportPeriod): Promise<Result> {
  try {
    const admin = await assertAdmin(true);
    const r = await sendReport(period, true);
    await audit(admin, "report.send", "report", period, r);
    return r.sent ? { ok: true, message: `Sent to ${r.to} recipient(s)` } : { ok: false, error: `Not sent: ${"reason" in r ? r.reason : "email not configured (RESEND_API_KEY / EMAIL_FROM)"}` };
  } catch (e) { return fail(e); }
}

export async function markNotificationsRead(): Promise<Result> {
  try {
    await assertAdmin();
    await db().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
export async function inviteStaff(input: { email: string; role: "owner" | "staff"; name?: string }): Promise<Result> {
  try {
    const admin = await assertAdmin(true);
    const email = z.string().email().parse(input.email.trim().toLowerCase());
    const role = z.enum(["owner", "staff"]).parse(input.role);
    const existing = (await db().from("profiles").select("id").eq("email", email).maybeSingle()).data;
    let userId = existing?.id as string | undefined;
    if (!userId) {
      const { data, error } = await db().auth.admin.inviteUserByEmail(email, { redirectTo: `${env.siteUrl}/auth/callback?next=/admin`, data: { full_name: input.name ?? null } });
      if (error) throw new Error(error.message);
      userId = data.user.id;
      // The auth trigger creates the profile; make sure it exists before setting the role.
      await db().from("profiles").upsert({ id: userId, email, full_name: input.name ?? null }, { onConflict: "id" });
    }
    must(await db().from("profiles").update({ role }).eq("id", userId).select("id"), "profile");
    await audit(admin, "staff.invite", "profile", userId, { email, role });
    refresh();
    return { ok: true, message: existing ? `${email} is now ${role}` : `Invite sent to ${email}` };
  } catch (e) { return fail(e); }
}

export async function setStaffRole(userId: string, role: "owner" | "staff" | "customer"): Promise<Result> {
  try {
    const admin = await assertAdmin(true);
    if (userId === admin.id) throw new Error("You can't change your own role");
    if (role !== "owner") {
      const { count } = await db().from("profiles").select("id", { count: "exact", head: true }).eq("role", "owner").neq("id", userId);
      if (!count) throw new Error("There must be at least one owner");
    }
    must(await db().from("profiles").update({ role }).eq("id", userId).select("id"), "profile");
    await audit(admin, "staff.role", "profile", userId, { role });
    refresh();
    return { ok: true, message: role === "customer" ? "Access removed" : `Role set to ${role}` };
  } catch (e) { return fail(e); }
}
