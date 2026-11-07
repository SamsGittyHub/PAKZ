import { NextResponse, type NextRequest } from "next/server";
import { authClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const nextParam = req.nextUrl.searchParams.get("next") ?? "/admin";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/admin";
  if (code) {
    const supabase = await authClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, req.url));
}
