import { randomInt } from "node:crypto";
import { eq, and } from "drizzle-orm";
import pino from "pino";
import { ulid } from "ulid";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import {
  organizations,
  metaBusinessAccounts,
  whatsappBusinessAccounts,
  phoneNumbers,
  credentials,
} from "../db/schema.js";
import {
  subscribeApp,
  registerPhoneNumber,
  requestSmbAppDataSync,
  type SmbSyncType,
} from "./meta-waba.js";
import { encrypt, decrypt } from "./crypto.js";
import { writeAuditLog } from "./audit.js";

const logger = pino({ level: env.LOG_LEVEL });

export type SignupType = "standard" | "coexistence";
export type CredentialType = "business_integration_token" | "system_user_token";

function now() {
  return new Date().toISOString();
}

function generatePin(): string {
  return String(randomInt(100000, 999999));
}

// ─── Token lookup ───────────────────────────────────────────────────────────
// Embedded Signup stores a business_integration_token; organizations imported by an
// admin (see importOnboarding) carry a system_user_token instead.
export function getOrgAccessToken(orgId: string): string | null {
  for (const type of ["business_integration_token", "system_user_token"] as const) {
    const cred = db.select().from(credentials)
      .where(and(eq(credentials.organizationId, orgId), eq(credentials.credentialType, type)))
      .get();
    if (cred) return decrypt(cred.encryptedValue);
  }
  return null;
}

// ─── Idempotent row helpers ─────────────────────────────────────────────────
// Insert-or-get: try insert, then always fetch the real row by unique external ID.

function upsertMetaBusiness(orgId: string, businessId: string): string {
  db.insert(metaBusinessAccounts).values({
    id: ulid(), organizationId: orgId,
    metaBusinessId: businessId, createdAt: now(),
  }).onConflictDoNothing().run();

  const row = db.select({ id: metaBusinessAccounts.id })
    .from(metaBusinessAccounts)
    .where(eq(metaBusinessAccounts.metaBusinessId, businessId)).get();

  return row!.id;
}

function upsertWaba(orgId: string, metaBizInternalId: string, wabaId: string): string {
  db.insert(whatsappBusinessAccounts).values({
    id: ulid(), organizationId: orgId, metaBusinessAccountId: metaBizInternalId,
    wabaId, appSubscribed: false, webhookOverrideActive: false,
    createdAt: now(), updatedAt: now(),
  }).onConflictDoNothing().run();

  const row = db.select({ id: whatsappBusinessAccounts.id })
    .from(whatsappBusinessAccounts)
    .where(eq(whatsappBusinessAccounts.wabaId, wabaId)).get();

  return row!.id;
}

function upsertPhone(
  orgId: string, wabaInternalId: string, phoneNumberId: string,
  signupType: SignupType, displayPhoneNumber?: string,
) {
  db.insert(phoneNumbers).values({
    id: ulid(), organizationId: orgId, wabaId: wabaInternalId,
    phoneNumberId, displayPhoneNumber: displayPhoneNumber ?? null,
    registered: false, signupType, createdAt: now(), updatedAt: now(),
  }).onConflictDoNothing().run();

  return db.select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.phoneNumberId, phoneNumberId)).get()!;
}

// ─── persistAssets ──────────────────────────────────────────────────────────
// Post-token-exchange steps. Reused by completeSignup, reconcile and importOnboarding.

export interface PersistAssetsParams {
  sessionId: string;
  orgId: string;
  businessId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  accessToken: string;
  scopes: string[] | null;
  expiresAt: number | null;
  signupType?: SignupType;
  credentialType?: CredentialType;
}

export interface PersistAssetsResult {
  completedSteps: string[];
  appSubscribed: boolean;
  phoneRegistered: boolean;
  contactsSyncRequested: boolean;
  historySyncRequested: boolean;
}

