import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/auth";
import { rpc } from "@/lib/db";

export async function GET() {
  if (!(await getAdmin())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const data = await rpc("admin_realtime", { p_minutes: 5 });
  return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
}
