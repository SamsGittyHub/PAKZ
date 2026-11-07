/** Shared between the browser tracker and /api/track. */

export const TRACK_EVENT_TYPES = [
  "page_view", "product_view", "search", "filter_used", "add_to_cart", "remove_from_cart",
  "checkout_started", "waitlist_signup", "offer_made", "engagement",
] as const;
export type TrackEventType = (typeof TRACK_EVENT_TYPES)[number];

export const CONSENT_COOKIE = "pakz_consent"; // "granted" | "denied"
export const ADMIN_COOKIE = "pakz_admin"; // set on admin devices; tracker + endpoint both ignore them

export interface TrackEvent {
  type: TrackEventType;
  product_id?: string;
  variant_id?: string;
  category?: string;
  brand?: string;
  value?: number;
  query?: string;
  props?: Record<string, string | number | boolean | null>;
  path?: string;
  /** ms between the event happening and the batch being sent */
  age_ms?: number;
}

export interface TrackSession {
  id: string;
  visitor_id?: string;
  consent: boolean;
  /** first-touch attribution — only sent on the first batch of a session */
  landing_page?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

export interface TrackPayload {
  session: TrackSession;
  events: TrackEvent[];
}

const BOT_UA = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|whatsapp|telegrambot|discordbot|preview|headless|phantomjs|selenium|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python-requests|httpclient|axios|node-fetch|go-http|java\//i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || ua.length < 20) return true;
  return BOT_UA.test(ua);
}

export function deviceFromUserAgent(ua: string | null | undefined): "mobile" | "tablet" | "desktop" {
  if (!ua) return "desktop";
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return "mobile";
  return "desktop";
}

/**
 * Normalise first-touch attribution into a channel. UTM wins over referrer.
 * Returns { source, medium }.
 */
export function classifySource(input: {
  referrerHost?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  siteHost?: string | null;
}): { source: string; medium: string | null } {
  const utm = input.utmSource?.toLowerCase().trim();
  const medium = input.utmMedium?.toLowerCase().trim() || null;
  const pick = (s: string): string | null => {
    if (/(^|\.)(instagram|ig)(\.|$)|^ig$|l\.instagram/.test(s)) return "instagram";
    if (/tiktok/.test(s)) return "tiktok";
    if (/(^|\.)google\.|^google$|googleadservices|gclid/.test(s)) return "google";
    if (/(facebook|fb\.|^fb$|m\.facebook|l\.facebook)/.test(s)) return "facebook";
    if (/(twitter|^t\.co$|x\.com)/.test(s)) return "twitter";
    if (/(bing|duckduckgo|yahoo|ecosia|baidu)/.test(s)) return "search";
    if (/(youtube|youtu\.be)/.test(s)) return "youtube";
    if (/(pinterest)/.test(s)) return "pinterest";
    if (/(reddit)/.test(s)) return "reddit";
    if (/(mail|newsletter|klaviyo|mailchimp|resend)/.test(s)) return "email";
    return null;
  };
  if (utm) {
    const known = pick(utm);
    if (medium && /(cpc|paid|ppc|ads?)/.test(medium)) return { source: known ? `${known}` : "paid", medium };
    return { source: known ?? utm.slice(0, 40), medium };
  }
  const host = input.referrerHost?.toLowerCase().replace(/^www\./, "");
  if (!host || (input.siteHost && host === input.siteHost.replace(/^www\./, ""))) return { source: "direct", medium: null };
  return { source: pick(host) ?? "referral", medium: "referral" };
}
