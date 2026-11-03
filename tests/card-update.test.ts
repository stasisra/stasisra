import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const { updateNext } = createRequire(import.meta.url)(
  "../scripts/update-next.cjs",
);
const sha = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "card-update-")),
    target = path.join(root, "installed"),
    source = path.join(root, "update");
  fs.mkdirSync(path.join(target, "prisma"), { recursive: true });
  fs.mkdirSync(path.join(source, "payload"), { recursive: true });
  fs.symlinkSync(
    path.resolve("node_modules"),
    path.join(target, "node_modules"),
    "dir",
  );
  fs.writeFileSync(
    path.join(target, "package.json"),
    '{"name":"task-gantt-app","version":"0.3.0"}',
  );
  fs.writeFileSync(
    path.join(target, ".env"),
    'DATABASE_URL="file:./dev.db"\nAPP_URL="http://127.0.0.1:3003"\nAUTH_JWT_SECRET="synthetic-update-secret-32-characters"',
  );
  fs.writeFileSync(path.join(target, ".next-setup-ready"), "0.3.0");
  fs.mkdirSync(path.join(target, ".next"));
  fs.writeFileSync(
    path.join(target, ".next/previous-build.txt"),
    "preserve build",
  );
  const db = new Database(path.join(target, "prisma/dev.db"));
  db.pragma("foreign_keys=ON");
  db.exec(
    "CREATE TABLE _prisma_migrations(id TEXT PRIMARY KEY,checksum TEXT NOT NULL,finished_at DATETIME,migration_name TEXT NOT NULL,logs TEXT,rolled_back_at DATETIME,started_at DATETIME NOT NULL,applied_steps_count INTEGER NOT NULL)",
  );
  for (const name of fs.readdirSync("prisma/migrations").sort()) {
    if (name === "20261103000100_contact_profiles") continue;
    const file = path.join("prisma/migrations", name, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");
    db.exec(sql);
    db.prepare(
      "INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES(?,?,?,?,?,1)",
    ).run(name, sha(sql), 1, name, 1);
  }
  db.prepare(
    "INSERT INTO User(id,name,email,passwordHash,role) VALUES('admin','Admin','admin@test.local','synthetic-hash','ADMIN')",
  ).run();
  db.prepare(
    "INSERT INTO Project(id,name,key,description,createdAt,updatedAt) VALUES('test','Тест системы','test','Сохранить описание',1,1)",
  ).run();
  db.prepare(
    "INSERT INTO ContentItem(id,kind,title,description,projectId,createdAt,updatedAt) VALUES('actual','task','Рабочая запись','Многострочное\nописание','test',1,1)",
  ).run();
  db.prepare(
    "INSERT INTO ContentNote(id,body,authorId,createdAt) VALUES('note','Сохранить комментарий','admin',1)",
  ).run();
  db.prepare(
    "INSERT INTO ItemNote(itemId,noteId) VALUES('actual','note')",
  ).run();
  db.prepare(
    "INSERT INTO ContentFile(id,name,type,size,data,sha256,createdAt) VALUES('file','data.bin','application/octet-stream',3,?, ?,1)",
  ).run(Buffer.from("abc"), sha("abc"));
  db.prepare(
    "INSERT INTO ItemFile(itemId,fileId) VALUES('actual','file')",
  ).run();
  db.close();
  const payload = new Map<string, Buffer>();
  for (const name of [
    "package.json",
    "package-lock.json",
    "next.config.mjs",
    "middleware.ts",
    "lib/session.ts",
    "public/workspace/app.js",
    "public/workspace/card-tools.js",
    "public/workspace/mentions.js",
    "workspace/index.html",
    "scripts/init-db.ts",
  ])
    payload.set(name, fs.readFileSync(name));
  for (const name of fs.readdirSync("prisma/migrations")) {
    const file = path.join("prisma/migrations", name, "migration.sql");
    if (fs.existsSync(file)) payload.set(file, fs.readFileSync(file));
  }
  for (const [name, bytes] of payload) {
    const file = path.join(source, "payload", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  fs.writeFileSync(
    path.join(source, "update-manifest.json"),
    JSON.stringify({
      format: "task-gantt-update/v1",
      version: "0.4.0",
      files: Object.fromEntries(
        [...payload].map(([name, b]) => [name, sha(b)]),
      ),
    }),
  );
  return { root, source, target };
}
function checkData(target: string) {
  const db = new Database(path.join(target, "prisma/dev.db"));
  try {
    assert.equal(
      (db.prepare("SELECT name FROM Project WHERE id='test'").get() as any)
        .name,
      "Тест системы",
    );
    assert.equal(
      (
        db
          .prepare("SELECT description FROM ContentItem WHERE id='actual'")
          .get() as any
      ).description,
      "Многострочное\nописание",
    );
    assert.equal(
      (db.prepare("SELECT body FROM ContentNote WHERE id='note'").get() as any)
        .body,
      "Сохранить комментарий",
    );
    assert.deepEqual(
      (db.prepare("SELECT data FROM ContentFile WHERE id='file'").get() as any)
        .data,
      Buffer.from("abc"),
    );
    assert.equal(
      (db.prepare("SELECT passwordHash FROM User").get() as any).passwordHash,
      "synthetic-hash",
    );
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    return db
      .prepare("SELECT 1 FROM WorkspaceMeta WHERE key='contact-profiles'")
      .get();
  } finally {
    db.close();
  }
}
test("installed 0.3 database upgrades with all existing records, settings and consistent backup intact", async () => {
  const f = fixture();
  try {
    const before = fs.readFileSync(path.join(f.target, ".env"));
    const result = await updateNext({ ...f, build: false });
    assert.ok(checkData(f.target));
    assert.deepEqual(fs.readFileSync(path.join(f.target, ".env")), before);
    assert.ok(fs.existsSync(path.join(result.backup, "database-before.db")));
    assert.equal(
      fs.readFileSync(
        path.join(result.backup, "previous-build/previous-build.txt"),
        "utf8",
      ),
      "preserve build",
    );
    assert.equal(
      fs.existsSync(path.join(f.target, ".next-update.lock")),
      false,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
test("failed update restores old schema, task/file data, code and build; invalid payload writes nothing", async () => {
  const f = fixture();
  try {
    const original = fs.readFileSync(path.join(f.target, "package.json"));
    await assert.rejects(
      updateNext({
        ...f,
        build: true,
        runCommand: (args: string[], options: any) => {
          if (args.includes("build"))
            throw Error("Synthetic migration/build failure");
          execFileSync(process.execPath, args, options);
          assert.ok(checkData(f.target));
        },
      }),
      /Synthetic/,
    );
    assert.equal(checkData(f.target), undefined);
    assert.deepEqual(
      fs.readFileSync(path.join(f.target, "package.json")),
      original,
    );
    assert.equal(
      fs.readFileSync(path.join(f.target, ".next/previous-build.txt"), "utf8"),
      "preserve build",
    );
    assert.equal(
      fs.readFileSync(path.join(f.target, ".next-setup-ready"), "utf8"),
      "0.3.0",
    );
    fs.appendFileSync(
      path.join(f.source, "payload/public/workspace/app.js"),
      "tampered",
    );
    await assert.rejects(updateNext({ ...f, build: false }), /checksum/);
    assert.equal(checkData(f.target), undefined);
    assert.deepEqual(
      fs.readFileSync(path.join(f.target, "package.json")),
      original,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
