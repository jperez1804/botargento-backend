import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptDir);
const sourceDir = join(projectRoot, "src", "db", "migrations");
const targetDir = join(projectRoot, "dist", "db", "migrations");

if (!existsSync(sourceDir)) {
  throw new Error(`Missing source migrations directory: ${sourceDir}`);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true, force: true });

console.log(`Copied migrations to ${targetDir}`);
