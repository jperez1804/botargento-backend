#!/usr/bin/env node
// ===========================================
// Re-encrypt every AES-256-GCM column with a new ENCRYPTION_KEY.
// ===========================================
//
// Usage:
//   OLD_ENCRYPTION_KEY=<64 hex> NEW_ENCRYPTION_KEY=<64 hex> \
//     node scripts/rotate-encryption-key.mjs <path/to/botargento.db> [--dry-run]
//
// Encrypted columns (must stay in sync with src/services/crypto.ts call sites):
//   credentials.encrypted_value
//   phone_numbers.registration_pin   (nullable)
//
// Format (mirrors src/services/crypto.ts): base64( iv[12] + authTag[16] + ciphertext )
//
// Safety:
//   - Every row is decrypted with the OLD key and verified BEFORE anything is written.
//     A wrong old key aborts with zero changes.
//   - Rows that already decrypt with the NEW key are skipped (safe to re-run).
//   - A file backup <db>.pre-rotation-<timestamp> is written before the transaction.
//   - All writes happen in one transaction; one audit_logs row per re-encrypted record.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { ulid } from "ulid";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function parseKey(name) {
  const value = process.env[name];
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
    console.error(`${name} must be a 64-character hex string (32 bytes)`);
    process.exit(1);
  }
  return Buffer.from(value, "hex");
}

function decrypt(key, encoded) {
  const combined = Buffer.from(encoded, "base64");
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function encrypt(key, plaintext) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function tryDecrypt(key, encoded) {
  try {
    return { ok: true, value: decrypt(key, encoded) };
  } catch {
    return { ok: false };
  }
}

// ─── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dbPath = args.find((a) => !a.startsWith("--"));
if (!dbPath || !existsSync(dbPath)) {
  console.error("Usage: node scripts/rotate-encryption-key.mjs <path/to/botargento.db> [--dry-run]");
  process.exit(1);
}
const oldKey = parseKey("OLD_ENCRYPTION_KEY");
const newKey = parseKey("NEW_ENCRYPTION_KEY");
if (oldKey.equals(newKey)) {
  console.error("OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY are identical; nothing to do.");
  process.exit(1);
}

const TARGETS = [
  { table: "credentials", column: "encrypted_value", entityType: "credential" },
  { table: "phone_numbers", column: "registration_pin", entityType: "phone_number" },
];

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// ─── phase 1: verify everything decrypts before touching anything ────────────
const plan = [];
const skipped = [];
const failures = [];

for (const t of TARGETS) {
  const rows = db
    .prepare(`SELECT id, ${t.column} AS value FROM ${t.table} WHERE ${t.column} IS NOT NULL`)
    .all();
  for (const row of rows) {
    const withOld = tryDecrypt(oldKey, row.value);
    if (withOld.ok) {
      plan.push({ ...t, id: row.id, plaintext: withOld.value });
      continue;
    }
    const withNew = tryDecrypt(newKey, row.value);
    if (withNew.ok) {
      skipped.push({ table: t.table, id: row.id });
      continue;
    }
    failures.push({ table: t.table, id: row.id });
  }
}

console.log(`Rows to re-encrypt : ${plan.length}`);
console.log(`Already on new key : ${skipped.length}`);
console.log(`Undecryptable      : ${failures.length}`);

if (failures.length > 0) {
  console.error("\nABORT: some rows decrypt with neither key. Wrong OLD_ENCRYPTION_KEY? Nothing was written.");
  for (const f of failures) console.error(`  ${f.table}#${f.id}`);
  process.exit(2);
}
if (plan.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}
if (dryRun) {
  console.log("\n--dry-run: no changes written.");
  process.exit(0);
}

// ─── phase 2: backup, then rewrite in one transaction ────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${dbPath}.pre-rotation-${stamp}`;
await db.backup(backupPath);
console.log(`\nBackup written: ${backupPath}`);

const updateStmt = Object.fromEntries(
  TARGETS.map((t) => [t.table, db.prepare(`UPDATE ${t.table} SET ${t.column} = ? WHERE id = ?`)])
);
const auditStmt = db.prepare(
  `INSERT INTO audit_logs (id, entity_type, entity_id, action, old_value, new_value, actor, created_at)
   VALUES (?, ?, ?, 'encryption_key_rotated', NULL, NULL, 'rotate-encryption-key', ?)`
);

const run = db.transaction(() => {
  const now = new Date().toISOString();
  for (const item of plan) {
    updateStmt[item.table].run(encrypt(newKey, item.plaintext), item.id);
    auditStmt.run(ulid(), item.entityType, item.id, now);
  }
});
run();

// ─── phase 3: verify with the new key only ───────────────────────────────────
let verified = 0;
for (const t of TARGETS) {
  const rows = db
    .prepare(`SELECT id, ${t.column} AS value FROM ${t.table} WHERE ${t.column} IS NOT NULL`)
    .all();
  for (const row of rows) {
    if (!tryDecrypt(newKey, row.value).ok) {
      console.error(`VERIFY FAILED: ${t.table}#${row.id} does not decrypt with the new key`);
      process.exit(3);
    }
    verified++;
  }
}
db.close();
console.log(`Done. ${plan.length} rows re-encrypted, ${verified} rows verified with the new key.`);
