"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3, Boxes, ClipboardList, Cog, FileText, Gauge, HandCoins, Lightbulb, LineChart, LogOut, Menu,
  Package, PoundSterling, Repeat, ShoppingBag, Sparkles, Users, X,
} from "lucide-react";
import { ADMIN_COOKIE } from "@/lib/track/shared";

const NAV = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/inventory", label: "Inventory", icon: Boxes },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
  { href: "/admin/offers", label: "Offers", icon: HandCoins },
  { href: "/admin/drops", label: "Drops & raffles", icon: Sparkles },
  { href: "/admin/sell-requests", label: "Sell to us", icon: Repeat },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/revenue", label: "Revenue & profit", icon: PoundSterling, owner: true },
  { href: "/admin/traffic", label: "Traffic", icon: BarChart3 },
  { href: "/admin/forecasts", label: "Forecasts", icon: LineChart },
  { href: "/admin/recommendations", label: "What to stock", icon: Lightbulb },
  { href: "/admin/reports", label: "Reports & alerts", icon: FileText },
  { href: "/admin/tasks", label: "Purchase tasks", icon: ClipboardList },
  { href: "/admin/settings", label: "Settings", icon: Cog, owner: true },
];

const RANGE_KEYS = ["range", "from", "to", "compare"];

export function Sidebar({ role, email, logout }: { role: "owner" | "staff"; email: string; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  // Mark this device as an admin so the storefront tracker ignores it.
  useEffect(() => {
    document.cookie = `${ADMIN_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, []);

  // Carry the selected date range across sections.
  const q = new URLSearchParams();
  RANGE_KEYS.forEach((k) => { const v = params.get(k); if (v) q.set(k, v); });
  const suffix = q.toString() ? `?${q}` : "";

  const items = NAV.filter((n) => !n.owner || role === "owner");
  const active = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  const nav = (
    <nav className="flex h-full flex-col gap-0.5 p-3">
      <Link href={`/admin${suffix}`} className="mb-4 px-2 pt-1 text-lg font-semibold tracking-tight">PAKZ <span className="faint text-sm font-normal">admin</span></Link>
      {items.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={`${href}${suffix}`}
          aria-current={active(href) ? "page" : undefined}
          onClick={() => setOpen(false)}
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${active(href) ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`}
        >
          <Icon size={16} aria-hidden /> {label}
        </Link>
      ))}
      <div className="mt-auto border-t border-[var(--border)] px-2 pt-3 text-xs">
        <div className="truncate text-[var(--ink-2)]">{email}</div>
        <div className="faint mb-2 capitalize">{role}</div>
        <form action={logout}><button className="btn btn-sm btn-ghost -ml-2"><LogOut size={14} /> Sign out</button></form>
      </div>
    </nav>
  );

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 lg:hidden">
        <span className="font-semibold">PAKZ <span className="faint text-sm font-normal">admin</span></span>
        <button className="btn btn-sm" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={16} /></button>
      </header>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-[var(--surface)] shadow-xl">
            <button className="btn btn-sm btn-ghost absolute right-2 top-2" aria-label="Close menu" onClick={() => setOpen(false)}><X size={16} /></button>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}

export function SidebarSkeleton() {
  return <aside className="hidden h-dvh w-60 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] lg:block" />;
}
