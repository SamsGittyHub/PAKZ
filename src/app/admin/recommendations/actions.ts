"use server";
import { refresh } from "next/cache";
import { assertAdmin } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { audit } from "@/lib/audit";

export async function setRecommendationStatus(id: string, status: "dismissed" | "actioned" | "new") {
  try {
    const admin = await assertAdmin();
    must(await db().from("recommendations").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select("id"), "recommendation");
    await audit(admin, `recommendation.${status}`, "recommendation", id);
    refresh();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createPurchaseTask(recommendationId: string, title: string, notes: string, due?: string) {
  try {
    const admin = await assertAdmin();
    const t = must(await db().from("purchase_tasks").insert({ title, notes, recommendation_id: recommendationId, due_date: due || null, created_by: admin.id }).select("id").single(), "task");
    await db().from("recommendations").update({ status: "actioned", updated_at: new Date().toISOString() }).eq("id", recommendationId);
    await audit(admin, "task.create", "purchase_task", t.id, { recommendationId });
    refresh();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setTaskStatus(id: string, status: "open" | "done" | "cancelled") {
  try {
    const admin = await assertAdmin();
    must(await db().from("purchase_tasks").update({ status }).eq("id", id).select("id"), "task");
    await audit(admin, `task.${status}`, "purchase_task", id);
    refresh();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
