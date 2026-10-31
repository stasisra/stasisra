import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import Database from "better-sqlite3";
test("separate installation copies live WAL data, retains credentials and does not overwrite on retry", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-install-"));
  const source = path.join(temp, "task-gantt-app-fixed"),
    target = path.join(temp, "task-gantt-app-workspace");
  fs.mkdirSync(path.join(source, "prisma"), { recursive: true });
  fs.mkdirSync(path.join(target, "prisma"), { recursive: true });
  fs.writeFileSync(
    path.join(target, "package.json"),
    JSON.stringify({ name: "task-gantt-app" }),
  );
  fs.writeFileSync(
    path.join(source, ".env"),
    'DATABASE_URL="file:./current.db"\n',
  );
  const filename = path.join(source, "prisma", "current.db"),
    db = new Database(filename);
  try {
    db.pragma("journal_mode=WAL");
    db.exec(
      "CREATE TABLE User(id TEXT,name TEXT,email TEXT,passwordHash TEXT,role TEXT);CREATE TABLE Task(id TEXT,title TEXT);",
    );
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.prepare("INSERT INTO User VALUES(?,?,?,?,?)").run(
      "admin",
      "Admin",
      "admin@example.test",
      "synthetic-hash",
      "ADMIN",
    );
    db.prepare("INSERT INTO Task VALUES(?,?)").run(
      "current",
      "Актуальная задача в WAL",
    );
    const script = path.resolve("scripts/setup-workspace.cjs");
    execFileSync(process.execPath, [script, source], {
      cwd: target,
      stdio: "pipe",
    });
    const config = parseEnv(fs.readFileSync(path.join(target, ".env"), "utf8"));
    assert.equal(config.APP_URL, "http://127.0.0.1:3002");
    assert.equal(config.DATABASE_URL, "file:./dev.db");
    assert.ok(config.AUTH_JWT_SECRET && config.AUTH_JWT_SECRET.length >= 32);
    const copy = new Database(path.join(target, "prisma", "dev.db"));
    try {
      assert.equal(
        (
          copy
            .prepare("SELECT title FROM Task WHERE id=?")
            .get("current") as any
        ).title,
        "Актуальная задача в WAL",
      );
      assert.equal(
        (copy.prepare("SELECT passwordHash FROM User").get() as any)
          .passwordHash,
        "synthetic-hash",
      );
      copy
        .prepare("INSERT INTO Task VALUES(?,?)")
        .run("new", "Новая независимая задача");
    } finally {
      copy.close();
    }
    execFileSync(process.execPath, [script, source], {
      cwd: target,
      stdio: "pipe",
    });
    const again = new Database(path.join(target, "prisma", "dev.db"));
    assert.equal(
      (again.prepare("SELECT count(*) AS n FROM Task").get() as any).n,
      2,
    );
    again.close();
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM Task").get() as any).n,
      1,
    );
    assert.equal(
      parseEnv(fs.readFileSync(path.join(target, ".env"), "utf8"))
        .AUTH_JWT_SECRET,
      config.AUTH_JWT_SECRET,
    );
    fs.unlinkSync(path.join(target, ".env"));
    const failed = spawnSync(process.execPath, [script, source], {
      cwd: target,
      encoding: "utf8",
    });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Partial setup/);
    assert.ok(fs.existsSync(path.join(target, "prisma", "dev.db")));
  } finally {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
