import { Hono } from "hono";
import { z } from "zod";
import { env } from "../config/env.js";
import {
  createSession,
  getSession,
  completeSignup,
  logOnboardingEvent,
} from "../services/onboarding.js";

const embeddedSignup = new Hono();

// ─── GET /config ─────────────────────────────────────────────────────────────
embeddedSignup.get("/config", (c) => {
  const data: Record<string, string> = {
    app_id: env.META_APP_ID,
    config_id: env.META_CONFIG_ID,
    sdk_version: env.META_API_VERSION,
  };

  if (env.META_SOLUTION_ID) {
    data.solution_id = env.META_SOLUTION_ID;
  }

  return c.json({ success: true, data });
});

// ─── POST /sessions ──────────────────────────────────────────────────────────
const createSessionSchema = z.object({
  organization_name: z.string().min(1, "organization_name is required"),
  contact_email: z.string().email("Invalid email").optional(),
});

embeddedSignup.post("/sessions", async (c) => {
  const body = await c.req.json();
  const parsed = createSessionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parsed.error.issues,
        },
      },
      400
    );
  }

  const result = createSession(
    parsed.data.organization_name,
    parsed.data.contact_email
  );

  return c.json(
    {
      success: true,
      data: {
        session_id: result.sessionId,
        organization_id: result.organizationId,
      },
    },
    201
  );
});

// ─── GET /sessions/:sessionId ────────────────────────────────────────────────
embeddedSignup.get("/sessions/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  const session = getSession(sessionId);

  if (!session) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Session not found" },
      },
      404
    );
  }

  return c.json({ success: true, data: session });
});

// ─── POST /complete ──────────────────────────────────────────────────────────
const completeSignupSchema = z.object({
  session_id: z.string().min(1, "session_id is required"),
  code: z.string().min(1, "code is required"),
  phone_number_id: z.string().min(1, "phone_number_id is required"),
  waba_id: z.string().min(1, "waba_id is required"),
  business_id: z.string().min(1, "business_id is required"),
  display_phone_number: z.string().nullable().optional(),
});

embeddedSignup.post("/complete", async (c) => {
  const body = await c.req.json();
  const parsed = completeSignupSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parsed.error.issues,
        },
      },
      400
    );
  }

  try {
    const result = await completeSignup({
      sessionId: parsed.data.session_id,
      code: parsed.data.code,
      phoneNumberId: parsed.data.phone_number_id,
      wabaId: parsed.data.waba_id,
      businessId: parsed.data.business_id,
      displayPhoneNumber: parsed.data.display_phone_number ?? undefined,
    });

    const status = result.status === "assets_saved" ? 200 : 502;

    return c.json(
      { success: result.status === "assets_saved", data: result },
      status
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message.includes("not found")) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message } },
        404
      );
    }
    if (message.includes("Invalid status transition")) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message } },
        409
      );
    }

    return c.json(
      { success: false, error: { code: "INTERNAL_ERROR", message } },
      500
    );
  }
});

// ─── POST /events ───────────────────────────────────────────────────────────
// Captures WA_EMBEDDED_SIGNUP window message payloads (cancel, error, completed)
const onboardingEventSchema = z.object({
  session_id: z.string().optional(),
  event_type: z.enum(["completed", "cancel", "error"]),
  meta_session_id: z.string().optional(),
  current_step: z.string().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  phone_number_id: z.string().optional(),
  waba_id: z.string().optional(),
  business_id: z.string().optional(),
  raw_payload: z.unknown(),
});

embeddedSignup.post("/events", async (c) => {
  const body = await c.req.json();
  const parsed = onboardingEventSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parsed.error.issues,
        },
      },
      400,
    );
  }

  const result = logOnboardingEvent({
    sessionId: parsed.data.session_id,
    eventType: parsed.data.event_type,
    metaSessionId: parsed.data.meta_session_id,
    currentStep: parsed.data.current_step,
    errorCode: parsed.data.error_code,
    errorMessage: parsed.data.error_message,
    phoneNumberId: parsed.data.phone_number_id,
    wabaId: parsed.data.waba_id,
    businessId: parsed.data.business_id,
    rawPayload: parsed.data.raw_payload ?? {},
  });

  return c.json({ success: true, data: { event_id: result.id } }, 201);
});

export { embeddedSignup };
