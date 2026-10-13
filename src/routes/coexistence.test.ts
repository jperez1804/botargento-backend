import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { db } from "../db/client.js";
import { credentials, onboardingSessions, phoneNumbers } from "../db/schema.js";

const app = createApp();
const BASE = "/api/meta/embedded-signup";
const ADMIN = { "X-Admin-Key": "test-admin-key", "Content-Type": "application/json" };

type Call = { url: string; body: unknown };

// Fake Graph API: records every call; a URL matching `fail` returns a Graph error.
function mockGraph(fail: RegExp[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    if (fail.some((re) => re.test(url))) {
      return new Response(JSON.stringify({ error: { message: "boom", type: "OAuthException", code: 100, fbtrace_id: "x" } }), { status: 400 });
    }
    if (url.includes("/oauth/access_token")) {
      return Response.json({ access_token: "biz-token", token_type: "bearer" });
    }
    if (url.includes("/smb_app_data")) {
      return Response.json({ messaging_product: "whatsapp", request_id: "req-1" });
    }
    return Response.json({ success: true });
  }));
  return calls;
}

async function newSession(name: string): Promise<string> {
  const res = await app.request(`${BASE}/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organization_name: name }),
  });
  return (await res.json()).data.session_id;
}

function complete(sessionId: string, ids: string, extra: Record<string, unknown> = {}) {
  return app.request(`${BASE}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId, code: "the-code",
      phone_number_id: `phone-${ids}`, waba_id: `waba-${ids}`, business_id: `biz-${ids}`,
      ...extra,
    }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("POST /complete — coexistence", () => {
  it("skips /register and requests contacts + history sync", async () => {
    const calls = mockGraph();
    const sessionId = await newSession("CoexCo");

    const res = await complete(sessionId, "c1", { signup_type: "coexistence" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.signupType).toBe("coexistence");
    expect(body.data.phoneRegistered).toBe(false);
    expect(body.data.contactsSyncRequested).toBe(true);
    expect(body.data.historySyncRequested).toBe(true);

    expect(calls.some((c) => c.url.includes("/register"))).toBe(false);
    const syncs = calls
      .filter((c) => c.url.endsWith("/phone-c1/smb_app_data"))
      .map((c) => (c.body as { sync_type: string }).sync_type);
    expect(syncs).toEqual(["smb_app_state_sync", "history"]);

    const phone = db.select().from(phoneNumbers).where(eq(phoneNumbers.phoneNumberId, "phone-c1")).get()!;
    expect(phone.signupType).toBe("coexistence");
    expect(phone.registrationPin).toBeNull();
    expect(phone.contactsSyncRequestedAt).not.toBeNull();
    expect(phone.historySyncRequestedAt).not.toBeNull();

    const session = db.select().from(onboardingSessions).where(eq(onboardingSessions.id, sessionId)).get()!;
    expect(session.signupType).toBe("coexistence");
    expect(session.status).toBe("assets_saved");
  });

  it("a failed sync does not fail the onboarding", async () => {
    mockGraph([/smb_app_data/]);
    const sessionId = await newSession("CoexSyncFail");

    const res = await complete(sessionId, "c2", { signup_type: "coexistence" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.historySyncRequested).toBe(false);
    expect(body.data.completedSteps).toContain("history_sync_failed");
  });
});

describe("POST /complete — standard", () => {
  it("still registers the number with a PIN when signup_type is omitted", async () => {
    const calls = mockGraph();
    const sessionId = await newSession("StdCo");

    const res = await complete(sessionId, "s1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.signupType).toBe("standard");
    expect(body.data.phoneRegistered).toBe(true);

    expect(calls.some((c) => c.url.endsWith("/phone-s1/register"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/smb_app_data"))).toBe(false);

    const phone = db.select().from(phoneNumbers).where(eq(phoneNumbers.phoneNumberId, "phone-s1")).get()!;
    expect(phone.registrationPin).not.toBeNull();
  });

  it("stores the token before the Graph calls, so a failure is reconcilable", async () => {
    mockGraph([/subscribed_apps/]);
    const sessionId = await newSession("SubFailCo");

    const res = await complete(sessionId, "s2");
    expect(res.status).toBe(502);

    const session = db.select().from(onboardingSessions).where(eq(onboardingSessions.id, sessionId)).get()!;
    expect(session.status).toBe("failed");
    const cred = db.select().from(credentials).where(eq(credentials.organizationId, session.organizationId!)).get();
    expect(cred?.credentialType).toBe("business_integration_token");

    // Meta recovers → reconcile finishes with the stored token
    mockGraph();
    const rec = await app.request(`/api/admin/onboarding/${sessionId}/reconcile`, { method: "POST", headers: ADMIN });
    expect(rec.status).toBe(200);
    expect((await rec.json()).data.status).toBe("assets_saved");
  });

  it("rejects an unknown signup_type", async () => {
    const sessionId = await newSession("BadType");
    const res = await complete(sessionId, "s3", { signup_type: "other" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/onboarding/import", () => {
  const payload = {
    organization_name: "Imported", business_id: "biz-i1", waba_id: "waba-i1",
    phone_number_id: "phone-i1", signup_type: "coexistence", access_token: "sys-token",
  };

  it("requires the admin key", async () => {
    const res = await app.request("/api/admin/onboarding/import", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    expect(res.status).toBe(401);
  });

  it("imports a coexistence number with a system user token", async () => {
    const calls = mockGraph();
    const res = await app.request("/api/admin/onboarding/import", {
      method: "POST", headers: ADMIN, body: JSON.stringify(payload),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe("assets_saved");
    expect(JSON.stringify(body)).not.toContain("sys-token");

    expect(calls.some((c) => c.url.includes("/register"))).toBe(false);
    expect(calls.filter((c) => c.url.includes("/smb_app_data"))).toHaveLength(2);

    const session = db.select().from(onboardingSessions).where(eq(onboardingSessions.id, body.data.sessionId)).get()!;
    const cred = db.select().from(credentials).where(eq(credentials.organizationId, session.organizationId!)).get()!;
    expect(cred.credentialType).toBe("system_user_token");
    expect(cred.encryptedValue).not.toBe("sys-token");

    const detail = await app.request(`/api/admin/onboarding/${body.data.sessionId}`, { headers: ADMIN });
    const d = (await detail.json()).data;
    expect(d.session.signup_type).toBe("coexistence");
    expect(d.credential.credential_type).toBe("system_user_token");
    expect(d.phone.history_sync_requested_at).not.toBeNull();
  });

  it("refuses a WABA that is already onboarded", async () => {
    mockGraph();
    const res = await app.request("/api/admin/onboarding/import", {
      method: "POST", headers: ADMIN, body: JSON.stringify(payload),
    });
    expect(res.status).toBe(409);
  });

  it("does not echo the token on validation errors", async () => {
    const res = await app.request("/api/admin/onboarding/import", {
      method: "POST", headers: ADMIN, body: JSON.stringify({ ...payload, waba_id: "" }),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("sys-token");
  });
});
