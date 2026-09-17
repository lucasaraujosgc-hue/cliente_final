import type { Request } from "express";
import { db } from "../db";
import { auditLog } from "../schema";

// Records a durable trail of who-did-what on the accountant panel. Best-effort:
// a logging failure must never break the action being logged.
export async function logAudit(
  req: Request,
  action: string,
  opts: {
    targetType?: string;
    targetId?: string;
    summary?: string;
    metadata?: unknown;
  } = {},
) {
  try {
    const user = req.user;
    const actor = user
      ? user.role === "client"
        ? `client:${user.clientId}`
        : user.role
      : req.integrationClient
        ? `integration:${req.integrationClient.id}`
        : "unknown";

    await db.insert(auditLog).values({
      actor,
      action,
      targetType: opts.targetType,
      targetId: opts.targetId != null ? String(opts.targetId) : null,
      summary: opts.summary,
      metadata: (opts.metadata ?? null) as any,
    });
  } catch (err) {
    console.error("logAudit failed:", action, err);
  }
}
