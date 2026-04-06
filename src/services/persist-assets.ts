import { randomInt } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "../db/client.js";
import {
  organizations,
  metaBusinessAccounts,
  whatsappBusinessAccounts,
  phoneNumbers,
  credentials,
} from "../db/schema.js";
import { subscribeApp, registerPhoneNumber } from "./meta-waba.js";
import { encrypt } from "./crypto.js";
import { writeAuditLog } from "./audit.js";

function now() {
  return new Date().toISOString();
}

function generatePin(): string {
  return String(randomInt(100000, 999999));
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
  displayPhoneNumber?: string,
): string {
  db.insert(phoneNumbers).values({
    id: ulid(), organizationId: orgId, wabaId: wabaInternalId,
    phoneNumberId, displayPhoneNumber: displayPhoneNumber ?? null,
    registered: false, createdAt: now(), updatedAt: now(),
  }).onConflictDoNothing().run();

  const row = db.select({ id: phoneNumbers.id })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.phoneNumberId, phoneNumberId)).get();

  return row!.id;
}

// ─── persistAssets ──────────────────────────────────────────────────────────
// Post-token-exchange steps. Reused by both completeSignup and reconcile.

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
}

export interface PersistAssetsResult {
  completedSteps: string[];
  appSubscribed: boolean;
  phoneRegistered: boolean;
}

export async function persistAssets(params: PersistAssetsParams): Promise<PersistAssetsResult> {
  const completedSteps: string[] = [];

  // Update organization timestamp
  db.update(organizations).set({ updatedAt: now() })
    .where(eq(organizations.id, params.orgId)).run();
  completedSteps.push("org_updated");

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
  const phoneInternalId = upsertPhone(
    params.orgId, wabaInternalId, params.phoneNumberId, params.displayPhoneNumber,
  );
  const pin = generatePin();
  completedSteps.push("phone_persisted");

  // Register phone number
  const registered = await registerPhoneNumber(
    params.phoneNumberId, params.accessToken, pin,
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

  // Encrypt and store token (skip if already stored for this org + type)
  const existingCred = db.select().from(credentials)
    .where(and(eq(credentials.organizationId, params.orgId), eq(credentials.credentialType, "business_integration_token"))).get();

  if (!existingCred) {
    db.insert(credentials).values({
      id: ulid(), organizationId: params.orgId,
      credentialType: "business_integration_token",
      encryptedValue: encrypt(params.accessToken),
      scopes: params.scopes ? JSON.stringify(params.scopes) : null,
      expiresAt: params.expiresAt
        ? new Date(params.expiresAt * 1000).toISOString() : null,
      createdAt: now(),
    }).run();
  }
  completedSteps.push("token_stored");

  // Encrypt and store registration PIN
  db.update(phoneNumbers).set({ registrationPin: encrypt(pin), updatedAt: now() })
    .where(eq(phoneNumbers.phoneNumberId, params.phoneNumberId)).run();
  completedSteps.push("pin_stored");

  return { completedSteps, appSubscribed: subscribed, phoneRegistered: registered };
}
