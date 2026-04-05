import pino from "pino";
import { env } from "../config/env.js";
import type {
  MetaSubscribeAppResponse,
  MetaRegisterPhoneResponse,
} from "../types/meta.js";
import { graphFetch, GRAPH_BASE } from "./meta-graph.js";

const logger = pino({ level: env.LOG_LEVEL });

/**
 * Subscribe the app to a WABA (no webhook override — uses app-level default).
 * POST /{waba_id}/subscribed_apps
 */
export async function subscribeApp(
  wabaId: string,
  token: string
): Promise<boolean> {
  const url = `${GRAPH_BASE}/${wabaId}/subscribed_apps`;

  logger.info({ wabaId }, "Subscribing app to WABA");

  const data = await graphFetch<MetaSubscribeAppResponse>(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  logger.info({ wabaId, success: data.success }, "App subscription result");

  return data.success;
}

/**
 * Subscribe the app to a WABA with webhook override (per-WABA callback URL).
 * POST /{waba_id}/subscribed_apps with override_callback_uri + verify_token
 */
export async function subscribeAppWithOverride(
  wabaId: string,
  token: string,
  webhookUrl: string,
  verifyToken: string
): Promise<boolean> {
  const url = `${GRAPH_BASE}/${wabaId}/subscribed_apps`;

  logger.info({ wabaId, webhookUrl }, "Subscribing app to WABA with webhook override");

  const data = await graphFetch<MetaSubscribeAppResponse>(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      override_callback_uri: webhookUrl,
      verify_token: verifyToken,
    }),
  });

  logger.info(
    { wabaId, success: data.success },
    "App subscription with override result"
  );

  return data.success;
}

/**
 * Register a phone number for WhatsApp messaging.
 * POST /{phone_number_id}/register
 */
export async function registerPhoneNumber(
  phoneNumberId: string,
  token: string,
  pin: string
): Promise<boolean> {
  const url = `${GRAPH_BASE}/${phoneNumberId}/register`;

  logger.info({ phoneNumberId }, "Registering phone number");

  const data = await graphFetch<MetaRegisterPhoneResponse>(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      pin,
    }),
  });

  logger.info(
    { phoneNumberId, success: data.success },
    "Phone registration result"
  );

  return data.success;
}
