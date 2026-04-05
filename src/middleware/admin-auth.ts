import { createMiddleware } from "hono/factory";
import { env } from "../config/env.js";

export const adminAuth = createMiddleware(async (c, next) => {
  const key = c.req.header("X-Admin-Key");

  if (!key || key !== env.ADMIN_API_KEY) {
    return c.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid admin key",
        },
      },
      401
    );
  }

  await next();
});
