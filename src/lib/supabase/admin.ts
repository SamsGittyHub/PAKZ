import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let client: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS — only use after the caller has been authorised
 * (requireAdmin / requireOwner, cron secret, or a verified webhook).
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Call an RPC and throw on error. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Throw on a Supabase error, return data. */
export function must<T>(res: { data: T; error: { message: string } | null }, what = "query"): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}
