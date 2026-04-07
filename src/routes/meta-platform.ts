import { Hono } from "hono";
import type { Context } from "hono";
import pino from "pino";
import { env } from "../config/env.js";
import {
  buildDataDeletionResponse,
  parseSignedRequest,
  recordMetaDeauthorize,
} from "../services/meta-platform.js";

const logger = pino({ level: env.LOG_LEVEL });
const metaPlatform = new Hono();

async function getSignedRequest(c: Context) {
  const body = await c.req.parseBody();
  const signedRequest = body.signed_request;

  if (typeof signedRequest !== "string" || signedRequest.length === 0) {
    throw new Error("signed_request is required");
  }

  return signedRequest;
}

metaPlatform.post("/deauthorize", async (c) => {
  try {
    const signedRequest = await getSignedRequest(c);
    const payload = parseSignedRequest(signedRequest);

    recordMetaDeauthorize(payload);
    logger.info({ userId: payload.user_id }, "Meta app deauthorize callback received");

    return c.text("OK", 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid deauthorize callback";
    logger.warn({ err: message }, "Meta deauthorize callback rejected");
    return c.json(
      { success: false, error: { code: "BAD_REQUEST", message } },
      400,
    );
  }
});

metaPlatform.post("/data-deletion", async (c) => {
  try {
    const signedRequest = await getSignedRequest(c);
    const payload = parseSignedRequest(signedRequest);
    const origin = new URL(c.req.url).origin;
    const response = buildDataDeletionResponse(payload, origin);

    logger.info(
      { userId: payload.user_id, confirmationCode: response.confirmation_code },
      "Meta data deletion callback received",
    );

    return c.json(response, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid data deletion callback";
    logger.warn({ err: message }, "Meta data deletion callback rejected");
    return c.json(
      { success: false, error: { code: "BAD_REQUEST", message } },
      400,
    );
  }
});

metaPlatform.get("/data-deletion/status/:confirmationCode", (c) => {
  const confirmationCode = c.req.param("confirmationCode");
  return c.html(
    `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>BotArgento - Estado de eliminación de datos</title>
  </head>
  <body>
    <h1>Solicitud recibida</h1>
    <p>Se registró la solicitud de eliminación de datos.</p>
    <p>Código de confirmación: <code>${confirmationCode}</code></p>
  </body>
</html>`,
    200,
  );
});

export { metaPlatform };
