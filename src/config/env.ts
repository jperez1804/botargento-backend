import { z } from "zod";

const envSchema = z.object({
  // Meta / Facebook App
  META_APP_ID: z.string().min(1, "META_APP_ID is required"),
  META_APP_SECRET: z.string().min(1, "META_APP_SECRET is required"),
  META_CONFIG_ID: z.string().min(1, "META_CONFIG_ID is required"),
  META_SOLUTION_ID: z.string().min(1).optional(),
  META_SYSTEM_USER_TOKEN: z.string().min(1).optional(),
  META_API_VERSION: z.string().default("v25.0"),

  // Webhooks
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1, "META_WEBHOOK_VERIFY_TOKEN is required"),

  // Security
  ENCRYPTION_KEY: z
    .string()
    .length(64, "ENCRYPTION_KEY must be a 64-character hex string (32 bytes)")
    .regex(/^[0-9a-fA-F]+$/, "ENCRYPTION_KEY must be a valid hex string"),
  ADMIN_API_KEY: z.string().min(1, "ADMIN_API_KEY is required"),

  // Database
  DATABASE_PATH: z.string().default("./data/botargento.db"),

  // Server
  CORS_ORIGINS: z.string().default("https://botargento.com.ar,https://www.botargento.com.ar"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(
      `\n❌ Invalid environment configuration:\n${formatted}\n\nSee .env.example for required variables.\n`
    );
    process.exit(1);
  }

  return result.data as Env;
}

export const env = loadEnv();
