import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import ExcelJS from "exceljs";
const { exportReview } = createRequire(path.resolve("package.json"))(
  "./scripts/export-review.cjs",
);
test("review Excel exports a consistent live WAL snapshot with complete texts, identities, comments and files without credentials", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "review-export-")),
    source = path.join(temp, "app"),
    output = path.join(temp, "export");
  fs.mkdirSync(path.join(source, "prisma"), { recursive: true });
  fs.writeFileSync(
    path.join(source, "package.json"),
    JSON.stringify({ name: "task-gantt-app" }),
  );
  fs.symlinkSync(
    path.resolve("node_modules"),
    path.join(source, "node_modules"),
    "dir",
  );
  fs.writeFileSync(
    path.join(source, ".env"),
    'DATABASE_URL="file:./source.db"\nAUTH_JWT_SECRET="synthetic-secret-not-to-export"\n',
  );
  const db = new Database(path.join(source, "prisma/source.db"));
  try {
    db.pragma("foreign_keys=ON");
    db.pragma("journal_mode=WAL");
    for (const name of fs.readdirSync("prisma/migrations").sort()) {
      const file = path.join("prisma/migrations", name, "migration.sql");
      if (fs.existsSync(file)) db.exec(fs.readFileSync(file, "utf8"));
    }
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.prepare(
      "INSERT INTO User(id,name,email,passwordHash,role) VALUES(?,?,?,?,?)",
    ).run(
      "admin",
      "Admin",
      "test@example.test",
      "synthetic-password-hash-not-to-export",
      "ADMIN",
    );
    db.prepare(
      "INSERT INTO Project(id,name,key,createdAt,updatedAt) VALUES(?,?,?,?,?)",
    ).run("sp", "SP", "sp", 1, 1);
    db.prepare(
      "INSERT INTO Contact(id,name,key,responsible,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
    ).run("patrick", "Патрик", "патрик", 1, 1, 1);
    db.prepare(
      "INSERT INTO Task(id,title,description,startDate,endDate,updatedAt,parentTaskId,projectId,responsibleContactId,tags,legacyTags) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "parent",
      "Встречи 1–11",
      "Родитель",
      1,
      2,
      1,
      null,
      "sp",
      "patrick",
      "текущий",
      "SP,Патрик",
    );
    const long = "Полное описание\n".repeat(3000);
    db.prepare(
      "INSERT INTO Task(id,title,description,startDate,endDate,updatedAt,parentTaskId,projectId) VALUES(?,?,?,?,?,?,?,?)",
    ).run("child", "=Не формула", long, 1, 2, 1, "parent", "sp");
    db.prepare("INSERT INTO TaskExecutor(taskId,contactId) VALUES(?,?)").run(
      "child",
      "patrick",
    );
    db.prepare(
      "INSERT INTO TaskComment(id,taskId,authorId,body,createdAt,kind) VALUES(?,?,?,?,?,?)",
    ).run("comment", "child", "admin", "Вопрос\nВторая строка", 1, "question");
    db.prepare(
      "INSERT INTO Attachment(id,taskId,name,type,size,data) VALUES(?,?,?,?,?,?)",
    ).run(
      "file",
      "child",
      "план.xlsx",
      "application/octet-stream",
      3,
      Buffer.from([1, 2, 3]),
    );
    const result = await exportReview({ source, output });
    assert.equal(result.tasks, 2);
    const json = fs.readFileSync(path.join(output, "data.json"), "utf8");
    assert.ok(!json.includes("synthetic-password-hash"));
    assert.ok(!json.includes("synthetic-secret"));
    const data = JSON.parse(json);
    assert.equal(
      data.records.Task.find((t: any) => t.id === "child").description,
      long,
    );
    assert.equal(data.records.Attachment.length, 1);
    assert.deepEqual(
      fs.readFileSync(path.join(output, data.records.Attachment[0].relative)),
      Buffer.from([1, 2, 3]),
    );
    const copied = new Database(path.join(output, "database-full.db"), {
      readonly: true,
    });
    assert.equal(
      (copied.prepare("SELECT count(*) AS n FROM Task").get() as any).n,
      2,
    );
    copied.close();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(output, "tasks-review.xlsx"));
    const sheet = workbook.getWorksheet("Отбор задач")!;
    assert.equal(sheet.rowCount, 3);
    assert.equal(sheet.getCell("B2").value, "Оставить");
    assert.equal(sheet.getCell("K3").value, 1);
    assert.equal(sheet.getCell("H3").type, ExcelJS.ValueType.String);
    assert.equal(sheet.getCell("W3").value, "child");
    assert.equal(sheet.getCell("M3").value, "Патрик");
    assert.ok(workbook.getWorksheet("Полные тексты")!.rowCount > 1);
    assert.equal(
      workbook.getWorksheet("_meta")!.getCell("B2").value,
      data.snapshotId,
    );
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM Task").get() as any).n,
      2,
    );
    assert.ok(!fs.existsSync(output + ".partial"));
  } finally {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
