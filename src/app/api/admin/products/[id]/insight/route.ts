import { NextResponse, type NextRequest } from "next/server";
import { getAdmin, redact } from "@/lib/auth";
import { rpc } from "@/lib/db";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 30)));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const data = await rpc("admin_product_insight", { p_product_id: id, p_from: from.toISOString(), p_to: to.toISOString() });
  return NextResponse.json(redact(admin, data), { headers: { "cache-control": "private, no-store" } });
}
