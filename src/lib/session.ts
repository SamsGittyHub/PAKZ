import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "pakz_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

interface Payload { uid: string; exp: number }

const sign = (body: string) => createHmac("sha256", env.sessionSecret).update(body).digest("base64url");

export function encodeSession(uid: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ uid, exp: Math.floor(now / 1000) + MAX_AGE } satisfies Payload)).toString("base64url");
  return `v1.${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined, now = Date.now()): Payload | null {
  if (!token) return null;
  const [v, body, mac] = token.split(".");
  if (v !== "v1" || !body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    return p.exp * 1000 > now && typeof p.uid === "string" ? p : null;
  } catch {
    return null;
  }
}

/** Current session user id (signature + expiry checked), or null. Reads cookies, so it's request-time. */
export async function sessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  // Expiry checks need the current time: keep this (and everything after it) out of prerendered shells.
  await connection();
  return decodeSession(token)?.uid ?? null;
}

export async function startSession(uid: string) {
  (await cookies()).set(SESSION_COOKIE, encodeSession(uid), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
