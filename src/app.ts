import { Hono } from "hono";
import { errorHandler } from "./middleware/error-handler.js";
import { corsMiddleware } from "./middleware/cors.js";
import { publicRateLimit, adminRateLimit } from "./middleware/rate-limit.js";
import { health } from "./routes/health.js";
import { embeddedSignup } from "./routes/embedded-signup.js";
import { admin } from "./routes/admin.js";

export function createApp() {
  const app = new Hono();

  // Global middleware
  app.use("*", errorHandler);
  app.use("*", corsMiddleware);

  // Rate limiting per route group
  app.use("/api/admin/*", adminRateLimit);
  app.use("*", publicRateLimit);

  // Health routes (no auth)
  app.route("/", health);

  // Embedded Signup routes (public)
  app.route("/api/meta/embedded-signup", embeddedSignup);

  // Admin routes (X-Admin-Key auth, applied inside admin router)
  app.route("/api/admin", admin);

  return app;
}
