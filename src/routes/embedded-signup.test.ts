import { describe, it, expect } from "vitest";
import { createApp } from "../app.js";

const app = createApp();
const BASE = "/api/meta/embedded-signup";

describe("GET /config", () => {
  it("returns public Meta config", async () => {
    const res = await app.request(`${BASE}/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.app_id).toBe("test-app-id");
    expect(body.data.config_id).toBe("test-config-id");
    expect(body.data.solution_id).toBe("test-solution-id");
    expect(body.data.sdk_version).toBe("v22.0");
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
});
