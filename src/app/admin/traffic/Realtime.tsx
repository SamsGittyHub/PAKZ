"use client";
import { useEffect, useState } from "react";

interface Realtime { active: number; pages: { path: string | null; title: string | null; visitors: number }[] }

/** Active visitors in the last 5 minutes; polls every 15s while the tab is visible. */
export function RealtimeWidget() {
  const [data, setData] = useState<Realtime | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/admin/realtime").then((r) => r.ok ? r.json() : null).then((d) => live && d && setData(d)).catch(() => {});
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--good)] opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--good)]" />
        </span>
        <span className="text-3xl font-semibold tracking-tight">{data?.active ?? "–"}</span>
        <span className="muted text-sm">active now</span>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {(data?.pages ?? []).map((p, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="truncate">{p.title ?? p.path ?? "—"}</span><span className="tnum">{p.visitors}</span>
          </li>
        ))}
        {data && data.pages.length === 0 && <li className="faint">Nobody browsing right now.</li>}
      </ul>
    </div>
  );
}
