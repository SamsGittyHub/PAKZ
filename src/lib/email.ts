import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

export interface Mail {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/** Send an email via Resend. Returns false (and logs) when email isn't configured. */
export async function sendEmail(mail: Mail): Promise<boolean> {
  const key = env.resendKey();
  const from = env.emailFrom();
  if (!key || !from) {
    console.warn(`[email] not configured — skipped "${mail.subject}"`);
    return false;
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({ from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
  if (error) {
    console.error("[email] send failed", error);
    return false;
  }
  return true;
}

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function shippedEmail(o: { number: number; name?: string | null; carrier?: string | null; tracking?: string | null; trackingUrl?: string | null; store: string }) {
  const link = o.trackingUrl ? `<p><a href="${esc(o.trackingUrl)}">Track your parcel</a></p>` : "";
  return {
    subject: `Your ${o.store} order #${o.number} has shipped`,
    html: `<p>Hi ${esc(o.name ?? "there")},</p><p>Good news — order <b>#${o.number}</b> is on its way${o.carrier ? ` with ${esc(o.carrier)}` : ""}.</p>${o.tracking ? `<p>Tracking number: <b>${esc(o.tracking)}</b></p>` : ""}${link}<p>Thanks for shopping with ${esc(o.store)}.</p>`,
  };
}

export function trackingUrl(carrier: string | null | undefined, tracking: string | null | undefined): string | null {
  if (!tracking) return null;
  const t = encodeURIComponent(tracking);
  switch ((carrier ?? "").toLowerCase()) {
    case "royal mail": return `https://www.royalmail.com/track-your-item#/tracking-results/${t}`;
    case "evri": return `https://www.evri.com/track/parcel/${t}`;
    case "dpd": return `https://track.dpd.co.uk/parcels/${t}`;
    case "ups": return `https://www.ups.com/track?tracknum=${t}`;
    case "dhl": return `https://www.dhl.com/gb-en/home/tracking.html?tracking-id=${t}`;
    case "fedex": return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
    default: return null;
  }
}
