import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function authorizeCron(req: NextRequest): NextResponse | null {
  const header = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || header !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  return null;
}
