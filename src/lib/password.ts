import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Format: scrypt$N$r$p$salt$hash (base64). Keep in sync with scripts/lib.mjs.
const N = 16384, R = 8, P = 1, KEYLEN = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, len: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, len, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Readable temporary password for invites/resets (about 80 bits). */
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("").replace(/(.{4})(?=.)/g, "$1-");
}
