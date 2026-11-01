import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import ExcelJS from "exceljs";
import {
  previewReview,
  stageImportFile,
  applyReview,
} from "../lib/product/import";
import { productSnapshot } from "../lib/product/service";
import type { SessionUser } from "../lib/session";
const { exportReview } = createRequire(path.resolve("package.json"))(
  "./scripts/export-review.cjs",
);
const user: SessionUser = {
  id: "admin",
  name: "Admin",
  email: "admin@example.test",
  role: "ADMIN",
};
function setup(file: string) {
  const db = new Database(file);
  db.pragma("foreign_keys=ON");
  for (const name of fs.readdirSync("prisma/migrations").sort()) {
    const file = path.join("prisma/migrations", name, "migration.sql");
    if (fs.existsSync(file)) db.exec(fs.readFileSync(file, "utf8"));
  }
  db.prepare(
    "INSERT INTO User(id,name,email,passwordHash,role) VALUES(?,?,?,?,?)",
  ).run(user.id, user.name, user.email, "synthetic", "ADMIN");
  return db;
}
test("reviewed Excel imports only kept records, retains children of removed parents and original files/notes, and repeats safely", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "product-import-")),
    app = path.join(temp, "app"),
    out = path.join(temp, "export");
  fs.mkdirSync(path.join(app, "prisma"), { recursive: true });
  fs.writeFileSync(
    path.join(app, "package.json"),
    JSON.stringify({ name: "task-gantt-app" }),
  );
  fs.symlinkSync(
    path.resolve("node_modules"),
    path.join(app, "node_modules"),
    "dir",
  );
  fs.writeFileSync(path.join(app, ".env"), 'DATABASE_URL="file:./source.db"');
  const source = setup(path.join(app, "prisma/source.db")),
    target = setup(":memory:");
  try {
    source
      .prepare(
        "INSERT INTO User(id,name,email,passwordHash,role) VALUES(?,?,?,?,?)",
      )
      .run(
        "old",
        "Исторический автор",
        "old@example.test",
        "synthetic-old",
        "USER",
      );
    source
      .prepare(
        "INSERT INTO Project(id,name,key,createdAt,updatedAt) VALUES(?,?,?,?,?)",
      )
      .run("sp", "SP", "sp", 1, 1);
    source
      .prepare(
        "INSERT INTO Contact(id,name,key,responsible,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
      )
      .run("patrick", "Патрик", "патрик", 1, 1, 1);
    for (const [id, parent, kind] of [
      ["meeting", null, "event"],
      ["remove", "meeting", "task"],
      ["keep", "remove", "task"],
    ] as const)
      source
        .prepare(
          "INSERT INTO Task(id,title,description,startDate,endDate,updatedAt,parentTaskId,projectId,kind,tags,responsibleContactId) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          id,
          "Описание " + id,
          Date.UTC(2026, 10, 1),
          Date.UTC(2026, 10, 10),
          1,
          parent,
          "sp",
          kind,
          "свой тег",
          "patrick",
        );
    source
      .prepare(
        "INSERT INTO TaskComment(id,taskId,authorId,body,createdAt) VALUES(?,?,?,?,?)",
      )
      .run("note", "keep", "old", "Сохранить обсуждение", 1);
    source
      .prepare(
        "INSERT INTO Attachment(id,taskId,name,type,size,data) VALUES(?,?,?,?,?,?)",
      )
      .run("file", "keep", "план.txt", "text/plain", 3, Buffer.from("abc"));
    await exportReview({ source: app, output: out });
    const data = fs.readFileSync(path.join(out, "data.json"), "utf8"),
      original = new ExcelJS.Workbook();
    await original.xlsx.readFile(path.join(out, "tasks-review.xlsx"));
    const sheet = original.getWorksheet("Отбор задач")!;
    let keptRow = 0;
    for (let i = 2; i <= sheet.rowCount; i++) {
      if (sheet.getCell(i, 23).value === "remove")
        sheet.getCell(i, 2).value = "Удалить";
      if (sheet.getCell(i, 23).value === "keep") keptRow = i;
    }
    let meetingRow = 0;
    sheet.eachRow((row, i) => {
      if (row.getCell(23).value === "meeting") meetingRow = i;
    });
    sheet.getCell(meetingRow, 6).value = keptRow - 1;
    await assert.rejects(
      previewReview(
        target,
        user,
        data,
        Buffer.from(await original.xlsx.writeBuffer()),
      ),
      /Цикл родителей/,
    );
    sheet.getCell(meetingRow, 6).value = "";
    const workbook = Buffer.from(await original.xlsx.writeBuffer()),
      preview = await previewReview(target, user, data, workbook);
    assert.equal(preview.kept, 2);
    assert.equal(productSnapshot(target, user).tasks.length, 0);
    assert.ok(preview.warnings.length);
    assert.throws(
      () => applyReview(target, user, preview.token!),
      /Не загружен файл/,
    );
    assert.equal(productSnapshot(target, user).tasks.length, 0);
    assert.throws(
      () =>
        stageImportFile(
          target,
          user,
          preview.token!,
          "file",
          Buffer.from("bad"),
        ),
      /не совпадает/,
    );
    stageImportFile(target, user, preview.token!, "file", Buffer.from("abc"));
    const result = applyReview(target, user, preview.token!),
      model = productSnapshot(target, user);
    assert.equal(result.kept, 2);
    assert.ok(!model.tasks.some((t) => t.id === "remove"));
    assert.equal(model.tasks.find((t) => t.id === "keep")!.parent, null);
    assert.equal(
      model.tasks.find((t) => t.id === "keep")!.responsible,
      "patrick",
    );
    assert.equal(
      model.tasks.find((t) => t.id === "keep")!.comments[0].author,
      "Исторический автор",
    );
    assert.equal(
      model.tasks.find((t) => t.id === "keep")!.attachments.length,
      1,
    );
    assert.equal(model.tasks.filter((t) => t.kind === "reference").length, 1);
    assert.equal(
      (source.prepare("SELECT count(*) AS n FROM Task").get() as any).n,
      3,
    );
    assert.equal(applyReview(target, user, preview.token!).kept, 2);
    assert.equal(
      (await previewReview(target, user, data, workbook)).completed,
      true,
    );
    assert.deepEqual(target.pragma("foreign_key_check"), []);
    sheet.getCell(keptRow, 2).value = "Удалить";
    await assert.rejects(
      previewReview(
        target,
        user,
        data,
        Buffer.from(await original.xlsx.writeBuffer()),
      ),
      /другим отбором/,
    );
    assert.equal(productSnapshot(target, user).tasks.length, 3);
    sheet.spliceRows(keptRow, 1);
    await assert.rejects(
      previewReview(
        target,
        user,
        data,
        Buffer.from(await original.xlsx.writeBuffer()),
      ),
      /удалены строки/,
    );
  } finally {
    source.close();
    target.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
