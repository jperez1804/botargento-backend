import type { Context, Next } from "hono";
import pino from "pino";
import { env } from "../config/env.js";

const logger = pino({ level: env.LOG_LEVEL });

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred";
    const stack = err instanceof Error ? err.stack : undefined;

    logger.error({ err: message, stack, path: c.req.path, method: c.req.method }, "Unhandled error");

    const status = c.res?.status ?? 500;
    const statusCode = status >= 400 && status < 600 ? status : 500;

    return c.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message:
            env.NODE_ENV === "production"
              ? "An unexpected error occurred"
              : message,
        },
      },
      statusCode as 500
    );
  }
}
