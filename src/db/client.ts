import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import pino from "pino";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

const logger = pino({ level: env.LOG_LEVEL });

function createDb() {
  const dbPath = env.DATABASE_PATH;
  const dir = dirname(dbPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const database = drizzle(sqlite, { schema });
  const migrationsFolder = join(import.meta.dirname, "migrations");

  migrate(database, { migrationsFolder });
  logger.info({ dbPath, migrationsFolder }, "Database migrations applied");

  return database;
}

export const db = createDb();
