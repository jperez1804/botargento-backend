import { eq, and } from "drizzle-orm";
import pino from "pino";
import { ulid } from "ulid";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import {
  organizations,
  onboardingSessions,
  onboardingEvents,
  whatsappBusinessAccounts,
  credentials,
} from "../db/schema.js";
import type {
  SessionDetail,
  ActivateWebhookResult,
  ResetWebhookResult,
  ReconcileResult,
  OnboardingEventParams,
} from "../types/api.js";
import { subscribeApp, subscribeAppWithOverride } from "./meta-waba.js";
import { decrypt } from "./crypto.js";
import { writeAuditLog, logWebhookEvent } from "./audit.js";
import { completeSignup } from "./onboarding-complete.js";
import { persistAssets } from "./persist-assets.js";

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

// ─── logOnboardingEvent ─────────────────────────────────────────────────────
export function logOnboardingEvent(params: OnboardingEventParams): { id: string } {
  const id = ulid();
  db.insert(onboardingEvents).values({
    id, sessionId: params.sessionId ?? null, eventType: params.eventType,
    metaSessionId: params.metaSessionId ?? null, currentStep: params.currentStep ?? null,
    errorCode: params.errorCode ?? null, errorMessage: params.errorMessage ?? null,
    phoneNumberId: params.phoneNumberId ?? null, wabaId: params.wabaId ?? null,
    businessId: params.businessId ?? null, rawPayload: JSON.stringify(params.rawPayload),
    createdAt: now(),
  }).run();

  logger.info({ id, sessionId: params.sessionId, eventType: params.eventType }, "Onboarding event logged");
  return { id };
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

  // Decrypt business integration token
  const cred = db.select().from(credentials)
    .where(and(eq(credentials.organizationId, orgId), eq(credentials.credentialType, "business_integration_token"))).get();
  if (!cred) throw new Error("No business_integration_token found for organization");
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

export async function resetWebhook(sessionId: string): Promise<ResetWebhookResult> {
  const session = db.select().from(onboardingSessions)
    .where(eq(onboardingSessions.id, sessionId)).get();
  if (!session) throw new Error("Session not found");
  if (session.status !== "webhook_ready") {
    throw new Error(
      `Cannot reset webhook: session status is '${session.status}', expected 'webhook_ready'`
    );
  }

  const orgId = session.organizationId!;
  const cred = db.select().from(credentials)
    .where(and(
      eq(credentials.organizationId, orgId),
      eq(credentials.credentialType, "business_integration_token"),
    )).get();
  if (!cred) throw new Error("No business_integration_token found for organization");

  const token = decrypt(cred.encryptedValue);

  logWebhookEvent({
    source: "admin_reset_webhook",
    payload: { sessionId, wabaId: session.wabaId },
    processed: false,
  });

  await subscribeApp(session.wabaId!, token);

  const ts = now();
  db.update(whatsappBusinessAccounts)
    .set({ webhookOverrideActive: false, webhookOverrideUri: null, updatedAt: ts })
    .where(eq(whatsappBusinessAccounts.wabaId, session.wabaId!)).run();

  db.update(organizations)
    .set({ tenantWebhookUrl: null, updatedAt: ts })
    .where(eq(organizations.id, orgId)).run();

  db.update(onboardingSessions)
    .set({ status: "assets_saved", webhookReadyAt: null, updatedAt: ts })
    .where(eq(onboardingSessions.id, sessionId)).run();

  writeAuditLog({
    entityType: "onboarding_session", entityId: sessionId,
    action: "status_changed", oldValue: "webhook_ready", newValue: "assets_saved",
    actor: "admin",
  });
  writeAuditLog({
    entityType: "whatsapp_business_account", entityId: session.wabaId!,
    action: "webhook_override_reset", newValue: { usesAppLevelDefault: true }, actor: "admin",
  });

  logger.info({ sessionId, wabaId: session.wabaId }, "Webhook override reset to app-level default");

  return {
    sessionId,
    status: "assets_saved",
    wabaId: session.wabaId!,
    message: "Webhook override removed. WABA now uses the app-level default callback.",
  };
}

// ─── reconcile ───────────────────────────────────────────────────────────────
// Retries post-token-exchange steps using stored token. Code has 30s TTL — not retryable.
export async function reconcile(sessionId: string): Promise<ReconcileResult> {
  const session = db.select().from(onboardingSessions)
    .where(eq(onboardingSessions.id, sessionId)).get();
  if (!session) throw new Error("Session not found");
  if (session.status !== "failed") {
    throw new Error(
      `Cannot reconcile: session status is '${session.status}', expected 'failed'`,
    );
  }

  const orgId = session.organizationId!;

  // Token exchange must have already succeeded — use stored business integration token
  const cred = db.select().from(credentials).where(and(eq(credentials.organizationId, orgId), eq(credentials.credentialType, "business_integration_token"))).get();
  if (!cred) {
    throw new Error("Cannot reconcile: no stored token. Token exchange never completed. Fresh Embedded Signup required.");
  }
  const accessToken = decrypt(cred.encryptedValue);

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

  // Reset status
  db.update(onboardingSessions)
    .set({ status: "signup_completed", updatedAt: now() })
    .where(eq(onboardingSessions.id, sessionId)).run();

  try {
    const result = await persistAssets({
      sessionId, orgId, businessId: session.metaBusinessId!,
      wabaId: session.wabaId!, phoneNumberId: session.phoneNumberId!,
      accessToken, scopes: cred.scopes ? JSON.parse(cred.scopes) as string[] : null,
      expiresAt: null,
    });

    // Update session to assets_saved
    const savedAt = now();
    db.update(onboardingSessions)
      .set({ status: "assets_saved", assetsSavedAt: savedAt, updatedAt: savedAt })
      .where(eq(onboardingSessions.id, sessionId)).run();

    writeAuditLog({
      entityType: "onboarding_session", entityId: sessionId,
      action: "status_changed", oldValue: "signup_completed", newValue: "assets_saved", actor: "admin",
    });

    logger.info({ sessionId }, "Reconcile successful: assets_saved");

    return {
      sessionId, status: "assets_saved",
      completedSteps: result.completedSteps,
      message: "Reconcile successful. Assets saved using stored token.",
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";

    db.update(onboardingSessions)
      .set({ status: "failed", errorMessage: `reconcile: ${errorMsg}`, updatedAt: now() })
      .where(eq(onboardingSessions.id, sessionId)).run();

    logger.error({ sessionId, error: errorMsg }, "Reconcile failed");

    return {
      sessionId, status: "failed",
      completedSteps: [], failedStep: "reconcile", error: errorMsg,
      message: "Reconcile failed. Check error and retry or start a fresh Embedded Signup.",
    };
  }
}