export async function persistAssets(params: PersistAssetsParams): Promise<PersistAssetsResult> {
  const completedSteps: string[] = [];
  const signupType = params.signupType ?? "standard";
  const credentialType = params.credentialType ?? "business_integration_token";

  // Update organization timestamp
  db.update(organizations).set({ updatedAt: now() })
    .where(eq(organizations.id, params.orgId)).run();
  completedSteps.push("org_updated");

  // Encrypt and store the token FIRST (skip if already stored for this org + type):
  // the code it came from can't be exchanged again, so if any Graph call below fails
  // the session must still be recoverable via reconcile.
  const existingCred = db.select().from(credentials)
    .where(and(eq(credentials.organizationId, params.orgId), eq(credentials.credentialType, credentialType))).get();

  if (!existingCred) {
    db.insert(credentials).values({
      id: ulid(), organizationId: params.orgId,
      credentialType,
      encryptedValue: encrypt(params.accessToken),
      scopes: params.scopes ? JSON.stringify(params.scopes) : null,
      expiresAt: params.expiresAt
        ? new Date(params.expiresAt * 1000).toISOString() : null,
      createdAt: now(),
    }).run();
  }
  completedSteps.push("token_stored");

  // Persist Meta business account (idempotent)
  const metaBizInternalId = upsertMetaBusiness(params.orgId, params.businessId);
  completedSteps.push("meta_business_persisted");

  // Persist WABA (idempotent)
  const wabaInternalId = upsertWaba(params.orgId, metaBizInternalId, params.wabaId);
  completedSteps.push("waba_persisted");

  // Subscribe app to WABA (uses app-level default webhook)
  const subscribed = await subscribeApp(params.wabaId, params.accessToken);
  if (subscribed) {
    db.update(whatsappBusinessAccounts).set({ appSubscribed: true, updatedAt: now() })
      .where(eq(whatsappBusinessAccounts.wabaId, params.wabaId)).run();
  }
  completedSteps.push("app_subscribed");

  writeAuditLog({
    entityType: "whatsapp_business_account", entityId: wabaInternalId,
    action: "app_subscribed", newValue: { subscribed }, actor: "system",
  });

  // Persist phone number (idempotent)
  const phone = upsertPhone(
    params.orgId, wabaInternalId, params.phoneNumberId, signupType, params.displayPhoneNumber,
  );
  completedSteps.push("phone_persisted");

  if (signupType === "coexistence") {
    // The number stays registered on the WhatsApp Business app — calling /register
    // here would fail (or take it off the app). Instead, ask Meta for the app's
    // contacts and history while the 24 h window is open.
    const contactsSyncRequested = await requestSync(phone.contactsSyncRequestedAt, "smb_app_state_sync", params, phone.id, completedSteps);
    const historySyncRequested = await requestSync(phone.historySyncRequestedAt, "history", params, phone.id, completedSteps);

    return {
      completedSteps, appSubscribed: subscribed, phoneRegistered: false,
      contactsSyncRequested, historySyncRequested,
    };
  }

  // Register phone number
  const pin = generatePin();
  const registered = await registerPhoneNumber(
    params.phoneNumberId, params.accessToken, pin,
  );
  if (registered) {
    db.update(phoneNumbers).set({ registered: true, updatedAt: now() })
      .where(eq(phoneNumbers.phoneNumberId, params.phoneNumberId)).run();
  }
  completedSteps.push("phone_registered");

  writeAuditLog({
    entityType: "phone_number", entityId: phone.id,
    action: "phone_registered", newValue: { registered }, actor: "system",
  });

  // Encrypt and store registration PIN
  db.update(phoneNumbers).set({ registrationPin: encrypt(pin), updatedAt: now() })
    .where(eq(phoneNumbers.phoneNumberId, params.phoneNumberId)).run();
  completedSteps.push("pin_stored");

  return {
    completedSteps, appSubscribed: subscribed, phoneRegistered: registered,
    contactsSyncRequested: false, historySyncRequested: false,
  };
}

// A failed sync doesn't fail the onboarding: the number is connected either way, and
// the sync is a nice-to-have that Meta only accepts within 24 h. Already-requested
// syncs are skipped so reconcile doesn't repeat them.
async function requestSync(
  requestedAt: string | null,
  syncType: SmbSyncType,
  params: PersistAssetsParams,
  phoneInternalId: string,
  completedSteps: string[],
): Promise<boolean> {
  const step = syncType === "history" ? "history_sync" : "contacts_sync";
  if (requestedAt) {
    completedSteps.push(`${step}_already_requested`);
    return true;
  }

  try {
    const requestId = await requestSmbAppDataSync(params.phoneNumberId, params.accessToken, syncType);
    const column = syncType === "history"
      ? { historySyncRequestedAt: now() }
      : { contactsSyncRequestedAt: now() };
    db.update(phoneNumbers).set({ ...column, updatedAt: now() })
      .where(eq(phoneNumbers.phoneNumberId, params.phoneNumberId)).run();
    completedSteps.push(`${step}_requested`);

    writeAuditLog({
      entityType: "phone_number", entityId: phoneInternalId,
      action: `${step}_requested`, newValue: { requestId }, actor: "system",
    });
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error({ phoneNumberId: params.phoneNumberId, syncType, error }, "App data sync request failed");
    completedSteps.push(`${step}_failed`);

    writeAuditLog({
      entityType: "phone_number", entityId: phoneInternalId,
      action: `${step}_failed`, newValue: { error }, actor: "system",
    });
    return false;
  }
}
