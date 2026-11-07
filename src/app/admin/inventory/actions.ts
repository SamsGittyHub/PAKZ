"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

type Result = { ok: true; message: string } | { ok: false; error: string };

const Adjust = z.object({
  variant_id: z.string().uuid(),
  change: z.coerce.number().int().refine((n) => n !== 0, "Change can't be zero"),
  reason: z.enum(["adjustment", "damaged", "return", "reserved", "released"]),
  note: z.string().trim().max(500).optional().default(""),
});

export async function adjustStock(input: z.input<typeof Adjust>): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const a = Adjust.parse(input);
    const change = a.reason === "damaged" || a.reason === "reserved" ? -Math.abs(a.change) : a.reason === "return" || a.reason === "released" ? Math.abs(a.change) : a.change;
    const { data, error } = await db().rpc("adjust_stock", {
      p_variant_id: a.variant_id, p_change: change, p_reason: a.reason, p_note: a.note || null, p_admin_id: admin.id,
    });
    if (error) throw new Error(error.message);
    await audit(admin, "stock.adjust", "variant", a.variant_id, { change, reason: a.reason, note: a.note });
    refresh();
    return { ok: true, message: `Stock now ${data}` };
  } catch (e) {
    return { ok: false, error: e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : String(e) };
  }
}

const Receive = z.object({
  variant_id: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(10_000),
  unit_cost: z.coerce.number().min(0),
  source: z.enum(["retail", "resale", "consignment", "private"]),
  fees: z.coerce.number().min(0).default(0),
  shipping_in: z.coerce.number().min(0).default(0),
  acquired_at: z.string().optional(),
  note: z.string().trim().max(500).optional(),
});

/** Log a purchase lot: updates quantity and moves the weighted-average cost basis. */
export async function receiveStock(input: z.input<typeof Receive>): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const r = Receive.parse(input);
    const { data, error } = await db().rpc("receive_stock", {
      p_variant_id: r.variant_id, p_quantity: r.quantity, p_unit_cost: r.unit_cost, p_source: r.source, p_fees: r.fees,
      p_shipping_in: r.shipping_in, p_acquired_at: r.acquired_at ? new Date(r.acquired_at).toISOString() : new Date().toISOString(),
      p_note: r.note || null, p_admin_id: admin.id,
    });
    if (error) throw new Error(error.message);
    await audit(admin, "stock.receive", "variant", r.variant_id, { quantity: r.quantity, source: r.source });
    refresh();
    const res = data as { quantity: number; cost_price: number };
    return { ok: true, message: admin.canSeeCosts ? `Received. ${res.quantity} in stock, avg cost ${res.cost_price}` : `Received. ${res.quantity} in stock` };
  } catch (e) {
    return { ok: false, error: e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : String(e) };
  }
}
