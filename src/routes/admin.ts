import { Hono } from "hono";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  onboardingSessions,
  organizations,
  metaBusinessAccounts,
  whatsappBusinessAccounts,
  phoneNumbers,
  credentials,
  auditLogs,
} from "../db/schema.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { reconcile, activateWebhook, resetWebhook } from "../services/onboarding.js";
import { exchangeCodeForToken } from "../services/meta-auth.js";
import { encrypt } from "../services/crypto.js";
import { writeAuditLog } from "../services/audit.js";

const admin = new Hono();

// All admin routes require auth
admin.use("*", adminAuth);

// ─── GET /onboarding ─────────────────────────────────────────────────────────
admin.get("/onboarding", (c) => {
  const status = c.req.query("status") as
    | "started" | "signup_completed" | "assets_saved" | "webhook_ready" | "failed"
    | undefined;
  const limit = Math.min(Number(c.req.query("limit") || 50), 100);
  const offset = Number(c.req.query("offset") || 0);

  const rows = db
    .select({
      session: onboardingSessions,
      orgName: organizations.name,
    })
    .from(onboardingSessions)
    .leftJoin(organizations, eq(onboardingSessions.organizationId, organizations.id))
    .where(status ? eq(onboardingSessions.status, status) : undefined)
    .orderBy(desc(onboardingSessions.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return c.json({
    success: true,
    data: rows.map((r) => ({
      id: r.session.id,
      status: r.session.status,
      organization_name: r.orgName,
      organization_id: r.session.organizationId,
      meta_business_id: r.session.metaBusinessId,
      waba_id: r.session.wabaId,
      phone_number_id: r.session.phoneNumberId,
      error_message: r.session.errorMessage,
      started_at: r.session.startedAt,
      completed_at: r.session.completedAt,
      assets_saved_at: r.session.assetsSavedAt,
      webhook_ready_at: r.session.webhookReadyAt,
    })),
  });
});

// ─── GET /onboarding/:id ─────────────────────────────────────────────────────
admin.get("/onboarding/:id", (c) => {
  const id = c.req.param("id");

  const s = db.select().from(onboardingSessions).where(eq(onboardingSessions.id, id)).get();
  if (!s) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Session not found" } }, 404);

  const org = s.organizationId ? db.select().from(organizations).where(eq(organizations.id, s.organizationId)).get() : null;
  const metaBiz = s.metaBusinessId ? db.select().from(metaBusinessAccounts).where(eq(metaBusinessAccounts.metaBusinessId, s.metaBusinessId)).get() : null;
  const waba = s.wabaId ? db.select().from(whatsappBusinessAccounts).where(eq(whatsappBusinessAccounts.wabaId, s.wabaId)).get() : null;
  const phone = s.phoneNumberId ? db.select().from(phoneNumbers).where(eq(phoneNumbers.phoneNumberId, s.phoneNumberId)).get() : null;
  const cred = s.organizationId ? db.select().from(credentials).where(and(eq(credentials.organizationId, s.organizationId), eq(credentials.credentialType, "business_integration_token"))).get() : null;
  const logs = db.select().from(auditLogs).where(eq(auditLogs.entityId, id)).orderBy(auditLogs.createdAt).all();

  return c.json({
    success: true,
    data: {
      session: {
        id: s.id, status: s.status, started_at: s.startedAt, completed_at: s.completedAt,
        assets_saved_at: s.assetsSavedAt, webhook_ready_at: s.webhookReadyAt, error_message: s.errorMessage,
      },
      organization: org ? { id: org.id, name: org.name, tenant_subdomain: org.tenantSubdomain, tenant_webhook_url: org.tenantWebhookUrl } : null,
      meta_business: metaBiz ? { meta_business_id: metaBiz.metaBusinessId, business_name: metaBiz.businessName } : null,
      waba: waba ? { waba_id: waba.wabaId, app_subscribed: waba.appSubscribed, webhook_override_active: waba.webhookOverrideActive, webhook_override_uri: waba.webhookOverrideUri } : null,
      phone: phone ? { phone_number_id: phone.phoneNumberId, display_phone_number: phone.displayPhoneNumber, registered: phone.registered } : null,
      credential: cred ? { credential_type: cred.credentialType, scopes: cred.scopes ? JSON.parse(cred.scopes) : null, expires_at: cred.expiresAt, created_at: cred.createdAt, rotated_at: cred.rotatedAt } : null,
      audit_log: logs.map((l) => ({ action: l.action, old_value: l.oldValue ? JSON.parse(l.oldValue) : null, new_value: l.newValue ? JSON.parse(l.newValue) : null, actor: l.actor, created_at: l.createdAt })),
    },
  });
});

// ─── POST /onboarding/:id/reconcile ──────────────────────────────────────────
admin.post("/onboarding/:id/reconcile", async (c) => {
  const id = c.req.param("id");
  try {
    const result = await reconcile(id);
    return c.json({ success: result.status !== "failed", data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("not found")) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message } }, 404);
    }
    if (message.includes("Cannot reconcile")) {
      return c.json({ success: false, error: { code: "CONFLICT", message } }, 409);
    }
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message } }, 500);
  }
});

