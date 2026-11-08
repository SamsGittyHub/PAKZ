"use client";
import { useSyncExternalStore } from "react";

/** Shopping bag kept in localStorage (works without cookies/consent); synced across tabs. */
export interface BagItem { variant_id: string; quantity: number }

const KEY = "pakz_bag";
const EMPTY: BagItem[] = [];
const listeners = new Set<() => void>();
let cacheRaw: string | null = null;
let cacheVal: BagItem[] = EMPTY;

function read(): BagItem[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { return EMPTY; }
  if (raw === cacheRaw) return cacheVal;
  cacheRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as BagItem[]) : [];
    cacheVal = Array.isArray(parsed) ? parsed.filter((i) => typeof i.variant_id === "string" && i.quantity > 0) : [];
  } catch {
    cacheVal = EMPTY;
  }
  return cacheVal;
}

function write(items: BagItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage blocked: bag lasts for this page only */ }
  cacheRaw = null;
  if (!items.length) { cacheVal = EMPTY; }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) l(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
}

export function useBag(): BagItem[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export const bag = {
  add(variant_id: string, quantity = 1, max = 99) {
    const items = [...read()];
    const i = items.findIndex((x) => x.variant_id === variant_id);
    if (i >= 0) items[i] = { variant_id, quantity: Math.min(items[i].quantity + quantity, max) };
    else items.push({ variant_id, quantity: Math.min(quantity, max) });
    write(items);
  },
  set(variant_id: string, quantity: number) {
    write(read().map((x) => (x.variant_id === variant_id ? { ...x, quantity } : x)).filter((x) => x.quantity > 0));
  },
  remove(variant_id: string) {
    write(read().filter((x) => x.variant_id !== variant_id));
  },
  clear() {
    write([]);
  },
  has(variant_id: string) {
    return read().some((x) => x.variant_id === variant_id);
  },
};
