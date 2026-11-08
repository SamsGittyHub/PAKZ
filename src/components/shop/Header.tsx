"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, Search, ShoppingBag, X } from "lucide-react";
import { useBag } from "./bag-store";

const NAV = [
  { href: "/shop", label: "Shop" },
  { href: "/shop?sort=new", label: "New in" },
  { href: "/drops", label: "Drops" },
  { href: "/sell", label: "Sell to us" },
];

export function ShopHeader({ storeName }: { storeName: string }) {
  const items = useBag();
  const count = items.reduce((a, i) => a + i.quantity, 0);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--page)]/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <button className="-ml-1 p-1 md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={20} /></button>
        <Link href="/" className="shop-display text-2xl leading-none" aria-label={`${storeName} home`}>{storeName}</Link>
        <nav className="ml-6 hidden gap-6 text-sm md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`hover:underline ${pathname === n.href.split("?")[0] ? "font-semibold" : "text-[var(--ink-2)]"}`}>{n.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          {searchOpen ? (
            <form action="/shop" className="flex items-center" role="search">
              <input name="q" autoFocus placeholder="Search brands, items…" aria-label="Search"
                className="w-40 border-b border-[var(--ink)] bg-transparent px-1 py-1 text-sm outline-none sm:w-64"
                onBlur={(e) => !e.currentTarget.value && setSearchOpen(false)} />
            </form>
          ) : (
            <button className="p-2" aria-label="Search" onClick={() => setSearchOpen(true)}><Search size={19} /></button>
          )}
          <Link href="/bag" className="relative p-2" aria-label={`Bag, ${count} item${count === 1 ? "" : "s"}`}>
            <ShoppingBag size={19} />
            {count > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--ink)] px-1 text-[10px] font-semibold text-[var(--page)]">{count}</span>}
          </Link>
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <nav className="absolute inset-y-0 left-0 flex w-72 flex-col gap-1 bg-[var(--page)] p-5">
            <button className="mb-4 self-end p-1" aria-label="Close menu" onClick={() => setOpen(false)}><X size={20} /></button>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="shop-display py-2 text-3xl">{n.label}</Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
