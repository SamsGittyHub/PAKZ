"use client";
import { useEffect, useState } from "react";

export type Notice = { kind: "ok" | "error"; text: string } | null;

/** Inline status message that auto-clears. Announced to screen readers. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.kind === "error" ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [notice]);
  const el = notice ? (
    <div role="status" aria-live="polite"
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border px-3 py-2 text-sm shadow-lg ${notice.kind === "error" ? "border-[var(--critical)] bg-[var(--surface)] text-[var(--critical)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
      {notice.text}
    </div>
  ) : null;
  return { notice: el, ok: (text: string) => setNotice({ kind: "ok", text }), error: (text: string) => setNotice({ kind: "error", text }) };
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full max-w-lg overflow-y-auto bg-[var(--surface)] p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="card relative w-full max-w-md p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
