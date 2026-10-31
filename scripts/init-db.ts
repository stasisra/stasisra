import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

type Column = { name: string; type: string; notnull: number; pk: number };
type ForeignKey = {
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
};
type Index = { name: string; unique: number };
const tables = ["User", "Task", "TaskComment", "NamePolicy", "Attachment"];
const migrations = fs
  .readdirSync("prisma/migrations")
  .sort()
  .filter((name) =>
    fs.existsSync(path.join("prisma/migrations", name, "migration.sql")),
  );
const sqlFor = (name: string) =>
  fs.readFileSync(
    path.join("prisma/migrations", name, "migration.sql"),
    "utf8",
  );
const configured = process.env.DATABASE_URL || "file:./dev.db";
if (!configured.startsWith("file:"))
  throw new Error("Требуется SQLite DATABASE_URL");
const raw = configured.slice(5);
const filename = path.isAbsolute(raw) ? raw : path.resolve("prisma", raw);
fs.mkdirSync(path.dirname(filename), { recursive: true });
const db = new Database(filename);
db.pragma("foreign_keys = ON");
function exists(database: Database.Database, name: string) {
  return !!database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}
function columns(database: Database.Database, table: string) {
  return database
    .prepare("SELECT * FROM pragma_table_info(?)")
    .all(table) as Column[];
}
function foreignKeys(database: Database.Database, table: string) {
  return database
    .prepare("SELECT * FROM pragma_foreign_key_list(?)")
    .all(table) as ForeignKey[];
}
function indexes(database: Database.Database, table: string) {
  return (
    database.prepare("SELECT * FROM pragma_index_list(?)").all(table) as Index[]
  ).map((index) => ({
    ...index,
    columns: (
      database
        .prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
        .all(index.name) as { name: string }[]
    ).map((item) => item.name),
  }));
}
function assertCompatible(reference: Database.Database, table: string) {
  const actual = new Map(
    columns(db, table).map((column) => [column.name, column]),
  );
  for (const expected of columns(reference, table)) {
    const column = actual.get(expected.name);
    if (
      !column ||
      column.type.toUpperCase() !== expected.type.toUpperCase() ||
      column.notnull !== expected.notnull ||
      column.pk !== expected.pk
    ) {
      throw new Error(
        `Структура ${table}.${expected.name} отличается от ожидаемой. Автоматическое изменение остановлено.`,
      );
    }
  }
  const links = foreignKeys(db, table);
  for (const expected of foreignKeys(reference, table)) {
    if (
      !links.some((link) =>
        ["table", "from", "to", "on_update", "on_delete"].every(
          (key) =>
            link[key as keyof ForeignKey] === expected[key as keyof ForeignKey],
        ),
      )
    ) {
      throw new Error(
        `Структура ${table}: отсутствует ожидаемая связь ${expected.from} → ${expected.table}.${expected.to}`,
      );
    }
  }
  const actualIndexes = indexes(db, table);
  for (const expected of indexes(reference, table)) {
    if (
      !actualIndexes.some(
        (index) =>
          index.unique === expected.unique &&
          JSON.stringify(index.columns) === JSON.stringify(expected.columns),
      )
    ) {
      throw new Error(
        `Структура ${table}: отсутствует индекс ${expected.columns.join(", ")}`,
      );
    }
  }
}
function record(name: string, checksum: string, note: string | null = null) {
  db.prepare(
    "INSERT INTO _prisma_migrations (id,checksum,finished_at,migration_name,started_at,applied_steps_count,logs) VALUES (?,?,?,?,?,1,?)",
  ).run(randomUUID(), checksum, Date.now(), name, Date.now(), note);
}
function reconcileNamePolicy(name: string, checksum: string) {
  const reference = new Database(":memory:");
  try {
    for (const migration of migrations) {
      reference.exec(sqlFor(migration));
      if (migration === name) break;
    }
    // This migration may already have been applied through db push. Complete only
    // its additive changes, then verify the resulting schema before baselining it.
    db.transaction(() => {
      if (!exists(db, "NamePolicy")) {
        const definition = reference
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='NamePolicy'",
          )
          .get() as { sql: string };
        db.exec(definition.sql);
      }
      if (!columns(db, "Task").some((column) => column.name === "ownerId")) {
        db.exec(
          'ALTER TABLE "Task" ADD COLUMN "ownerId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE',
        );
      }
      if (
        !indexes(db, "NamePolicy").some(
          (index) =>
            index.unique &&
            JSON.stringify(index.columns) ===
              JSON.stringify(["scope", "field", "value"]),
        )
      ) {
        db.exec(
          'CREATE UNIQUE INDEX "NamePolicy_scope_field_value_key" ON "NamePolicy"("scope", "field", "value")',
        );
      }
      if (
        !indexes(db, "Task").some(
          (index) =>
            !index.unique &&
            JSON.stringify(index.columns) === JSON.stringify(["ownerId"]),
        )
      ) {
        db.exec('CREATE INDEX "Task_ownerId_idx" ON "Task"("ownerId")');
      }
      for (const table of ["User", "Task", "TaskComment", "NamePolicy"])
        assertCompatible(reference, table);
      if (db.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error(
          "В существующей базе нарушены связи. Изменение отменено.",
        );
      record(
        name,
        checksum,
        "Reconciled pre-existing NamePolicy/ownerId; existing tables and task data were retained.",
      );
    })();
    console.log("Согласована существующая схема:", name);
  } finally {
    reference.close();
  }
}
try {
  if (exists(db, "Task") && !exists(db, "_prisma_migrations")) {
    throw new Error(
      "У базы отсутствует история Prisma-миграций. Автоматическое изменение остановлено.",
    );
  }
  db.exec(
    'CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" TEXT PRIMARY KEY NOT NULL,"checksum" TEXT NOT NULL,"finished_at" DATETIME,"migration_name" TEXT NOT NULL,"logs" TEXT,"rolled_back_at" DATETIME,"started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"applied_steps_count" INTEGER NOT NULL DEFAULT 0)',
  );
  for (const name of migrations) {
    const sql = sqlFor(name);
    const checksum = createHash("sha256").update(sql).digest("hex");
    const prior = db
      .prepare(
        "SELECT checksum,finished_at FROM _prisma_migrations WHERE migration_name=? AND rolled_back_at IS NULL",
      )
      .get(name) as { checksum: string; finished_at: unknown } | undefined;
    if (prior) {
      if (prior.checksum !== checksum || !prior.finished_at)
        throw new Error("Неполная или изменённая миграция: " + name);
      continue;
    }
    if (
      name === "20260203103744_name_policy" &&
      (exists(db, "NamePolicy") ||
        columns(db, "Task").some((column) => column.name === "ownerId"))
    ) {
      reconcileNamePolicy(name, checksum);
    } else {
      if (name === "20261031000200_workspace")
        db.transaction(() => {
          db.exec(sql);
          record(name, checksum);
        })();
      else {
        db.exec(sql);
        record(name, checksum);
      }
      console.log("Applied", name);
    }
  }
  if (db.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("Нарушены связи в базе");
  console.log("SQLite ready");
} catch (error) {
  const schema = Object.fromEntries(
    tables.map((table) => [
      table,
      {
        columns: columns(db, table).map(({ name, type, notnull, pk }) => ({
          name,
          type,
          notnull,
          pk,
        })),
        foreignKeys: foreignKeys(db, table),
        indexes: indexes(db, table),
      },
    ]),
  );
  fs.writeFileSync("schema-check.json", JSON.stringify({ schema }, null, 2));
  console.error(error instanceof Error ? error.message : error);
  console.error(
    "Сведения только о структуре записаны в schema-check.json. Содержимое задач и пароли в этот файл не попадают.",
  );
  process.exitCode = 1;
} finally {
  db.close();
}
