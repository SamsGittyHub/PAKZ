"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { db, must } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

const Expense = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(["packaging", "ads", "subscriptions", "shipping_supplies", "fees", "software", "travel", "other"]),
  description: z.string().max(500).optional(),
  amount: z.coerce.number().positive(),
});

export async function addExpense(input: z.input<typeof Expense>) {
  try {
    const admin = await assertAdmin(true);
    const e = Expense.parse(input);
    const row = must(await db().from("expenses").insert({ ...e, created_by: admin.id }).select("id").single(), "expense");
    await audit(admin, "expense.create", "expense", row.id, e);
    refresh();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteExpense(id: string) {
  try {
    const admin = await assertAdmin(true);
    must(await db().from("expenses").delete().eq("id", id).select("id"), "expense");
    await audit(admin, "expense.delete", "expense", id);
    refresh();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
