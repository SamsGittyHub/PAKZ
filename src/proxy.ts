import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect: no session cookie → straight to /login.
 * The real check (signature, expiry, role) happens server-side in requireAdmin() on every page and action.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get("pakz_session")?.value) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
