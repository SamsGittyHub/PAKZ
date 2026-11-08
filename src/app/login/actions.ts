"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { endSession, startSession } from "@/lib/session";

export type LoginState = { error?: string };

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "/admin";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/admin";
}

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(form.get("next"));
  if (!email || !password) return { error: "Enter your email and password" };

  const { data } = await db().rpc("auth_find_user", { p_email: email });
  const user = (data as { id: string; encrypted_password: string | null }[] | null)?.[0];
  const ok = await verifyPassword(password, user?.encrypted_password);
  if (!user || !ok) {
    await new Promise((r) => setTimeout(r, 400)); // blunt brute-force attempts a little
    return { error: "Invalid email or password" };
  }
  const { data: profile } = await db().from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "owner" && profile.role !== "staff")) return { error: "This account doesn't have admin access" };

  await startSession(user.id);
  await db().rpc("auth_touch_login", { p_user_id: user.id });
  redirect(next);
}

export async function logout() {
  await endSession();
  redirect("/login");
}
