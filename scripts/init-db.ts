import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
const configured = process.env.DATABASE_URL || "file:./dev.db";
if (!configured.startsWith("file:"))
  throw new Error("Требуется SQLite DATABASE_URL");
const raw = configured.slice(5);
const filename = path.isAbsolute(raw) ? raw : path.resolve("prisma", raw);
fs.mkdirSync(path.dirname(filename), { recursive: true });
const db = new Database(filename);
db.pragma("foreign_keys = ON");
const hadTasks = !!db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Task'")
  .get();
const hadHistory = !!db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'",
  )
  .get();
if (hadTasks && !hadHistory)
  throw new Error(
    "У базы отсутствует история Prisma-миграций. Используйте базу с историей миграций или новую базу.",
  );
db.exec(
  `CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" TEXT PRIMARY KEY NOT NULL,"checksum" TEXT NOT NULL,"finished_at" DATETIME,"migration_name" TEXT NOT NULL,"logs" TEXT,"rolled_back_at" DATETIME,"started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"applied_steps_count" INTEGER NOT NULL DEFAULT 0)`,
);
for (const name of fs.readdirSync("prisma/migrations").sort()) {
  const file = path.join("prisma/migrations", name, "migration.sql");
  if (!fs.existsSync(file)) continue;
  const sql = fs.readFileSync(file, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const prior = db
    .prepare(
      "SELECT checksum,finished_at,rolled_back_at FROM _prisma_migrations WHERE migration_name=? AND rolled_back_at IS NULL",
    )
    .get(name) as
    | { checksum: string; finished_at: unknown; rolled_back_at: unknown }
    | undefined;
  if (prior) {
    if (prior.checksum !== checksum || !prior.finished_at)
      throw new Error("Неполная или изменённая миграция: " + name);
    continue;
  }
  // Existing Prisma SQL contains foreign_keys PRAGMAs, so apply each file as supplied.
  db.exec(sql);
  db.prepare(
    "INSERT INTO _prisma_migrations (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES (?,?,?,?,?,1)",
  ).run(randomUUID(), checksum, Date.now(), name, Date.now());
  console.log("Applied", name);
}
if (db.prepare("PRAGMA foreign_key_check").all().length)
  throw new Error("Нарушены связи в базе");
db.close();
console.log("SQLite ready");
