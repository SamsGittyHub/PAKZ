"use client";
import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm">
        <span className="text-[var(--ink-2)]">Email</span>
        <input name="email" type="email" required autoComplete="email" className="input mt-1" />
      </label>
      <label className="block text-sm">
        <span className="text-[var(--ink-2)]">Password <span className="text-[var(--ink-3)]">(leave blank for a magic link)</span></span>
        <input name="password" type="password" autoComplete="current-password" className="input mt-1" />
      </label>
      {state.error && <p className="text-sm text-[var(--critical)]">{state.error}</p>}
      {state.sent && <p className="text-sm text-[var(--good-ink)]">Check your inbox for a sign-in link.</p>}
      <button disabled={pending} className="btn btn-primary w-full">{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
