// Create (or promote) an owner account.
//   node --env-file=.env.local scripts/create-owner.mjs you@example.com 'a-strong-password'
import { createClient } from "@supabase/supabase-js";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: node --env-file=.env.local scripts/create-owner.mjs <email> <password>");
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let userId;
const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) {
  if (!/already/i.test(created.error.message)) throw created.error;
  const { data } = await db.from("profiles").select("id").eq("email", email).single();
  userId = data.id;
} else {
  userId = created.data.user.id;
}
await db.from("profiles").upsert({ id: userId, email }, { onConflict: "id" });
const { error } = await db.from("profiles").update({ role: "owner" }).eq("id", userId);
if (error) throw error;
console.log(`✓ ${email} is an owner (${userId})`);
