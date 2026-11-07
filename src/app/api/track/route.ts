import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/supabase/admin";
import { ADMIN_COOKIE, TRACK_EVENT_TYPES, classifySource, deviceFromUserAgent, isBotUserAgent } from "@/lib/track/shared";

const uuid = z.string().uuid().optional();
const str = (max: number) => z.string().max(max).optional();

const Payload = z.object({
  session: z.object({
    id: z.string().min(8).max(64),
    visitor_id: str(64),
    consent: z.boolean(),
    landing_page: str(500),
    referrer: str(200),
    utm_source: str(100),
    utm_medium: str(100),
    utm_campaign: str(200),
  }),
  events: z.array(z.object({
    type: z.enum(TRACK_EVENT_TYPES),
    product_id: uuid,
    variant_id: uuid,
    category: str(100),
    brand: str(100),
    value: z.number().finite().optional(),
    query: str(200),
    props: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
    path: str(500),
    age_ms: z.number().min(0).max(3_600_000).optional(),
  })).min(1).max(50),
});

const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  // Exclude admin devices and obvious bots before doing any work.
  if (req.cookies.get(ADMIN_COOKIE)?.value === "1") return noContent();
  const ua = req.headers.get("user-agent");
  if (isBotUserAgent(ua)) return noContent();

  const raw = await req.text();
  if (raw.length > 64_000) return NextResponse.json({ error: "payload too large" }, { status: 413 });

  let parsed;
  try {
    parsed = Payload.safeParse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const { session, events } = parsed.data;

  const siteHost = req.headers.get("host");
  const { source, medium } = classifySource({
    referrerHost: session.referrer, utmSource: session.utm_source, utmMedium: session.utm_medium, siteHost,
  });

  // Declined consent → anonymous aggregate: no visitor id, no referrer host stored, no user linkage.
  const anonymous = !session.consent;
  const sessionRow = {
    id: session.id,
    visitor_id: anonymous ? null : session.visitor_id ?? null,
    consent: session.consent,
    landing_page: session.landing_page ?? null,
    referrer: anonymous ? null : session.referrer ?? null,
    source,
    medium,
    campaign: session.utm_campaign ?? null,
    device: deviceFromUserAgent(ua),
    country: req.headers.get("x-vercel-ip-country") ?? req.headers.get("cf-ipcountry") ?? null,
  };

  const cleanEvents = events
    .filter((e) => !(e.path ?? "").startsWith("/admin"))
    .map((e) => ({ ...e, query: e.query?.trim().toLowerCase() }));
  if (cleanEvents.length === 0) return noContent();

  const { error } = await db().rpc("track_ingest", { p_session: sessionRow, p_events: cleanEvents });
  if (error) {
    console.error("track_ingest failed", error.message);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
  return noContent();
}
