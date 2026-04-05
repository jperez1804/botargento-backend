import { serve } from "@hono/node-server";
import pino from "pino";
import { env } from "./config/env.js";
import { createApp } from "./app.js";

const logger = pino({ level: env.LOG_LEVEL });
const app = createApp();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(
    { port: info.port, env: env.NODE_ENV },
    `Server running on http://localhost:${info.port}`
  );
});
