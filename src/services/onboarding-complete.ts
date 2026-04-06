import { eq } from "drizzle-orm";
import pino from "pino";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { onboardingSessions } from "../db/schema.js";
import type { CompleteSignupParams, CompleteSignupResult } from "../types/api.js";
import { exchangeCodeForToken, debugToken } from "./meta-auth.js";
import { writeAuditLog, logWebhookEvent, markWebhookEventProcessed } from "./audit.js";
import { persistAssets } from "./persist-assets.js";

export { persistAssets } from "./persist-assets.js";

const logger = pino({ level: env.LOG_LEVEL });

function now() {
  return new Date().toISOString();
}

export async function completeSignup(
  params: CompleteSignupParams,
): Promise<CompleteSignupResult> {
  const allSteps: string[] = [];
  const ts = now();

  // Step 1: Validate session
  const session = db.select().from(onboardingSessions)
    .where(eq(onboardingSessions.id, params.sessionId)).get();
  if (!session) throw new Error("Session not found");
  if (session.status !== "started" && session.status !== "signup_completed") {
    throw new Error(`Invalid status transition: session is '${session.status}'`);
  }

  const orgId = session.organizationId!;

  // Log raw event for debugging
  logWebhookEvent({
    source: "embedded_signup_complete",
    payload: {
      sessionId: params.sessionId, wabaId: params.wabaId,
      businessId: params.businessId, phoneNumberId: params.phoneNumberId,
    },
    processed: false,
    idempotencyKey: `complete_${params.sessionId}`,
  });

  // Step 2: Update session to signup_completed
  db.update(onboardingSessions).set({
    status: "signup_completed", metaBusinessId: params.businessId,
    wabaId: params.wabaId, phoneNumberId: params.phoneNumberId,
    completedAt: ts, updatedAt: ts,
  }).where(eq(onboardingSessions.id, params.sessionId)).run();

  writeAuditLog({
    entityType: "onboarding_session", entityId: params.sessionId,
    action: "status_changed", oldValue: session.status, newValue: "signup_completed",
    actor: "system",
  });

  try {
    // Step 3: Exchange code for token (not retryable — 30s TTL)
    const tokenResult = await exchangeCodeForToken(params.code);
    allSteps.push("token_exchanged");

    // Step 4: Debug token (optional — requires META_SYSTEM_USER_TOKEN)
    const debugResult = await debugToken(tokenResult.accessToken);
    if (debugResult) allSteps.push("token_debugged");

    writeAuditLog({
      entityType: "credential", entityId: params.sessionId,
      action: "token_exchanged",
      newValue: { scopes: debugResult?.scopes ?? [] },
      actor: "system",
    });

    // Steps 5-12: Persist assets (retryable via reconcile)
    const result = await persistAssets({
      sessionId: params.sessionId, orgId, businessId: params.businessId,
      wabaId: params.wabaId, phoneNumberId: params.phoneNumberId,
      displayPhoneNumber: params.displayPhoneNumber,
      accessToken: tokenResult.accessToken,
      scopes: debugResult?.scopes ?? null,
      expiresAt: debugResult?.expiresAt ?? null,
    });
    allSteps.push(...result.completedSteps);

    // Final: Update session to assets_saved
    const savedAt = now();
    db.update(onboardingSessions)
      .set({ status: "assets_saved", assetsSavedAt: savedAt, updatedAt: savedAt })
      .where(eq(onboardingSessions.id, params.sessionId)).run();

    writeAuditLog({
      entityType: "onboarding_session", entityId: params.sessionId,
      action: "status_changed", oldValue: "signup_completed", newValue: "assets_saved",
      actor: "system",
    });

    markWebhookEventProcessed(`complete_${params.sessionId}`);
    logger.info({ sessionId: params.sessionId }, "Onboarding complete: assets_saved");

    return {
      sessionId: params.sessionId, status: "assets_saved", organizationId: orgId,
      wabaId: params.wabaId, phoneNumberId: params.phoneNumberId,
      appSubscribed: result.appSubscribed, phoneRegistered: result.phoneRegistered,
      webhookOverrideActive: false, completedSteps: allSteps,
      message: "Onboarding assets saved. Webhook override pending — activate when tenant infra is ready.",
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    const failedStep = allSteps.length > 0
      ? `after:${allSteps[allSteps.length - 1]}`
      : "token_exchanged";

    db.update(onboardingSessions)
      .set({ status: "failed", errorMessage: `${failedStep}: ${errorMsg}`, updatedAt: now() })
      .where(eq(onboardingSessions.id, params.sessionId)).run();

    writeAuditLog({
      entityType: "onboarding_session", entityId: params.sessionId,
      action: "status_changed", oldValue: "signup_completed", newValue: "failed",
      actor: "system",
    });

    logger.error({ sessionId: params.sessionId, failedStep, error: errorMsg }, "Onboarding failed");

    return {
      sessionId: params.sessionId, status: "failed", organizationId: orgId,
      wabaId: params.wabaId, phoneNumberId: params.phoneNumberId,
      appSubscribed: false, phoneRegistered: false,
      webhookOverrideActive: false, completedSteps: allSteps, failedStep, error: errorMsg,
      message: "Onboarding partially completed. Use admin reconcile endpoint to retry failed steps.",
    };
  }
}
