import "server-only";
import { headers } from "next/headers";

// Small in-memory sliding-window limiter for public forms (single web instance on Railway).
const hits = new Map<string, number[]>();

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** Returns true when allowed. `key` scopes the limit (e.g. "offer"). */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const id = `${key}:${await clientIp()}`;
  const now = Date.now();
  const recent = (hits.get(id) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(id, recent);
    return false;
  }
  recent.push(now);
  hits.set(id, recent);
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  }
  return true;
}