// ─── POST /onboarding/:id/activate-webhook ───────────────────────────────────
const activateWebhookSchema = z.object({
  webhook_url: z.string().url("webhook_url must be a valid URL"),
  verify_token: z.string().min(1, "verify_token is required"),
});

admin.post("/onboarding/:id/activate-webhook", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = activateWebhookSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid request body", details: parsed.error.issues },
    }, 400);
  }

  try {
    const result = await activateWebhook(id, parsed.data.webhook_url, parsed.data.verify_token);
    return c.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("not found")) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message } }, 404);
    }
    if (message.includes("Cannot activate")) {
      return c.json({ success: false, error: { code: "CONFLICT", message } }, 409);
    }
    return c.json({ success: false, error: { code: "META_API_ERROR", message } }, 502);
  }
});

// ─── POST /onboarding/:id/reset-webhook ──────────────────────────────────────
admin.post("/onboarding/:id/reset-webhook", async (c) => {
  const id = c.req.param("id");

  try {
    const result = await resetWebhook(id);
    return c.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("not found")) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message } }, 404);
    }
    if (message.includes("Cannot reset")) {
      return c.json({ success: false, error: { code: "CONFLICT", message } }, 409);
    }
    return c.json({ success: false, error: { code: "META_API_ERROR", message } }, 502);
  }
});

// ─── POST /onboarding/:id/rotate-credentials ─────────────────────────────────
const rotateSchema = z.object({
  code: z.string().min(1, "code is required"),
});

admin.post("/onboarding/:id/rotate-credentials", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = rotateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid request body", details: parsed.error.issues },
    }, 400);
  }

  const session = db.select().from(onboardingSessions)
    .where(eq(onboardingSessions.id, id)).get();
  if (!session) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "Session not found" } }, 404);
  }

  const orgId = session.organizationId;
  if (!orgId) {
    return c.json({ success: false, error: { code: "CONFLICT", message: "No organization linked" } }, 409);
  }

  try {
    const tokenResult = await exchangeCodeForToken(parsed.data.code);
    const ts = new Date().toISOString();

    db.update(credentials)
      .set({
        encryptedValue: encrypt(tokenResult.accessToken),
        rotatedAt: ts,
      })
      .where(and(
        eq(credentials.organizationId, orgId),
        eq(credentials.credentialType, "business_integration_token"),
      ))
      .run();

    writeAuditLog({
      entityType: "credential", entityId: orgId,
      action: "credential_rotated", actor: "admin",
    });

    return c.json({
      success: true,
      data: { session_id: id, message: "Credential rotated successfully.", rotated_at: ts },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: { code: "META_API_ERROR", message } }, 502);
  }
});

export { admin };
