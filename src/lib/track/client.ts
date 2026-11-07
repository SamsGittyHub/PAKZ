"use client";
/**
 * First-party analytics tracker. No third-party dependency.
 *
 * - Batches events; flushes every 5s, at 20 events, and via sendBeacon when the page is hidden/unloaded.
 * - Consent granted  → persistent visitor id (localStorage) + 30-minute rolling session.
 * - Consent declined → anonymous aggregate mode: in-memory session id only (per tab, reset on reload),
 *                      no visitor id, no user id. Nothing is written to storage.
 * - Never runs for admin devices (pakz_admin cookie), automated browsers (navigator.webdriver) or /admin pages.
 */
import { ADMIN_COOKIE, CONSENT_COOKIE, type TrackEvent, type TrackEventType, type TrackPayload, type TrackSession } from "./shared";

const ENDPOINT = "/api/track";
const FLUSH_MS = 5000;
const MAX_BATCH = 20;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const LS_VISITOR = "pakz_vid";
const LS_SESSION = "pakz_sid";

type Queued = TrackEvent & { at: number };

let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let memorySessionId: string | null = null;
const sentFirstTouch = new Set<string>();
let pageContext: Pick<TrackEvent, "product_id" | "category" | "brand"> = {};
let pageShownAt = 0;
let visibleMs = 0;

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function cookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function hasConsent(): boolean {
  return cookie(CONSENT_COOKIE) === "granted";
}

export function setConsent(granted: boolean) {
  document.cookie = `${CONSENT_COOKIE}=${granted ? "granted" : "denied"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  if (!granted) {
    try { localStorage.removeItem(LS_VISITOR); localStorage.removeItem(LS_SESSION); } catch {}
  }
}

function disabled(): boolean {
  if (typeof window === "undefined") return true;
  if (cookie(ADMIN_COOKIE) === "1") return true;
  if ((navigator as Navigator & { webdriver?: boolean }).webdriver) return true;
  if (location.pathname.startsWith("/admin")) return true;
  return false;
}

function session(): TrackSession {
  const consent = hasConsent();
  if (!consent) {
    memorySessionId ??= `anon-${uuid()}`;
    return { id: memorySessionId, consent: false };
  }
  let visitor: string | null = null;
  let sid: string | null = null;
  try {
    visitor = localStorage.getItem(LS_VISITOR);
    if (!visitor) { visitor = uuid(); localStorage.setItem(LS_VISITOR, visitor); }
    const raw = localStorage.getItem(LS_SESSION);
    const parsed = raw ? (JSON.parse(raw) as { id: string; last: number }) : null;
    sid = parsed && Date.now() - parsed.last < SESSION_TIMEOUT_MS ? parsed.id : uuid();
    localStorage.setItem(LS_SESSION, JSON.stringify({ id: sid, last: Date.now() }));
  } catch {
    sid = memorySessionId ??= uuid();
  }
  return { id: sid!, visitor_id: visitor ?? undefined, consent: true };
}

function firstTouch(s: TrackSession): TrackSession {
  if (sentFirstTouch.has(s.id)) return s;
  sentFirstTouch.add(s.id);
  const url = new URL(location.href);
  let referrer: string | undefined;
  try { referrer = document.referrer ? new URL(document.referrer).host : undefined; } catch {}
  return {
    ...s,
    landing_page: url.pathname,
    referrer,
    utm_source: url.searchParams.get("utm_source") ?? undefined,
    utm_medium: url.searchParams.get("utm_medium") ?? undefined,
    utm_campaign: url.searchParams.get("utm_campaign") ?? undefined,
  };
}

function flush(useBeacon = false) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (queue.length === 0 || disabled()) { queue = []; return; }
  const now = Date.now();
  const events = queue.splice(0, 50).map(({ at, ...e }) => ({ ...e, age_ms: now - at }));
  const payload: TrackPayload = { session: firstTouch(session()), events };
  const body = JSON.stringify(payload);
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
  } else {
    fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
  }
  if (queue.length) schedule();
}

function schedule() {
  if (!timer) timer = setTimeout(() => flush(), FLUSH_MS);
}

/** Record an event. Safe to call anywhere; no-ops on the server and for admins/bots. */
export function track(type: TrackEventType, data: Omit<TrackEvent, "type" | "path" | "age_ms"> = {}) {
  if (disabled()) return;
  queue.push({ type, path: location.pathname, ...data, at: Date.now() });
  if (queue.length >= MAX_BATCH) flush();
  else schedule();
}

/** Product pages call this so engagement time is attributed to the product. */
export function setPageContext(ctx: Pick<TrackEvent, "product_id" | "category" | "brand">) {
  pageContext = ctx;
}

function endPageEngagement() {
  if (pageShownAt) visibleMs += Date.now() - pageShownAt;
  pageShownAt = 0;
  const seconds = Math.round(visibleMs / 1000);
  if (seconds >= 1 && seconds < 3600) track("engagement", { value: seconds, ...pageContext });
  visibleMs = 0;
}

/** Called by <Analytics/> on every route change. */
export function pageView(path: string) {
  if (disabled()) return;
  endPageEngagement();
  pageContext = {};
  pageShownAt = document.visibilityState === "visible" ? Date.now() : 0;
  queue.push({ type: "page_view", path, at: Date.now() });
  schedule();
}

let installed = false;
export function installLifecycle() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (pageShownAt) { visibleMs += Date.now() - pageShownAt; pageShownAt = 0; }
      endPageEngagement();
      flush(true);
    } else {
      pageShownAt = Date.now();
    }
  });
  window.addEventListener("pagehide", () => flush(true));
}
