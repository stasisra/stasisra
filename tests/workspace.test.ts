import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { migrateWorkspace } from "../lib/workspace/migrate";
import { workspaceAction, workspaceSnapshot } from "../lib/workspace/service";
import type { SessionUser } from "../lib/session";
const session: SessionUser = {
  id: "admin",
  name: "Admin",
  email: "admin@example.test",
  role: "ADMIN",
};
function fixture(migrate = true) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  for (const name of fs.readdirSync("prisma/migrations").sort()) {
    const file = path.join("prisma/migrations", name, "migration.sql");
    if (fs.existsSync(file)) db.exec(fs.readFileSync(file, "utf8"));
  }
  db.prepare(
    "INSERT INTO User(id,name,email,passwordHash,role) VALUES(?,?,?,?,?)",
  ).run(session.id, session.name, session.email, "synthetic", "ADMIN");
  if (migrate) migrateWorkspace(db);
  return db;
}
const act = (
  db: Database.Database,
  action: string,
  data: Record<string, unknown>,
) => workspaceAction(db, session, { action, data });
function taskData(extra: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    title: "Рабочая задача",
    description: "Описание",
    start: "2026-11-01",
    end: "2026-11-10",
    project: "",
    parent: null,
    executors: [],
    responsible: "",
    percent: 0,
    status: "PLANNED",
    kind: "task",
    revision: 0,
    ...extra,
  };
}
test("legacy classification retains every task, comment and attachment, creates real groups once and resolves known aliases", () => {
  const db = fixture(false);
  try {
    const add = (
      id: string,
      title: string,
      tags: string,
      parent: string | null = null,
      executor = "Козуб, Стас",
      responsible = "Admin",
    ) =>
      db
        .prepare(
          "INSERT INTO Task(id,title,description,startDate,endDate,updatedAt,tags,parentTaskId,executorName,responsibleName) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          title,
          "Сохранить описание",
          Date.UTC(2026, 10, 1),
          Date.UTC(2026, 10, 10),
          Date.now(),
          tags,
          parent,
          executor,
          responsible,
        );
    add("meeting", "Встречи 1–10 ноября", "SP,Патрик,меликантова");
    add("child", "Позвонить", "SP,Патрик", "meeting");
    add("web1", "Структура", "web,ТЗ сайт", null, "Beeli", "");
    add(
      "web2",
      "Макет",
      "web,ТЗ сайт,Наташа дизайнер",
      null,
      "Наташа архитектор",
      "",
    );
    add("unclear", "Проверить темы", "SP,ВНЖ");
    db.prepare(
      "INSERT INTO TaskComment(id,body,taskId,authorId) VALUES(?,?,?,?)",
    ).run("old-note", "Козуб в историческом тексте", "child", "admin");
    const bytes = Buffer.from("keep attachment");
    db.prepare(
      "INSERT INTO Attachment(id,taskId,name,type,size,data) VALUES(?,?,?,?,?,?)",
    ).run("old-file", "child", "keep.txt", "text/plain", bytes.length, bytes);
    const report = migrateWorkspace(db);
    assert.equal(report.tasks, 5);
    assert.equal(report.createdParents, 1);
    const data = workspaceSnapshot(db, session);
    assert.equal(data.tasks.length, 6);
    assert.equal(
      data.contacts.filter((c) => c.name === "Наташа архитектор").length,
      1,
    );
    assert.equal(
      data.contacts.some((c) => /козуб/i.test(c.name)),
      false,
    );
    assert.equal(
      data.contacts.some((c) => c.name === "Юрист"),
      true,
    );
    assert.equal(
      data.contacts.some((c) => c.name === "Юрай" && c.responsible),
      true,
    );
    const child = data.tasks.find((t) => t.id === "child")!;
    assert.equal(child.parent, "meeting");
    assert.equal(
      data.contacts.find((c) => c.id === child.responsible)!.name,
      "Патрик",
    );
    assert(
      child.executors.some(
        (id) => data.contacts.find((c) => c.id === id)?.name === "Стас",
      ),
    );
    assert.equal(child.comments[0].text, "Козуб в историческом тексте");
    assert.equal(child.attachments[0].name, "keep.txt");
    assert.equal("data" in child.attachments[0], false);
    assert.deepEqual(
      (
        db
          .prepare("SELECT data FROM Attachment WHERE id=?")
          .get("old-file") as { data: Buffer }
      ).data,
      bytes,
    );
    const webParent = data.tasks.find((t) => t.title === "ТЗ сайт")!;
    assert.equal(data.tasks.find((t) => t.id === "web1")!.parent, webParent.id);
    assert.equal(data.tasks.find((t) => t.id === "web2")!.parent, webParent.id);
    assert.equal(data.tasks.find((t) => t.id === "unclear")!.project, "");
    assert(report.issues.some((i) => i.taskId === "unclear"));
    const before = JSON.stringify(data);
    assert.deepEqual(migrateWorkspace(db), report);
    assert.equal(JSON.stringify(workspaceSnapshot(db, session)), before);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
  }
});
test("fresh workspace contains no demonstration tasks, and migration grouping respects existing branches", () => {
  const db = fixture();
  try {
    const data = workspaceSnapshot(db, session);
    assert.equal(data.tasks.length, 0);
    assert.equal(data.projects.length, 16);
    assert(data.contacts.length >= 11);
    assert.equal(
      data.contacts.some((c) => /козуб|наташа дизайнер/i.test(c.name)),
      false,
    );
  } finally {
    db.close();
  }
});
test("server enforces hierarchy, dates, multi-executor identity, branch moves and optimistic revisions", () => {
  const db = fixture();
  try {
    let data = workspaceSnapshot(db, session);
    const project = data.projects[0].id,
      other = data.projects[1].id,
      contact = data.contacts.find((c) => c.responsible)!;
    const parent = taskData({
        project,
        executors: [contact.id, contact.id],
        responsible: contact.id,
      }),
      child = taskData({ parent: parent.id, project: other });
    act(db, "createTask", parent);
    data = act(db, "createTask", child);
    assert.equal(data.tasks.find((t) => t.id === child.id)!.project, project);
    assert.deepEqual(data.tasks.find((t) => t.id === parent.id)!.executors, [
      contact.id,
    ]);
    assert.throws(
      () => act(db, "saveTask", { ...parent, parent: child.id }),
      /цикл/,
    );
    assert.throws(
      () => act(db, "createTask", taskData({ start: "2026-02-30" })),
      /дата/,
    );
    assert.throws(
      () =>
        act(
          db,
          "createTask",
          taskData({ start: "2026-11-11", end: "2026-11-01" }),
        ),
      /раньше/,
    );
    data = act(db, "saveTask", {
      ...parent,
      project: other,
      title: "Новая версия",
    });
    assert.equal(data.tasks.find((t) => t.id === child.id)!.project, other);
    assert.equal(data.tasks.find((t) => t.id === parent.id)!.revision, 1);
    assert.throws(
      () =>
        act(db, "saveTask", {
          ...parent,
          title: "Перезаписать старой версией",
        }),
      /другом окне/,
    );
    assert.equal(
      workspaceSnapshot(db, session).tasks.find((t) => t.id === parent.id)!
        .title,
      "Новая версия",
    );
    assert.throws(
      () =>
        act(
          db,
          "createTask",
          taskData({
            kind: "event",
            start: "2026-11-01",
            end: "2026-11-01",
            startTime: "16:00",
            endTime: "15:00",
          }),
        ),
      /Время/,
    );
    assert.throws(
      () => act(db, "createTask", taskData({ timeZone: "not-a-zone" })),
      /часовой пояс/,
    );
  } finally {
    db.close();
  }
});
test("create and notes retry without duplicates; changed payloads cannot masquerade as an earlier create", () => {
  const db = fixture();
  try {
    const task = taskData(),
      note = { id: randomUUID(), kind: "question", text: "Вопрос" };
    const create = { ...task, comments: [note] };
    act(db, "createTask", create);
    act(db, "createTask", create);
    let data = workspaceSnapshot(db, session);
    assert.equal(data.tasks.length, 1);
    assert.equal(data.tasks[0].comments.length, 1);
    assert.throws(
      () => act(db, "createTask", { ...create, percent: 70 }),
      /черновик изменился/,
    );
    const next = {
      id: randomUUID(),
      kind: "comment",
      text: "Комментарий",
      taskId: task.id,
    };
    act(db, "addNote", next);
    act(db, "addNote", next);
    assert.throws(
      () => act(db, "addNote", { ...next, text: "Другое содержимое" }),
      /занят/,
    );
    data = workspaceSnapshot(db, session);
    assert.equal(data.tasks[0].comments.length, 2);
    act(db, "resolveNote", { id: note.id, resolved: true, revision: 0 });
    act(db, "resolveNote", { id: note.id, resolved: true, revision: 0 });
    assert.equal(
      workspaceSnapshot(db, session).tasks[0].comments[0].resolved,
      true,
    );
  } finally {
    db.close();
  }
});
test("directory edits and replacement preserve tasks, notes, attachments and shared roles", () => {
  const db = fixture();
  try {
    let data = workspaceSnapshot(db, session);
    const first = data.contacts.find((c) => c.responsible)!,
      second = data.contacts.find((c) => c.responsible && c.id !== first.id)!,
      project = data.projects[0],
      replacement = data.projects[1];
    const task = taskData({
      project: project.id,
      responsible: first.id,
      executors: [first.id, second.id],
    });
    act(db, "createTask", task);
    act(db, "addNote", {
      id: "note",
      taskId: task.id,
      text: "Keep",
      kind: "comment",
    });
    assert.throws(
      () =>
        act(db, "saveDirectory", {
          id: first.id,
          mode: "contacts",
          name: "Неприменённое имя",
          type: first.type,
          responsible: false,
          revision: 0,
        }),
      /назначения/,
    );
    assert.equal(
      workspaceSnapshot(db, session).contacts.find((c) => c.id === first.id)!
        .name,
      first.name,
    );
    data = act(db, "saveDirectory", {
      id: first.id,
      mode: "contacts",
      name: "Изменённое имя",
      type: first.type,
      responsible: true,
      revision: 0,
    });
    assert.equal(data.tasks[0].responsible, first.id);
    assert.equal(data.contacts.filter((c) => c.id === first.id).length, 1);
    assert.throws(
      () =>
        act(db, "hideDirectory", {
          id: first.id,
          mode: "contacts",
          archived: true,
          revision: 0,
        }),
      /другом окне/,
    );
    data = act(db, "removeDirectory", {
      id: first.id,
      mode: "contacts",
      replacement: second.id,
      revision: 1,
    });
    assert.deepEqual(data.tasks[0].executors, [second.id]);
    assert.equal(data.tasks[0].responsible, second.id);
    assert.equal(data.tasks[0].comments[0].text, "Keep");
    assert.equal(data.tasks.length, 1);
    data = act(db, "removeDirectory", {
      id: project.id,
      mode: "projects",
      replacement: replacement.id,
      revision: 0,
    });
    assert.equal(data.tasks[0].project, replacement.id);
    assert.equal(data.tasks.length, 1);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
  }
});
test("deleting one task reparents children and preserves their content; transaction failure rolls back", () => {
  const db = fixture();
  try {
    const root = taskData(),
      child = taskData({ parent: root.id });
    act(db, "createTask", root);
    act(db, "createTask", child);
    act(db, "addNote", {
      id: "child-note",
      taskId: child.id,
      text: "Child history",
      kind: "question",
    });
    const count = workspaceSnapshot(db, session).tasks.length;
    assert.throws(
      () => act(db, "createTask", taskData({ executors: ["missing-contact"] })),
      /не найдена/,
    );
    assert.equal(workspaceSnapshot(db, session).tasks.length, count);
    let data = act(db, "deleteTask", { id: root.id, revision: 0 });
    assert.equal(data.tasks.length, 1);
    assert.equal(data.tasks[0].id, child.id);
    assert.equal(data.tasks[0].parent, null);
    assert.equal(data.tasks[0].comments[0].text, "Child history");
    data = act(db, "deleteTask", { id: root.id, revision: 0 });
    assert.equal(data.tasks.length, 1);
  } finally {
    db.close();
  }
});

test("migration repairs the actual cyclic edge without detaching tasks leading into it", () => {
  const db = fixture(false);
  try {
    for (const [id, order] of [
      ["tail", 0],
      ["a", 1],
      ["b", 2],
    ] as const)
      db.prepare(
        "INSERT INTO Task(id,title,startDate,endDate,updatedAt,sortOrder,tags) VALUES(?,?,1,2,1,?,'SP')",
      ).run(id, id, order);
    for (const [id, parent] of [
      ["tail", "a"],
      ["a", "b"],
      ["b", "a"],
    ])
      db.prepare("UPDATE Task SET parentTaskId=? WHERE id=?").run(parent, id);
    migrateWorkspace(db);
    const model = workspaceSnapshot(db, session);
    assert.equal(model.tasks.length, 3);
    assert.equal(model.tasks.find((t) => t.id === "tail")!.parent, "a");
    assert.equal(model.tasks.find((t) => t.id === "a")!.parent, "b");
    assert.equal(model.tasks.find((t) => t.id === "b")!.parent, null);
  } finally {
    db.close();
  }
});
