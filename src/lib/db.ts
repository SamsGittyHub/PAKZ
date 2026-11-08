import "server-only";
import { createHmac } from "node:crypto";
import { PostgrestClient } from "@supabase/postgrest-js";
import { env } from "@/lib/env";

/** HS256 JWT PostgREST accepts as the service_role (bypasses RLS). Never sent to the browser. */
function serviceToken(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role" })}`;
  return `${body}.${createHmac("sha256", env.jwtSecret).update(body).digest("base64url")}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: PostgrestClient<any> | null = null;

/**
 * Server-side database client (PostgREST as service_role). Only use after the caller has been authorised
 * (requireAdmin / requireOwner, the cron secret, or a verified webhook).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function db(): PostgrestClient<any> {
  client ??= new PostgrestClient(env.postgrestUrl, {
    headers: { Authorization: `Bearer ${serviceToken()}` },
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  });
  return client;
}

/** Call an RPC and throw on error. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Throw on a PostgREST error, return data. */
export function must<T>(res: { data: T; error: { message: string } | null }, what = "query"): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}
