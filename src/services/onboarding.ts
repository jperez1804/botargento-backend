import { eq } from "drizzle-orm";
import pino from "pino";
import { ulid } from "ulid";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import {
  organizations,
  onboardingSessions,
  whatsappBusinessAccounts,
  credentials,
} from "../db/schema.js";
import type {
  SessionDetail,
  ActivateWebhookResult,
  ReconcileResult,
} from "../types/api.js";
import { subscribeAppWithOverride } from "./meta-waba.js";
import { decrypt } from "./crypto.js";
import { writeAuditLog, logWebhookEvent } from "./audit.js";
import { completeSignup } from "./onboarding-complete.js";

export { completeSignup } from "./onboarding-complete.js";

const logger = pino({ level: env.LOG_LEVEL });

function now() {
  return new Date().toISOString();
}

// ─── createSession ───────────────────────────────────────────────────────────
export function createSession(
  orgName: string,
  contactEmail?: string
): { sessionId: string; organizationId: string } {
  const ts = now();
  const orgId = ulid();
  const sessionId = ulid();

  db.insert(organizations)
    .values({
      id: orgId, name: orgName, contactEmail: contactEmail ?? null,
      createdAt: ts, updatedAt: ts,
    })
    .run();

  db.insert(onboardingSessions)
    .values({
      id: sessionId, organizationId: orgId, status: "started",
      startedAt: ts, createdAt: ts, updatedAt: ts,
    })
    .run();

  writeAuditLog({
    entityType: "onboarding_session", entityId: sessionId,
    action: "status_changed", newValue: "started", actor: "system",
  });

  logger.info({ sessionId, orgId }, "Onboarding session created");
  return { sessionId, organizationId: orgId };
}

// ─── getSession ──────────────────────────────────────────────────────────────
export function getSession(sessionId: string): SessionDetail | null {
  const session = db
    .select()
    .from(onboardingSessions)
    .where(eq(onboardingSessions.id, sessionId))
    .get();

  if (!session) return null;

  return {
    id: session.id,
    organizationId: session.organizationId,
    status: session.status,
    metaBusinessId: session.metaBusinessId,
    wabaId: session.wabaId,
    phoneNumberId: session.phoneNumberId,
    errorMessage: session.errorMessage,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    assetsSavedAt: session.assetsSavedAt,
    webhookReadyAt: session.webhookReadyAt,
  };
}

// ─── activateWebhook ─────────────────────────────────────────────────────────
export async function activateWebhook(
  sessionId: string,
  webhookUrl: string,
  verifyToken: string
): Promise<ActivateWebhookResult> {
  const session = db.select().from(onboardingSessions)
    .where(eq(onboardingSessions.id, sessionId)).get();
  if (!session) throw new Error("Session not found");
  if (session.status !== "assets_saved") {
    throw new Error(
      `Cannot activate webhook: session status is '${session.status}', expected 'assets_saved'`
    );
  }

  const orgId = session.organizationId!;

  // Decrypt token
  const cred = db.select().from(credentials)
    .where(eq(credentials.organizationId, orgId)).get();
  if (!cred) throw new Error("No credential found for organization");
  const token = decrypt(cred.encryptedValue);

  // Log event
  logWebhookEvent({
    source: "admin_activate_webhook",
    payload: { sessionId, wabaId: session.wabaId, webhookUrl },
    processed: false,
  });

  // Set webhook override
  await subscribeAppWithOverride(session.wabaId!, token, webhookUrl, verifyToken);

  const ts = now();
  db.update(whatsappBusinessAccounts)
    .set({ webhookOverrideActive: true, webhookOverrideUri: webhookUrl, updatedAt: ts })
    .where(eq(whatsappBusinessAccounts.wabaId, session.wabaId!)).run();

  db.update(organizations)
    .set({ tenantWebhookUrl: webhookUrl, updatedAt: ts })
    .where(eq(organizations.id, orgId)).run();

  db.update(onboardingSessions)
    .set({ status: "webhook_ready", webhookReadyAt: ts, updatedAt: ts })
    .where(eq(onboardingSessions.id, sessionId)).run();

  writeAuditLog({
    entityType: "onboarding_session", entityId: sessionId,
    action: "status_changed", oldValue: "assets_saved", newValue: "webhook_ready",
    actor: "admin",
  });
  writeAuditLog({
    entityType: "whatsapp_business_account", entityId: session.wabaId!,
    action: "webhook_override_activated", newValue: { webhookUrl }, actor: "admin",
  });

  logger.info({ sessionId, webhookUrl }, "Webhook override activated");

  return {
    sessionId, status: "webhook_ready", wabaId: session.wabaId!,
    webhookOverrideUri: webhookUrl,
    message: "Webhook override activated. Tenant is fully onboarded.",
  };
}

// ─── reconcile ───────────────────────────────────────────────────────────────
export async function reconcile(sessionId: string): Promise<ReconcileResult> {
  const session = db.select().from(onboardingSessions)
    .where(eq(onboardingSessions.id, sessionId)).get();
  if (!session) throw new Error("Session not found");
  if (session.status !== "failed") {
    throw new Error(
      `Cannot reconcile: session status is '${session.status}', expected 'failed'`
    );
  }

  // Reset status so completeSignup accepts it
  db.update(onboardingSessions)
    .set({ status: "signup_completed", updatedAt: now() })
    .where(eq(onboardingSessions.id, sessionId)).run();

  writeAuditLog({
    entityType: "onboarding_session", entityId: sessionId,
    action: "status_changed", oldValue: "failed", newValue: "signup_completed (reconcile)",
    actor: "admin",
  });

  logWebhookEvent({
    source: "admin_reconcile",
    payload: { sessionId, wabaId: session.wabaId, businessId: session.metaBusinessId },
    processed: false,
  });

  const result = await completeSignup({
    sessionId,
    code: "",
    phoneNumberId: session.phoneNumberId!,
    wabaId: session.wabaId!,
    businessId: session.metaBusinessId!,
  });

  return {
    sessionId: result.sessionId, status: result.status,
    completedSteps: result.completedSteps,
    failedStep: result.failedStep, error: result.error,
    message: result.message,
  };
}
