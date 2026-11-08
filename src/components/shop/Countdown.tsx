"use client";
import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Live countdown; renders nothing until mounted so server and client markup match. */
export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  if (now == null) return <span className="tnum font-mono text-2xl opacity-0">00:00:00</span>;
  const { d, h, m, s } = parts(Date.parse(to) - now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="tnum font-mono text-2xl sm:text-3xl" aria-label={`Starts in ${d} days ${h} hours ${m} minutes`}>
      {d > 0 && `${d}d `}{pad(h)}:{pad(m)}:{pad(s)}
    </span>
  );
}
