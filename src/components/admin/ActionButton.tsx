"use client";
import { useTransition, type ReactNode } from "react";
import { useNotice } from "./Toast";

/** Button that runs a no-arg Server Action and shows the result. */
export function ActionButton({ action, children, confirmText, className = "btn" }: {
  action: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>;
  children: ReactNode; confirmText?: string; className?: string;
}) {
  const [pending, start] = useTransition();
  const { notice, ok, error } = useNotice();
  return (
    <>
      <button className={className} disabled={pending} onClick={() => {
        if (confirmText && !confirm(confirmText)) return;
        start(async () => { const r = await action(); if (r.ok) ok(r.message ?? "Done"); else error(r.error); });
      }}>{pending ? "Working…" : children}</button>
      {notice}
    </>
  );
}
