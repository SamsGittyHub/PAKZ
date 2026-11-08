import "server-only";
import { db } from "@/lib/db";
import type { AdminUser } from "@/lib/auth";

export async function audit(admin: AdminUser, action: string, entity: string, entityId: string | null, diff?: unknown) {
  const { error } = await db().from("audit_log").insert({
    admin_id: admin.id,
    admin_email: admin.email,
    action,
    entity,
    entity_id: entityId,
    diff: diff ?? null,
  });
  if (error) console.error("audit_log insert failed", error.message);
}
