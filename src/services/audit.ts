import { ulid } from "ulid";
import { db } from "../db/client.js";
import { auditLogs, webhookEvents } from "../db/schema.js";

export function writeAuditLog(params: {
  entityType: string;
  entityId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  actor: string;
}) {
  const now = new Date().toISOString();
  db.insert(auditLogs)
    .values({
      id: ulid(),
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      oldValue: params.oldValue != null ? JSON.stringify(params.oldValue) : null,
      newValue: params.newValue != null ? JSON.stringify(params.newValue) : null,
      actor: params.actor,
      createdAt: now,
    })
    .run();
}

export function logWebhookEvent(params: {
  source: string;
  payload: unknown;
  processed: boolean;
  idempotencyKey?: string;
}) {
  const now = new Date().toISOString();
  db.insert(webhookEvents)
    .values({
      id: ulid(),
      source: params.source,
      payload: JSON.stringify(params.payload),
      processed: params.processed,
      idempotencyKey: params.idempotencyKey ?? null,
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();
}

import { eq } from "drizzle-orm";

export function markWebhookEventProcessed(idempotencyKey: string) {
  db.update(webhookEvents)
    .set({ processed: true })
    .where(eq(webhookEvents.idempotencyKey, idempotencyKey))
    .run();
}
