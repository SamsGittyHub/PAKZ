import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { sendReport, type ReportPeriod } from "@/lib/jobs/report";
import { runLogged } from "@/lib/jobs/nightly";
import { db } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * ?period=weekly | monthly — send that report.
 * ?period=auto (default) — for a single daily scheduler: weekly on Mondays, monthly on the 1st (store timezone).
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const param = req.nextUrl.searchParams.get("period") ?? "auto";
  let periods: ReportPeriod[] = param === "weekly" || param === "monthly" ? [param] : [];
  if (param === "auto") {
    const { data } = await db().from("store_settings").select("timezone").eq("id", 1).single();
    const tz = data?.timezone ?? "UTC";
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "numeric" }).formatToParts(new Date());
    if (parts.find((p) => p.type === "weekday")?.value === "Mon") periods.push("weekly");
    if (parts.find((p) => p.type === "day")?.value === "1") periods.push("monthly");
  }
  periods = [...new Set(periods)];
  const results: Record<string, unknown> = {};
  for (const p of periods) results[p] = await runLogged(`report_${p}`, () => sendReport(p));
  return NextResponse.json({ periods, results });
}
