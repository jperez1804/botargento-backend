import { timingSafeEqual, createHmac } from "node:crypto";
import { ulid } from "ulid";
import { env } from "../config/env.js";
import { logWebhookEvent } from "./audit.js";

interface SignedRequestPayload {
  algorithm?: string;
  issued_at?: number;
  user_id?: string;
  profile_id?: string;
  oauth_token?: string;
  expires?: number;
  [key: string]: unknown;
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64");
}

export function parseSignedRequest(signedRequest: string): SignedRequestPayload {
  const parts = signedRequest.split(".");

  if (parts.length !== 2) {
    throw new Error("Invalid signed_request format");
  }

  const [signaturePart, payloadPart] = parts;
  const expectedSignature = createHmac("sha256", env.META_APP_SECRET)
    .update(payloadPart)
    .digest();
  const providedSignature = decodeBase64Url(signaturePart);

  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new Error("Invalid signed_request signature");
  }

  const payloadJson = decodeBase64Url(payloadPart).toString("utf8");
  const payload = JSON.parse(payloadJson) as SignedRequestPayload;

  if (payload.algorithm !== "HMAC-SHA256") {
    throw new Error("Unsupported signed_request algorithm");
  }

  return payload;
}

export function recordMetaDeauthorize(payload: SignedRequestPayload) {
  logWebhookEvent({
    source: "meta_deauthorize",
    payload,
    processed: true,
    idempotencyKey: `meta_deauthorize_${payload.user_id ?? payload.profile_id ?? ulid()}`,
  });
}

export function buildDataDeletionResponse(
  payload: SignedRequestPayload,
  origin: string
) {
  const confirmationCode = ulid();

  logWebhookEvent({
    source: "meta_data_deletion",
    payload: {
      confirmation_code: confirmationCode,
      signed_request: payload,
    },
    processed: true,
    idempotencyKey: `meta_data_deletion_${payload.user_id ?? payload.profile_id ?? confirmationCode}`,
  });

  return {
    confirmation_code: confirmationCode,
    url: `${origin}/api/meta/platform/data-deletion/status/${confirmationCode}`,
  };
}
