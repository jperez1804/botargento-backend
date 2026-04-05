import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import pino from "pino";
import { ulid } from "ulid";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import {
  organizations,
  onboardingSessions,
  metaBusinessAccounts,
  whatsappBusinessAccounts,
  phoneNumbers,
  credentials,
} from "../db/schema.js";
import type { CompleteSignupParams, CompleteSignupResult } from "../types/api.js";
import { exchangeCodeForToken, debugToken } from "./meta-auth.js";
import { subscribeApp, registerPhoneNumber } from "./meta-waba.js";
import { encrypt } from "./crypto.js";
import { writeAuditLog, logWebhookEvent, markWebhookEventProcessed } from "./audit.js";

const logger = pino({ level: env.LOG_LEVEL });

function now() {
  return new Date().toISOString();
}

function generatePin(): string {
  return String(randomInt(100000, 999999));
}

const STEP_ORDER = [
  "token_exchanged", "token_debugged", "org_updated",
  "meta_business_persisted", "waba_persisted", "app_subscribed",
  "phone_persisted", "phone_registered", "token_stored", "pin_stored",
];

function getNextStep(completedSteps: string[]): string {
  const lastIndex = completedSteps.length > 0
    ? STEP_ORDER.indexOf(completedSteps[completedSteps.length - 1]!)
    : -1;
  return STEP_ORDER[lastIndex + 1] ?? "unknown";
}

export async function completeSignup(
  params: CompleteSignupParams
): Promise<CompleteSignupResult> {
  const completedSteps: string[] = [];
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
    payload: { sessionId: params.sessionId, wabaId: params.wabaId, businessId: params.businessId, phoneNumberId: params.phoneNumberId },
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
    action: "status_changed", oldValue: session.status, newValue: "signup_completed", actor: "system",
  });

  // Steps 3-12: wrapped to catch failures
  try {
    // Step 3: Exchange code for token
    const tokenResult = await exchangeCodeForToken(params.code);
    completedSteps.push("token_exchanged");

    // Step 4: Debug token
    const debugResult = await debugToken(tokenResult.accessToken);
    completedSteps.push("token_debugged");

    writeAuditLog({
      entityType: "credential", entityId: params.sessionId,
      action: "token_exchanged", newValue: { scopes: debugResult.scopes }, actor: "system",
    });

    // Step 5: Update organization
    db.update(organizations).set({ updatedAt: now() })
      .where(eq(organizations.id, orgId)).run();
    completedSteps.push("org_updated");

    // Step 6: Persist Meta business account
    const metaBizId = ulid();
    db.insert(metaBusinessAccounts).values({
      id: metaBizId, organizationId: orgId,
      metaBusinessId: params.businessId, createdAt: now(),
    }).onConflictDoNothing().run();
    completedSteps.push("meta_business_persisted");

    // Step 7: Persist WABA
    const wabaInternalId = ulid();
    db.insert(whatsappBusinessAccounts).values({
      id: wabaInternalId, organizationId: orgId, metaBusinessAccountId: metaBizId,
      wabaId: params.wabaId, appSubscribed: false, webhookOverrideActive: false,
      createdAt: now(), updatedAt: now(),
    }).onConflictDoNothing().run();
    completedSteps.push("waba_persisted");

    // Step 8: Subscribe app to WABA
    const subscribed = await subscribeApp(params.wabaId, tokenResult.accessToken);
    if (subscribed) {
      db.update(whatsappBusinessAccounts).set({ appSubscribed: true, updatedAt: now() })
        .where(eq(whatsappBusinessAccounts.wabaId, params.wabaId)).run();
    }
    completedSteps.push("app_subscribed");

    writeAuditLog({
      entityType: "whatsapp_business_account", entityId: wabaInternalId,
      action: "app_subscribed", newValue: { subscribed }, actor: "system",
    });

    // Step 9: Persist phone number
    const phoneInternalId = ulid();
    const pin = generatePin();
    db.insert(phoneNumbers).values({
      id: phoneInternalId, organizationId: orgId, wabaId: wabaInternalId,
      phoneNumberId: params.phoneNumberId, registered: false,
      createdAt: now(), updatedAt: now(),
    }).onConflictDoNothing().run();
    completedSteps.push("phone_persisted");

    // Step 10: Register phone number
    const registered = await registerPhoneNumber(
      params.phoneNumberId, tokenResult.accessToken, pin
    );
    if (registered) {
      db.update(phoneNumbers).set({ registered: true, updatedAt: now() })
        .where(eq(phoneNumbers.phoneNumberId, params.phoneNumberId)).run();
    }
    completedSteps.push("phone_registered");

    writeAuditLog({
      entityType: "phone_number", entityId: phoneInternalId,
      action: "phone_registered", newValue: { registered }, actor: "system",
    });

    // Step 11: Encrypt and store token
    const credId = ulid();
    db.insert(credentials).values({
      id: credId, organizationId: orgId, credentialType: "business_integration_token",
      encryptedValue: encrypt(tokenResult.accessToken),
      scopes: JSON.stringify(debugResult.scopes),
      expiresAt: debugResult.expiresAt
        ? new Date(debugResult.expiresAt * 1000).toISOString()
        : null,
      createdAt: now(),
    }).run();
    completedSteps.push("token_stored");

    // Step 12: Encrypt and store registration PIN
    db.update(phoneNumbers).set({ registrationPin: encrypt(pin), updatedAt: now() })
      .where(eq(phoneNumbers.phoneNumberId, params.phoneNumberId)).run();
    completedSteps.push("pin_stored");

    // Step 13: Update session to assets_saved
    const savedAt = now();
    db.update(onboardingSessions)
      .set({ status: "assets_saved", assetsSavedAt: savedAt, updatedAt: savedAt })
      .where(eq(onboardingSessions.id, params.sessionId)).run();

    writeAuditLog({
      entityType: "onboarding_session", entityId: params.sessionId,
      action: "status_changed", oldValue: "signup_completed", newValue: "assets_saved",
      actor: "system",
    });

    // Mark webhook event as processed
    markWebhookEventProcessed(`complete_${params.sessionId}`);

    logger.info({ sessionId: params.sessionId }, "Onboarding complete: assets_saved");

    return {
      sessionId: params.sessionId, status: "assets_saved", organizationId: orgId,
      wabaId: params.wabaId, phoneNumberId: params.phoneNumberId,
      appSubscribed: subscribed, phoneRegistered: registered,
      webhookOverrideActive: false, completedSteps,
      message: "Onboarding assets saved. Webhook override pending — activate when tenant infra is ready.",
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    const failedStep = getNextStep(completedSteps);

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
      webhookOverrideActive: false, completedSteps, failedStep, error: errorMsg,
      message: "Onboarding partially completed. Use admin reconcile endpoint to retry failed steps.",
    };
  }
}
