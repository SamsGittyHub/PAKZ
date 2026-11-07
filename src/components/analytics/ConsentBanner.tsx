"use client";
import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { setConsent } from "@/lib/track/client";
import { ADMIN_COOKIE, CONSENT_COOKIE } from "@/lib/track/shared";

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const undecided = () => !document.cookie.includes(`${CONSENT_COOKIE}=`) && !document.cookie.includes(`${ADMIN_COOKIE}=1`);

/** Minimal cookie-consent banner (storefront only). Declining keeps anonymous, storage-free aggregate tracking. */
export function ConsentBanner() {
  const pathname = usePathname(); // re-evaluate on client navigation
  const undecidedNow = useSyncExternalStore(subscribe, undecided, () => false);
  const hidden = pathname.startsWith("/admin") || pathname.startsWith("/login");
  if (!undecidedNow || hidden) return null;
  const decide = (granted: boolean) => { setConsent(granted); listeners.forEach((l) => l()); };
  return (
    <div role="dialog" aria-label="Cookie consent" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-xl border border-black/10 bg-white p-4 text-sm text-neutral-800 shadow-lg dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200">
      <p>We use first-party cookies to understand what you browse so we can stock what you want. No ads, no third parties.</p>
      <div className="mt-3 flex gap-2">
        <button className="rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white dark:bg-white dark:text-neutral-900" onClick={() => decide(true)}>Accept</button>
        <button className="rounded-lg border border-black/10 px-3 py-1.5 dark:border-white/15" onClick={() => decide(false)}>Decline</button>
      </div>
    </div>
  );
}
