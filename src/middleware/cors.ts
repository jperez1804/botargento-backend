import { cors } from "hono/cors";
import { env } from "../config/env.js";

const allowedOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim());

export const corsMiddleware = cors({
  origin: allowedOrigins,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "X-Admin-Key"],
  maxAge: 86400,
});
