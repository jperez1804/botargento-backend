import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

// ─── organizations ───────────────────────────────────────────────────────────
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  contactEmail: text("contact_email"),
  tenantSubdomain: text("tenant_subdomain"),
  tenantWebhookUrl: text("tenant_webhook_url"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── onboarding_sessions ─────────────────────────────────────────────────────
export const onboardingSessions = sqliteTable("onboarding_sessions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").references(() => organizations.id),
  status: text("status", {
    enum: ["started", "signup_completed", "assets_saved", "webhook_ready", "failed"],
  }).notNull(),
  metaBusinessId: text("meta_business_id"),
  wabaId: text("waba_id"),
  phoneNumberId: text("phone_number_id"),
  errorMessage: text("error_message"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  assetsSavedAt: text("assets_saved_at"),
  webhookReadyAt: text("webhook_ready_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── meta_business_accounts ──────────────────────────────────────────────────
export const metaBusinessAccounts = sqliteTable(
  "meta_business_accounts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    metaBusinessId: text("meta_business_id").notNull(),
    businessName: text("business_name"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("meta_business_accounts_meta_business_id_unique").on(
      table.metaBusinessId
    ),
  ]
);

// ─── whatsapp_business_accounts ──────────────────────────────────────────────
export const whatsappBusinessAccounts = sqliteTable(
  "whatsapp_business_accounts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    metaBusinessAccountId: text("meta_business_account_id")
      .notNull()
      .references(() => metaBusinessAccounts.id),
    wabaId: text("waba_id").notNull(),
    appSubscribed: integer("app_subscribed", { mode: "boolean" })
      .notNull()
      .default(false),
    webhookOverrideActive: integer("webhook_override_active", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    webhookOverrideUri: text("webhook_override_uri"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_business_accounts_waba_id_unique").on(table.wabaId),
  ]
);

// ─── phone_numbers ───────────────────────────────────────────────────────────
export const phoneNumbers = sqliteTable(
  "phone_numbers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    wabaId: text("waba_id")
      .notNull()
      .references(() => whatsappBusinessAccounts.id),
    phoneNumberId: text("phone_number_id").notNull(),
    displayPhoneNumber: text("display_phone_number"),
    registered: integer("registered", { mode: "boolean" })
      .notNull()
      .default(false),
    registrationPin: text("registration_pin"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("phone_numbers_phone_number_id_unique").on(table.phoneNumberId),
  ]
);

// ─── credentials ─────────────────────────────────────────────────────────────
export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  credentialType: text("credential_type", {
    enum: ["business_integration_token", "system_user_token"],
  }).notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  scopes: text("scopes"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull(),
  rotatedAt: text("rotated_at"),
});

// ─── onboarding_events ──────────────────────────────────────────────────────
// Captures WA_EMBEDDED_SIGNUP window message payloads (success, cancel, error)
export const onboardingEvents = sqliteTable("onboarding_events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => onboardingSessions.id),
  eventType: text("event_type", {
    enum: ["completed", "cancel", "error"],
  }).notNull(),
  metaSessionId: text("meta_session_id"),
  currentStep: text("current_step"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  phoneNumberId: text("phone_number_id"),
  wabaId: text("waba_id"),
  businessId: text("business_id"),
  rawPayload: text("raw_payload").notNull(),
  createdAt: text("created_at").notNull(),
});

// ─── webhook_events ──────────────────────────────────────────────────────────
export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    payload: text("payload").notNull(),
    processed: integer("processed", { mode: "boolean" })
      .notNull()
      .default(false),
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("webhook_events_idempotency_key_unique").on(
      table.idempotencyKey
    ),
  ]
);

// ─── audit_logs ──────────────────────────────────────────────────────────────
export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
});
