#!/usr/bin/env node
// Apply db/migrations in order (each in a transaction, recorded in public.schema_migrations), then:
//  - ensure the PostgREST login role `authenticator` (AUTHENTICATOR_PASSWORD)
//  - create the first owner if none exists yet (OWNER_EMAIL + OWNER_PASSWORD)
//  - optionally load demo data (--seed, only into an empty catalogue)
//  - tell PostgREST to reload its schema cache
// Runs as Railway's pre-deploy command, and locally via `npm run db:migrate`.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { ensureOwner } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const seed = process.argv.includes("--seed");
const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 30 });

try {
  await sql`create table if not exists public.schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select version from public.schema_migrations`).map((r) => r.version));
  const files = readdirSync(join(root, "db/migrations")).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(join(root, "db/migrations", file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.schema_migrations (version) values (${file})`;
    });
    console.log(`applied ${file}`);
    count++;
  }
  console.log(count ? `${count} migration(s) applied` : "schema up to date");

  const authPassword = process.env.AUTHENTICATOR_PASSWORD;
  if (authPassword) {
    const [{ exists }] = await sql`select exists (select 1 from pg_roles where rolname = 'authenticator')`;
    const pw = authPassword.replace(/'/g, "''");
    await sql.unsafe(exists
      ? `alter role authenticator with login noinherit password '${pw}'`
      : `create role authenticator with login noinherit password '${pw}'`);
    await sql.unsafe("grant anon, authenticated, service_role to authenticator");
    console.log("authenticator role ready");
  }

  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  if (ownerEmail && ownerPassword) {
    const [{ n }] = await sql`select count(*)::int as n from public.profiles where role = 'owner'`;
    if (n === 0) {
      await ensureOwner(sql, ownerEmail, ownerPassword);
      console.log(`created owner ${ownerEmail}`);
    }
  }

  if (seed) {
    const [{ n }] = await sql`select count(*)::int as n from public.products`;
    if (n === 0) {
      await sql.unsafe(readFileSync(join(root, "db/seed.sql"), "utf8"));
      console.log("demo data loaded");
    } else {
      console.log("catalogue not empty — seed skipped");
    }
  }

  await sql`notify pgrst, 'reload schema'`;
} catch (e) {
  console.error("migration failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
