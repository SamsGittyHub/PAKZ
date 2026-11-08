// Shared by the migration runner and create-owner. Keep the hash format in sync with src/lib/password.ts.
import { randomBytes, scryptSync } from "node:crypto";

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Create the account if needed (or reset its password) and make it an owner. Returns the user id. */
export async function ensureOwner(sql, email, password) {
  const normalised = email.trim().toLowerCase();
  const [existing] = await sql`select id from auth.users where email = ${normalised}`;
  let id = existing?.id;
  if (!id) {
    [{ id }] = await sql`insert into auth.users (email, encrypted_password) values (${normalised}, ${hashPassword(password)}) returning id`;
  } else if (password) {
    await sql`update auth.users set encrypted_password = ${hashPassword(password)} where id = ${id}`;
  }
  await sql`insert into public.profiles (id, email) values (${id}, ${normalised}) on conflict (id) do nothing`;
  await sql`update public.profiles set role = 'owner' where id = ${id}`;
  return id;
}
