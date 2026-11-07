"use server";
import { refresh } from "next/cache";
import { assertAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { refreshRollups, runForecasts, runLogged, runRecommendations } from "@/lib/jobs/nightly";
import { generateBuyingBrief } from "@/lib/jobs/brief";
import { db } from "@/lib/supabase/admin";

export async function recomputeAnalytics() {
  try {
    const admin = await assertAdmin(true);
    const result = await runLogged("manual_recompute", async () => ({
      rollups: await refreshRollups(3), forecasts: await runForecasts(), recommendations: await runRecommendations(),
    }));
    await audit(admin, "analytics.recompute", "analytics", null, result);
    refresh();
    return { ok: true as const, message: `Forecasts: ${result.forecasts.rows} rows · ${result.recommendations.inserted} new recommendations` };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function generateBriefNow() {
  try {
    const admin = await assertAdmin(true);
    const { data } = await db().from("store_settings").select("timezone").eq("id", 1).single();
    const b = await generateBuyingBrief(data?.timezone ?? "UTC");
    if (!b) return { ok: false as const, error: "Not generated — set ANTHROPIC_API_KEY, or the model declined." };
    await audit(admin, "brief.generate", "ai_brief", null, { model: b.model });
    refresh();
    return { ok: true as const, message: "Buying Brief generated" };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
