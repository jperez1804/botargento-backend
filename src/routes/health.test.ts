import { describe, it, expect } from "vitest";
import { createApp } from "../app.js";

const app = createApp();

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.timestamp).toBeDefined();
  });
});

describe("GET /ready", () => {
  it("returns 200 when DB and env are ready", async () => {
    const res = await app.request("/ready");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ready");
    expect(body.data.checks.db).toBe(true);
    expect(body.data.checks.env).toBe(true);
  });
});
