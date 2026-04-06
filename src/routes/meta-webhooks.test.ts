import { describe, it, expect } from "vitest";
import { createApp } from "../app.js";

const app = createApp();
const BASE = "/api/webhooks/meta/whatsapp";

describe("GET /api/webhooks/meta/whatsapp (verification)", () => {
  it("returns challenge when verify_token matches", async () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "test-webhook-verify-token",
      "hub.challenge": "challenge_abc123",
    });

    const res = await app.request(`${BASE}?${params.toString()}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("challenge_abc123");
  });

  it("returns 403 when verify_token does not match", async () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong-token",
      "hub.challenge": "challenge_abc123",
    });

    const res = await app.request(`${BASE}?${params.toString()}`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when hub.mode is not subscribe", async () => {
    const params = new URLSearchParams({
      "hub.mode": "unsubscribe",
      "hub.verify_token": "test-webhook-verify-token",
      "hub.challenge": "challenge_abc123",
    });

    const res = await app.request(`${BASE}?${params.toString()}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 when parameters are missing", async () => {
    const res = await app.request(BASE);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/webhooks/meta/whatsapp (events)", () => {
  it("returns 200 EVENT_RECEIVED for account_update", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID_123",
          changes: [
            {
              field: "account_update",
              value: {
                event: "PARTNER_ADDED",
                waba_info: { waba_id: "WABA_ID_123" },
              },
            },
          ],
        },
      ],
    };

    const res = await app.request(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("EVENT_RECEIVED");
  });

  it("returns 200 for empty entry list", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [],
    };

    const res = await app.request(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
  });

  it("returns 200 for entries with no changes", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ id: "WABA_ID_456" }],
    };

    const res = await app.request(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
  });
});
