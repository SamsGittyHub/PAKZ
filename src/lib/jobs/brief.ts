import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db, must, rpc } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { addDays, localDate, zonedMidnight } from "@/lib/dates";

export const BRIEF_MODEL = "claude-opus-5-5";

const SYSTEM = `You write a weekly "Buying Brief" for the owner of a small resale streetwear and sneaker store.
You receive aggregated store metrics as JSON (no customer data). Write for a busy owner reading on their phone:
- Start with a 2–3 sentence summary of the week.
- Then three short sections with markdown headings: "What's working", "What to buy", "What to drop or discount".
- Each point names the brand/category/size and cites the number behind it (views, sell-through, days to sell, margin, searches).
- Prefer the recommendations provided; don't invent products, prices or numbers that aren't in the data.
- If data is thin (few sales or low traffic), say so plainly and keep advice cautious.
- Under 350 words. No preamble, no sign-off.`;

const EMAIL_OR_PHONE = /[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d[\d\s-]{7,}\d/g;
/** Search queries are free text typed by shoppers — scrub anything that looks like contact details. */
const scrub = (s: string) => s.replace(EMAIL_OR_PHONE, "[redacted]");

/** Aggregated, PII-free metrics for the LLM. Never includes customers, emails, addresses or order ids. */
export async function buildBriefInput(tz: string) {
  const today = localDate(tz);
  const to = zonedMidnight(addDays(today, 1), tz);
  const from = zonedMidnight(addDays(today, -6), tz);
  const prevFrom = zonedMidnight(addDays(today, -13), tz);
  const args = { p_from: from.toISOString(), p_to: to.toISOString() };
  const [kpis, prev, categories, brands, sizes, searches, recs, forecasts] = await Promise.all([
    rpc("admin_kpis", args),
    rpc("admin_kpis", { p_from: prevFrom.toISOString(), p_to: from.toISOString() }),
    rpc<Record<string, unknown>[]>("admin_breakdown", { ...args, p_dim: "category" }),
    rpc<Record<string, unknown>[]>("admin_breakdown", { ...args, p_dim: "brand" }),
    rpc<Record<string, unknown>[]>("admin_breakdown", { ...args, p_dim: "size" }),
    rpc<{ query: string; searches: number; zero_result_searches: number }[]>("admin_search_terms", { ...args, p_limit: 20 }),
    db().from("recommendations").select("type, scope, scope_value, title, reason, score").eq("status", "new").order("score", { ascending: false }).limit(15),
    db().from("forecasts").select("scope, scope_value, period, predicted_revenue, predicted_units, confidence_low, confidence_high, low_data")
      .in("scope", ["overall", "category"]).eq("period", 30).order("generated_at", { ascending: false }).limit(20),
  ]);
  const strip = (rows: Record<string, unknown>[]) => rows.slice(0, 10).map(({ key: _k, ...r }) => (void _k, r));
  return {
    week: { from: addDays(today, -6), to: today },
    kpis_this_week: kpis,
    kpis_previous_week: prev,
    top_categories: strip(categories),
    top_brands: strip(brands),
    top_sizes: strip(sizes),
    searches: searches.map((s) => ({ ...s, query: scrub(s.query) })),
    recommendations: must(recs, "recs").map((r) => ({ ...r, scope_value: r.scope === "keyword" ? scrub(r.scope_value) : r.scope === "product" || r.scope === "variant" ? undefined : r.scope_value })),
    forecasts_next_30_days: must(forecasts, "forecasts"),
  };
}

export async function generateBuyingBrief(tz: string): Promise<{ content: string; model: string } | null> {
  if (!env.anthropicKey()) return null;
  const input = await buildBriefInput(tz);
  const client = new Anthropic({ apiKey: env.anthropicKey() });

  // Server-side fallbacks: if a safety classifier declines, the API retries on a fallback model in the same call.
  const response = await client.beta.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: SYSTEM,
    messages: [{ role: "user", content: `Store metrics for the last 7 days:\n\n${JSON.stringify(input)}` }],
  });

  if (response.stop_reason === "refusal") {
    console.warn("[brief] model declined", response.stop_details);
    return null;
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) return null;

  const weekStart = input.week.from;
  must(await db().from("ai_briefs").insert({ week_start: weekStart, model: response.model, content: text, input }).select("id"), "ai_briefs");
  return { content: text, model: response.model };
}
