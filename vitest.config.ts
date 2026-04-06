import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
    env: {
      META_APP_ID: "test-app-id",
      META_APP_SECRET: "test-app-secret",
      META_CONFIG_ID: "test-config-id",
      META_API_VERSION: "v25.0",
      META_WEBHOOK_VERIFY_TOKEN: "test-webhook-verify-token",
      ENCRYPTION_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ADMIN_API_KEY: "test-admin-key",
      DATABASE_PATH: ":memory:",
      CORS_ORIGINS: "https://botargento.com.ar",
      PORT: "3099",
      NODE_ENV: "development",
      LOG_LEVEL: "fatal",
    },
  },
});
