"use server";
import { redirect } from "next/navigation";
import { authClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export type LoginState = { error?: string; sent?: boolean };

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "/admin";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/admin";
}

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(form.get("next"));
  const supabase = await authClient();

  if (!password) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${env.siteUrl}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    return error ? { error: error.message } : { sent: true };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Invalid email or password" };
  redirect(next);
}

export async function logout() {
  const supabase = await authClient();
  await supabase.auth.signOut();
  redirect("/login");
}
