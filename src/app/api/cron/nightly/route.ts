import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { runLogged, runNightly } from "@/lib/jobs/nightly";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const brief = req.nextUrl.searchParams.get("brief");
  const result = await runLogged("nightly", () => runNightly({ brief: brief == null ? undefined : brief === "1" }));
  return NextResponse.json(result);
}
