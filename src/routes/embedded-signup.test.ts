import { describe, it, expect } from "vitest";
import { createApp } from "../app.js";

const app = createApp();
const BASE = "/api/meta/embedded-signup";

describe("GET /config", () => {
  it("returns public Meta config without optional fields when not configured", async () => {
    const res = await app.request(`${BASE}/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.app_id).toBe("test-app-id");
    expect(body.data.config_id).toBe("test-config-id");
    expect(body.data.solution_id).toBeUndefined();
    expect(body.data.sdk_version).toBe("v25.0");
  });
});

describe("POST /sessions", () => {
  it("creates a session and returns 201", async () => {
    const res = await app.request(`${BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_name: "TestCo" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.session_id).toBeDefined();
    expect(body.data.organization_id).toBeDefined();
  });

  it("creates a session with optional email", async () => {
    const res = await app.request(`${BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_name: "TestCo2", contact_email: "a@b.com" }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 400 on missing organization_name", async () => {
    const res = await app.request(`${BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 on invalid email", async () => {
    const res = await app.request(`${BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_name: "Test", contact_email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /sessions/:sessionId", () => {
  it("returns session detail", async () => {
    // Create a session first
    const createRes = await app.request(`${BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_name: "LookupCo" }),
    });
    const created = await createRes.json();
    const sessionId = created.data.session_id;

    const res = await app.request(`${BASE}/sessions/${sessionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(sessionId);
    expect(body.data.status).toBe("started");
    expect(body.data.startedAt).toBeDefined();
  });

  it("returns 404 for nonexistent session", async () => {
    const res = await app.request(`${BASE}/sessions/nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("POST /complete", () => {
  it("returns 400 on missing fields", async () => {
    const res = await app.request(`${BASE}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "abc" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it("returns 404 for nonexistent session", async () => {
    const res = await app.request(`${BASE}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "nonexistent",
        code: "auth_code",
        phone_number_id: "123",
        waba_id: "456",
        business_id: "789",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("accepts optional display_phone_number", async () => {
    const res = await app.request(`${BASE}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "nonexistent",
        code: "auth_code",
        phone_number_id: "123",
        waba_id: "456",
        business_id: "789",
        display_phone_number: "+54 9 11 1234-5678",
      }),
    });
    // Should fail on session lookup (404), not validation
    expect(res.status).toBe(404);
  });
});

describe("POST /events", () => {
  it("logs a cancel event and returns 201", async () => {
    const res = await app.request(`${BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "cancel",
        current_step: "business_verification",
        raw_payload: { type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", current_step: "business_verification" },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.event_id).toBeDefined();
  });

  it("logs an error event with all optional fields", async () => {
    // Create a real session so FK is valid
    const sessionRes = await app.request(`${BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_name: "ErrorTestCo" }),
    });
    const sessionData = await sessionRes.json();

    const res = await app.request(`${BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionData.data.session_id,
        event_type: "error",
        meta_session_id: "meta-sess-123",
        error_code: "100",
        error_message: "Something went wrong",
        raw_payload: { type: "WA_EMBEDDED_SIGNUP", error_code: 100 },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("logs a completed event with asset IDs", async () => {
    // Create a real session so FK is valid
    const sessionRes = await app.request(`${BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_name: "CompletedTestCo" }),
    });
    const sessionData = await sessionRes.json();

    const res = await app.request(`${BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionData.data.session_id,
        event_type: "completed",
        phone_number_id: "12345",
        waba_id: "67890",
        business_id: "99999",
        raw_payload: { type: "WA_EMBEDDED_SIGNUP", event: "FINISH" },
      }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 400 on invalid event_type", async () => {
    const res = await app.request(`${BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "invalid_type",
        raw_payload: {},
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when event_type is missing", async () => {
    const res = await app.request(`${BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_payload: {} }),
    });
    expect(res.status).toBe(400);
  });
});
