import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Archivo } from "next/font/google";
import { ShopHeader } from "@/components/shop/Header";
import { STORE_NAME } from "@/lib/shop/config";

const display = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display" });

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${display.variable} flex min-h-dvh flex-col bg-[var(--page)]`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-[var(--ink)] focus:px-3 focus:py-2 focus:text-[var(--page)]">Skip to content</a>
      <Suspense fallback={<HeaderFallback />}>
        <ShopHeader storeName={STORE_NAME} />
      </Suspense>
      <main id="main" className="flex-1">{children}</main>
      <footer className="mt-20 border-t border-[var(--border)]">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:grid-cols-4 sm:px-6">
          <div>
            <div className="shop-display text-3xl">{STORE_NAME}</div>
            <p className="mt-2 text-[var(--ink-2)]">Authenticated resale streetwear & sneakers.</p>
          </div>
          <nav className="flex flex-col gap-1.5" aria-label="Shop">
            <span className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Shop</span>
            <Link href="/shop" className="hover:underline">All items</Link>
            <Link href="/drops" className="hover:underline">Drops & raffles</Link>
            <Link href="/sell" className="hover:underline">Sell to us</Link>
          </nav>
          <nav className="flex flex-col gap-1.5" aria-label="Help">
            <span className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Help</span>
            <Link href="/info/shipping" className="hover:underline">Shipping</Link>
            <Link href="/info/returns" className="hover:underline">Returns</Link>
            <Link href="/info/authenticity" className="hover:underline">Authenticity</Link>
            <Link href="/info/privacy" className="hover:underline">Privacy & cookies</Link>
          </nav>
          <div className="text-[var(--ink-3)] sm:text-right">© {STORE_NAME}</div>
        </div>
      </footer>
    </div>
  );
}

function HeaderFallback() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--page)]">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6">
        <Link href="/" className="shop-display text-2xl leading-none">{STORE_NAME}</Link>
      </div>
    </header>
  );
}
