import { sql } from "drizzle-orm";
import { db } from "./db/client.js";

// Read and apply migration SQL for in-memory DB
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(import.meta.dirname, "db", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const content = readFileSync(join(migrationsDir, file), "utf-8");
  const statements = content
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    db.run(sql.raw(stmt));
  }
}
