#!/usr/bin/env node
// Create an owner account, or promote an existing account / reset its password.
//   DATABASE_URL=... node scripts/create-owner.mjs you@example.com 'a-strong-password'
import postgres from "postgres";
import { ensureOwner } from "./lib.mjs";

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 10) {
  console.error("Usage: node scripts/create-owner.mjs <email> <password (10+ chars)>");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const id = await ensureOwner(sql, email, password);
  console.log(`✓ ${email} is an owner (${id})`);
} finally {
  await sql.end();
}
