import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { rpc } from "@/lib/db";
import { runAlerts } from "@/lib/jobs/alerts";
import { invalidateCatalog } from "@/lib/shop/catalog";
import { runLogged } from "@/lib/jobs/nightly";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const result = await runLogged("hourly", async () => {
    const published = await rpc<number>("publish_scheduled_products");
    const releasedCheckouts = await rpc<number>("checkout_release_expired");
    if (published || releasedCheckouts) invalidateCatalog();
    return { published, releasedCheckouts, alerts: await runAlerts() };
  });
  return NextResponse.json(result);
}
