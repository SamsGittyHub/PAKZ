import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { rpc } from "@/lib/supabase/admin";
import { runAlerts } from "@/lib/jobs/alerts";
import { runLogged } from "@/lib/jobs/nightly";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const result = await runLogged("hourly", async () => ({
    published: await rpc<number>("publish_scheduled_products"),
    alerts: await runAlerts(),
  }));
  return NextResponse.json(result);
}
