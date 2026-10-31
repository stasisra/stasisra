import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(path.join(process.cwd(), "package.json"));
const { removeKozub, cleanDatabase } = require("./scripts/remove-kozub.cjs");
test("contact cleanup removes only Kozub and retains co-executors, tasks and history", () => {
  assert.equal(removeKozub("Козуб, Стас"), "Стас");
  assert.equal(removeKozub("КОЗУБ"), null);
  assert.equal(removeKozub("Козубова"), "Козубова");
  const db = new Database(":memory:");
  try {
    db.exec(
      `CREATE TABLE User(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE Task(id TEXT PRIMARY KEY,title TEXT,tags TEXT,executorName TEXT,responsibleName TEXT,updatedAt INTEGER);CREATE TABLE NamePolicy(id TEXT PRIMARY KEY,scope TEXT,field TEXT,value TEXT,hidden INTEGER,updatedAt INTEGER,UNIQUE(scope,field,value));CREATE TABLE TaskComment(body TEXT);`,
    );
    db.exec(
      `INSERT INTO User VALUES('admin','Admin');INSERT INTO Task VALUES('task','Позвонить Козубу','SP, козуб','Козуб, Стас','Козуб',1);INSERT INTO TaskComment VALUES('Исторический комментарий');INSERT INTO NamePolicy VALUES('one','GLOBAL','executorName','Козуб, Стас',0,1);INSERT INTO NamePolicy VALUES('two','GLOBAL','executorName','Стас',1,1);INSERT INTO NamePolicy VALUES('three','GLOBAL','tags','козуб',0,1);`,
    );
    assert.equal(cleanDatabase(db).tasksUpdated, 1);
    assert.equal(
      (db.prepare("SELECT executorName FROM Task").get() as any).executorName,
      "Козуб, Стас",
    );
    assert.equal(cleanDatabase(db, true).tasksUpdated, 1);
    assert.deepEqual(
      db
        .prepare("SELECT title,tags,executorName,responsibleName FROM Task")
        .get(),
      {
        title: "Позвонить Козубу",
        tags: "SP",
        executorName: "Стас",
        responsibleName: null,
      },
    );
    assert.equal(
      (db.prepare("SELECT count(*) as n FROM TaskComment").get() as any).n,
      1,
    );
    assert.deepEqual(db.prepare("SELECT value,hidden FROM NamePolicy").all(), [
      { value: "Стас", hidden: 1 },
    ]);
    assert.equal(cleanDatabase(db, true).tasksUpdated, 0);
    db.exec(`INSERT INTO User VALUES('person','Козуб');`);
    assert.throws(() => cleanDatabase(db, true), /учётных записей/);
  } finally {
    db.close();
  }
});
