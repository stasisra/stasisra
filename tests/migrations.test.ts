import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const loader = pathToFileURL(require.resolve("tsx")).href;
const source = process.cwd();
function fixture(owner: boolean, incompatible = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gantt-schema-"));
  fs.cpSync(
    path.join(source, "prisma/migrations"),
    path.join(root, "prisma/migrations"),
    { recursive: true },
  );
  const file = path.join(root, "test.db");
  const db = new Database(file);
  db.exec(
    "CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY,checksum TEXT NOT NULL,finished_at DATETIME,migration_name TEXT NOT NULL,logs TEXT,rolled_back_at DATETIME,started_at DATETIME NOT NULL,applied_steps_count INTEGER NOT NULL)",
  );
  for (const name of [
    "20260118095108_init",
    "20260118204450_external_assignees",
  ]) {
    const sql = fs.readFileSync(
      path.join(root, "prisma/migrations", name, "migration.sql"),
      "utf8",
    );
    db.exec(sql);
    db.prepare(
      "INSERT INTO _prisma_migrations (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES (?,?,?,?,?,1)",
    ).run(
      randomUUID(),
      createHash("sha256").update(sql).digest("hex"),
      Date.now(),
      name,
      Date.now(),
    );
  }
  if (incompatible)
    db.exec(
      "CREATE TABLE NamePolicy (id TEXT NOT NULL PRIMARY KEY,scope TEXT NOT NULL)",
    );
  else {
    const sql = fs
      .readFileSync(
        path.join(
          root,
          "prisma/migrations/20260203103744_name_policy/migration.sql",
        ),
        "utf8",
      )
      .split("-- RedefineTables")[0];
    db.exec(sql);
    db.prepare(
      "INSERT INTO NamePolicy(id,scope,field,value,hidden,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)",
    ).run("policy", "GLOBAL", "tags", "keep", 1, 1, 1);
  }
  if (owner)
    db.exec(
      "ALTER TABLE Task ADD COLUMN ownerId TEXT REFERENCES User(id) ON DELETE SET NULL ON UPDATE CASCADE",
    );
  db.exec("ALTER TABLE Task ADD COLUMN customNote TEXT");
  db.prepare(
    "INSERT INTO User(id,name,email,passwordHash,role) VALUES (?,?,?,?,?)",
  ).run("admin", "Admin", "admin@example.test", "synthetic", "ADMIN");
  db.prepare(
    "INSERT INTO Task(id,title,startDate,endDate,percentComplete,updatedAt,customNote) VALUES (?,?,?,?,?,?,?)",
  ).run("existing", "Existing task", 1, 2, 23, 3, "keep extra column");
  db.prepare(
    "INSERT INTO TaskComment(id,body,taskId,authorId) VALUES (?,?,?,?)",
  ).run("comment", "Keep comment", "existing", "admin");
  db.close();
  return { root, file };
}
function run(root: string, file: string) {
  return spawnSync(
    process.execPath,
    ["--import", loader, path.join(source, "scripts/init-db.ts")],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: "file:" + file },
      encoding: "utf8",
    },
  );
}
for (const owner of [false, true])
  test(`existing NamePolicy with ${owner ? "present" : "missing"} ownerId is reconciled without rebuilding task data`, () => {
    const { root, file } = fixture(owner);
    let db: Database.Database | undefined;
    try {
      let result = run(root, file);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      result = run(root, file);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      db = new Database(file);
      assert.deepEqual(
        db
          .prepare(
            "SELECT title,percentComplete,customNote FROM Task WHERE id=?",
          )
          .get("existing"),
        {
          title: "Existing task",
          percentComplete: 23,
          customNote: "keep extra column",
        },
      );
      assert.equal(
        (
          db.prepare("SELECT count(*) as n FROM TaskComment").get() as {
            n: number;
          }
        ).n,
        1,
      );
      assert.equal(
        (
          db
            .prepare("SELECT hidden FROM NamePolicy WHERE id=?")
            .get("policy") as { hidden: number }
        ).hidden,
        1,
      );
      assert.equal(
        (
          db
            .prepare(
              "SELECT count(*) as n FROM _prisma_migrations WHERE migration_name=?",
            )
            .get("20260203103744_name_policy") as { n: number }
        ).n,
        1,
      );
      assert(
        db
          .prepare("SELECT name FROM sqlite_master WHERE name='Attachment'")
          .get(),
      );
      assert.deepEqual(db.pragma("foreign_key_check"), []);
    } finally {
      db?.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
test("incompatible existing dictionary aborts and rolls back without marking migration applied", () => {
  const { root, file } = fixture(false, true);
  let db: Database.Database | undefined;
  try {
    const result = run(root, file);
    assert.equal(result.status, 1);
    db = new Database(file);
    assert.equal(
      (db.prepare("SELECT count(*) as n FROM Task").get() as { n: number }).n,
      1,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT count(*) as n FROM _prisma_migrations WHERE migration_name=?",
          )
          .get("20260203103744_name_policy") as { n: number }
      ).n,
      0,
    );
    assert(
      !(db.pragma("table_info(Task)") as { name: string }[]).some(
        (c) => c.name === "ownerId",
      ),
    );
    const diagnostic = fs.readFileSync(
      path.join(root, "schema-check.json"),
      "utf8",
    );
    assert(!diagnostic.includes("Keep comment"));
    assert(!diagnostic.includes("synthetic"));
  } finally {
    db?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
