"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { installLifecycle, pageView } from "@/lib/track/client";

/** Mount once in the root layout. Tracks page views on every client navigation. */
export function Analytics() {
  const pathname = usePathname();
  useEffect(() => { installLifecycle(); }, []);
  useEffect(() => { if (pathname) pageView(pathname); }, [pathname]);
  return null;
}
