import { describe, it, expect } from "vitest";
import { createApp } from "../app.js";

const app = createApp();
const ADMIN = "/api/admin";
const SIGNUP = "/api/meta/embedded-signup";
const AUTH = { "X-Admin-Key": "test-admin-key" };

// Helper: create a session via public API
async function createTestSession(name = "AdminTestCo") {
  const res = await app.request(`${SIGNUP}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organization_name: name }),
  });
  const body = await res.json();
  return body.data.session_id as string;
}

describe("Admin auth", () => {
  it("returns 401 without X-Admin-Key", async () => {
    const res = await app.request(`${ADMIN}/onboarding`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 with wrong key", async () => {
    const res = await app.request(`${ADMIN}/onboarding`, {
      headers: { "X-Admin-Key": "wrong-key" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with correct key", async () => {
    const res = await app.request(`${ADMIN}/onboarding`, { headers: AUTH });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/admin/onboarding", () => {
  it("lists sessions", async () => {
    await createTestSession("ListCo");
    const res = await app.request(`${ADMIN}/onboarding`, { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("filters by status", async () => {
    const res = await app.request(`${ADMIN}/onboarding?status=started`, { headers: AUTH });
    const body = await res.json();
    expect(body.data.every((s: { status: string }) => s.status === "started")).toBe(true);
  });

  it("returns empty for non-matching status", async () => {
    const res = await app.request(`${ADMIN}/onboarding?status=webhook_ready`, { headers: AUTH });
    const body = await res.json();
    expect(body.data.length).toBe(0);
  });
});

describe("GET /api/admin/onboarding/:id", () => {
  it("returns full detail for a session", async () => {
    const sessionId = await createTestSession("DetailCo");
    const res = await app.request(`${ADMIN}/onboarding/${sessionId}`, { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.session.id).toBe(sessionId);
    expect(body.data.session.status).toBe("started");
    expect(body.data.organization).not.toBeNull();
    expect(body.data.organization.name).toBe("DetailCo");
    expect(body.data.audit_log.length).toBeGreaterThan(0);
    // No credential or WABA data yet
    expect(body.data.waba).toBeNull();
    expect(body.data.credential).toBeNull();
  });

  it("returns 404 for nonexistent session", async () => {
    const res = await app.request(`${ADMIN}/onboarding/nonexistent`, { headers: AUTH });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/onboarding/:id/reconcile", () => {
  it("returns 409 when session is not failed", async () => {
    const sessionId = await createTestSession("ReconcileCo");
    const res = await app.request(`${ADMIN}/onboarding/${sessionId}/reconcile`, {
      method: "POST",
      headers: AUTH,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("returns 404 for nonexistent session", async () => {
    const res = await app.request(`${ADMIN}/onboarding/nonexistent/reconcile`, {
      method: "POST",
      headers: AUTH,
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/onboarding/:id/activate-webhook", () => {
  it("returns 400 on invalid body", async () => {
    const sessionId = await createTestSession("WebhookCo");
    const res = await app.request(`${ADMIN}/onboarding/${sessionId}/activate-webhook`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 when session is not assets_saved", async () => {
    const sessionId = await createTestSession("WebhookCo2");
    const res = await app.request(`${ADMIN}/onboarding/${sessionId}/activate-webhook`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ webhook_url: "https://example.com/wh", verify_token: "tok" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/admin/onboarding/:id/rotate-credentials", () => {
  it("returns 400 on missing code", async () => {
    const sessionId = await createTestSession("RotateCo");
    const res = await app.request(`${ADMIN}/onboarding/${sessionId}/rotate-credentials`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for nonexistent session", async () => {
    const res = await app.request(`${ADMIN}/onboarding/nonexistent/rotate-credentials`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "some_code" }),
    });
    expect(res.status).toBe(404);
  });
});
