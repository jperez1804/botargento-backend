import { Hono } from "hono";
import pino from "pino";
import { env } from "../config/env.js";
import { logWebhookEvent } from "../services/audit.js";

const logger = pino({ level: env.LOG_LEVEL });

const metaWebhooks = new Hono();

// ─── GET / ── Webhook verification (Meta subscription handshake) ─────────────
metaWebhooks.get("/", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    logger.info("Meta webhook verification successful");
    // Meta expects the challenge value returned as plain text
    return c.text(challenge ?? "", 200);
  }

  logger.warn({ mode, tokenMatch: token === env.META_WEBHOOK_VERIFY_TOKEN }, "Meta webhook verification failed");
  return c.json(
    { success: false, error: { code: "FORBIDDEN", message: "Webhook verification failed" } },
    403,
  );
});

// ─── POST / ── Receive webhook events from Meta ─────────────────────────────
interface MetaWebhookEntry {
  id: string;
  changes?: Array<{
    field: string;
    value: unknown;
  }>;
}

interface MetaWebhookPayload {
  object: string;
  entry: MetaWebhookEntry[];
}

metaWebhooks.post("/", async (c) => {
  const payload: MetaWebhookPayload = await c.req.json();

  logger.info(
    { object: payload.object, entryCount: payload.entry?.length ?? 0 },
    "Meta webhook event received",
  );

  // Process each entry
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const idempotencyKey = `meta_webhook_${entry.id}_${change.field}_${Date.now()}`;

      logWebhookEvent({
        source: `meta_${change.field}`,
        payload: { entryId: entry.id, field: change.field, value: change.value },
        processed: false,
        idempotencyKey,
      });

      // Handle account_update events (onboarding/account lifecycle)
      if (change.field === "account_update") {
        logger.info(
          { wabaId: entry.id, value: change.value },
          "account_update event received",
        );
      }
    }
  }

  // Meta requires a 200 response within a few seconds
  return c.text("EVENT_RECEIVED", 200);
});

export { metaWebhooks };
