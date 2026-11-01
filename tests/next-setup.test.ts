import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import Database from "better-sqlite3";
const { prepareNext } = createRequire(import.meta.url)(
  "../scripts/setup-next.cjs",
);
test("fresh next installation copies only the admin, reuses modules, preserves source WAL and next data on retry", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-install-"));
  const source = path.join(dir, "source"),
    root = path.join(dir, "next");
  for (const folder of [source, root]) {
    fs.mkdirSync(path.join(folder, "prisma"), { recursive: true });
    fs.writeFileSync(
      path.join(folder, "package.json"),
      JSON.stringify({ name: "task-gantt-app" }),
    );
  }
  fs.symlinkSync(
    path.resolve("node_modules"),
    path.join(source, "node_modules"),
    "dir",
  );
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync("scripts/init-db.ts", path.join(root, "scripts/init-db.ts"));
  fs.cpSync("prisma/migrations", path.join(root, "prisma/migrations"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(source, ".env"),
    'DATABASE_URL="file:./current.db"',
  );
  const db = new Database(path.join(source, "prisma/current.db"));
  try {
    db.pragma("journal_mode=WAL");
    db.exec(
      "CREATE TABLE User(id TEXT,name TEXT,email TEXT,passwordHash TEXT,role TEXT,createdAt INTEGER); CREATE TABLE Task(id TEXT,title TEXT)",
    );
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.prepare("INSERT INTO User VALUES(?,?,?,?,?,?)").run(
      "admin",
      "Админ",
      "admin@test.local",
      "synthetic-hash",
      "ADMIN",
      1,
    );
    db.prepare("INSERT INTO Task VALUES(?,?)").run("task", "Актуальная задача");
    prepareNext({ root, source, build: false });
    const config = parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8"));
    assert.equal(config.APP_URL, "http://127.0.0.1:3003");
    assert.ok((config.AUTH_JWT_SECRET || "").length >= 32);
    const next = new Database(path.join(root, "prisma/dev.db"));
    try {
      assert.equal(
        (next.prepare("SELECT count(*) n FROM Task").get() as any).n,
        0,
      );
      assert.equal(
        (next.prepare("SELECT count(*) n FROM ContentItem").get() as any).n,
        0,
      );
      assert.equal(
        (next.prepare("SELECT count(*) n FROM Project").get() as any).n,
        0,
      );
      assert.equal(
        (next.prepare("SELECT passwordHash FROM User").get() as any)
          .passwordHash,
        "synthetic-hash",
      );
      next
        .prepare(
          "INSERT INTO ContentItem(id,kind,title,createdAt,updatedAt) VALUES('new','task','Новая задача',1,1)",
        )
        .run();
    } finally {
      next.close();
    }
    prepareNext({ root, source, build: false });
    const retained = new Database(path.join(root, "prisma/dev.db"));
    assert.equal(
      (retained.prepare("SELECT count(*) n FROM ContentItem").get() as any).n,
      1,
    );
    retained.close();
    assert.equal((db.prepare("SELECT count(*) n FROM Task").get() as any).n, 1);
    assert.equal(
      parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8"))
        .AUTH_JWT_SECRET,
      config.AUTH_JWT_SECRET,
    );
    assert.equal(
      fs.realpathSync(path.join(root, "node_modules")),
      fs.realpathSync("node_modules"),
    );
    assert.throws(
      () => prepareNext({ root: source, source, build: false }),
      /differ/,
    );
    fs.unlinkSync(path.join(root, ".env"));
    assert.throws(
      () => prepareNext({ root, source, build: false }),
      /Partial setup/,
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
