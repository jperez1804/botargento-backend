import { Hono } from "hono";
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";
import { env } from "../config/env.js";

const health = new Hono();

health.get("/health", (c) => {
  return c.json({
    success: true,
    data: {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
  });
});

health.get("/ready", (c) => {
  const checks: { db: boolean; env: boolean; errors: string[] } = {
    db: false,
    env: false,
    errors: [],
  };

  // Check DB is accessible
  try {
    db.get<{ ok: number }>(sql`SELECT 1 as ok`);
    checks.db = true;
  } catch (err) {
    checks.errors.push(
      `Database not accessible: ${err instanceof Error ? err.message : "unknown"}`
    );
  }

  // Check required env vars are present (optional vars excluded)
  const requiredVars = [
    "META_APP_ID",
    "META_APP_SECRET",
    "META_CONFIG_ID",
    "ENCRYPTION_KEY",
    "ADMIN_API_KEY",
  ] as const;

  const missing = requiredVars.filter(
    (v) => !env[v]
  );

  if (missing.length === 0) {
    checks.env = true;
  } else {
    checks.errors.push(`Missing env vars: ${missing.join(", ")}`);
  }

  const ready = checks.db && checks.env;

  return c.json(
    {
      success: ready,
      data: {
        status: ready ? "ready" : "not_ready",
        checks: { db: checks.db, env: checks.env },
        ...(checks.errors.length > 0 && { errors: checks.errors }),
        timestamp: new Date().toISOString(),
      },
    },
    ready ? 200 : 503
  );
});

export { health };
