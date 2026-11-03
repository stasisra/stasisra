import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { productAction, productSnapshot } from "../lib/product/service";
import { saveFile, unlinkFile } from "../lib/product/files";
import type { SessionUser } from "../lib/session";
const user: SessionUser = {
  id: "admin",
  name: "Admin",
  email: "admin@example.test",
  role: "ADMIN",
};
function fixture() {
  const db = new Database(":memory:");
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
const act = (
  db: Database.Database,
  action: string,
  data: Record<string, unknown>,
) => productAction(db, user, { action, data });
const create = (
  db: Database.Database,
  id: string,
  extra: Record<string, unknown> = {},
) => act(db, "createTask", { id, title: id, ...extra });
test("clean model has no fixed topics or tasks and supports nullable dates, free tags and independent roles", () => {
  const db = fixture();
  try {
    assert.equal(productSnapshot(db, user).tasks.length, 0);
    assert.equal(productSnapshot(db, user).projects.length, 0);
    act(db, "saveDirectory", {
      id: "sp",
      mode: "projects",
      name: "SP",
      description: "Описание проблематики",
    });
    act(db, "saveDirectory", {
      id: "patrick",
      mode: "contacts",
      name: "Патрик",
      responsible: true,
    });
    const model = create(db, "task", {
      project: "sp",
      counterparties: ["patrick"],
      executors: ["patrick"],
      responsible: "patrick",
      tags: ["Новый тег", "новый тег"],
    });
    const t = model.tasks[0];
    assert.equal(t.start, "");
    assert.equal(t.end, "");
    assert.deepEqual(t.counterparties, ["patrick"]);
    assert.equal(model.tags.length, 1);
    assert.equal(model.projects[0].description, "Описание проблематики");
    assert.ok(!JSON.stringify(model).includes("passwordHash"));
  } finally {
    db.close();
  }
});
test("events link several project tasks without changing hierarchy and questions have their own people", () => {
  const db = fixture();
  try {
    for (const id of ["sp", "vnz"])
      act(db, "saveDirectory", { id, mode: "projects", name: id });
    for (const id of ["patrick", "juraj"])
      act(db, "saveDirectory", {
        id,
        mode: "contacts",
        name: id,
        responsible: true,
      });
    create(db, "root", { project: "sp" });
    create(db, "child", { parent: "root", executors: ["patrick"] });
    create(db, "residence", { project: "vnz" });
    create(db, "event", {
      kind: "event",
      start: "2026-11-01",
      end: "2026-11-11",
    });
    act(db, "linkTasks", {
      activityId: "event",
      taskIds: ["child", "residence"],
      copyPeople: true,
      requestId: "link",
    });
    const model = act(db, "createTask", {
      id: "q",
      kind: "question",
      title: "Общий вопрос",
      activityId: "event",
      counterparties: ["juraj"],
      executors: ["juraj"],
      tags: ["свободный"],
    });
    assert.equal(model.tasks.find((t) => t.id === "child")!.parent, "root");
    assert.deepEqual(model.tasks.find((t) => t.id === "event")!.topics.sort(), [
      "sp",
      "vnz",
    ]);
    assert.deepEqual(model.tasks.find((t) => t.id === "q")!.executors, [
      "juraj",
    ]);
    assert.deepEqual(model.tasks.find((t) => t.id === "child")!.executors, [
      "patrick",
    ]);
    const refs = model.tasks.filter((t) => t.kind === "reference");
    assert.equal(refs.length, 2);
    assert.deepEqual(refs.find((t) => t.linkedTaskId === "child")!.executors, [
      "patrick",
    ]);
    assert.equal(
      act(db, "linkTasks", {
        activityId: "event",
        taskIds: ["child", "residence"],
        requestId: "link",
      }).tasks.filter((t) => t.kind === "reference").length,
      2,
    );
  } finally {
    db.close();
  }
});
test("branch moves, cycles and stale edits are transactional; failed dates keep prior data", () => {
  const db = fixture();
  try {
    for (const id of ["a", "b"])
      act(db, "saveDirectory", { id, mode: "projects", name: id });
    create(db, "root", { project: "a" });
    create(db, "child", { parent: "root" });
    assert.throws(
      () =>
        act(db, "saveTask", {
          id: "root",
          title: "cycle",
          kind: "task",
          parent: "child",
          revision: 0,
        }),
      /цикл/,
    );
    const moved = act(db, "saveTask", {
      id: "root",
      title: "root",
      project: "b",
      revision: 0,
    });
    assert.equal(moved.tasks.find((t) => t.id === "child")!.project, "b");
    assert.throws(
      () => act(db, "saveTask", { id: "root", title: "stale", revision: 0 }),
      /другом окне/,
    );
    assert.throws(
      () => create(db, "bad", { start: "2026-11-10", end: "2026-11-01" }),
      /раньше/,
    );
    assert.ok(!productSnapshot(db, user).tasks.some((t) => t.id === "bad"));
  } finally {
    db.close();
  }
});
test("promotion retains nested content, one file original and notes in both task and event context", () => {
  const db = fixture();
  try {
    act(db, "saveDirectory", { id: "sp", mode: "projects", name: "SP" });
    create(db, "event", { kind: "event" });
    create(db, "prep", {
      kind: "preparation",
      activityId: "event",
      description: "Подготовить",
    });
    create(db, "child", {
      kind: "question",
      activityId: "event",
      parent: "prep",
    });
    act(db, "addNote", {
      id: "note",
      taskId: "prep",
      text: "Сохранить историю",
      kind: "question",
    });
    saveFile(db, "prep", {
      id: "file",
      name: "план.txt",
      type: "text/plain",
      data: Buffer.from("Материал"),
    });
    const model = act(db, "promoteItem", {
        id: "prep",
        revision: 0,
        project: "sp",
      }),
      task = model.tasks.find((t) => t.id === "prep")!,
      child = model.tasks.find((t) => t.id === "child")!,
      ref = model.tasks.find(
        (t) => t.kind === "reference" && t.linkedTaskId === "prep",
      )!;
    assert.equal(task.kind, "task");
    assert.equal(task.project, "sp");
    assert.equal(child.parent, "prep");
    assert.equal(child.kind, "task");
    assert.equal(ref.attachments.length, 1);
    assert.equal(ref.comments.length, 1);
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM ContentFile").get() as any).n,
      1,
    );
    unlinkFile(db, ref.id, "file");
    assert.equal(
      productSnapshot(db, user).tasks.find((t) => t.id === "prep")!.attachments
        .length,
      1,
    );
    act(db, "deleteTask", { id: "event", revision: 0 });
    assert.equal(
      productSnapshot(db, user).tasks.find((t) => t.id === "prep")!.attachments
        .length,
      1,
    );
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
  }
});
test("file and create retries deduplicate, while a changed create payload conflicts", () => {
  const db = fixture();
  try {
    create(db, "task");
    create(db, "task");
    assert.equal(productSnapshot(db, user).tasks.length, 1);
    assert.throws(
      () => create(db, "task", { title: "changed" }),
      /уже создана/,
    );
    saveFile(db, "task", {
      id: "f",
      name: "a.txt",
      type: "text/plain",
      data: Buffer.from("a"),
    });
    saveFile(db, "task", {
      id: "f",
      name: "a.txt",
      type: "text/plain",
      data: Buffer.from("a"),
    });
    assert.throws(
      () =>
        saveFile(db, "task", {
          id: "f",
          name: "a.txt",
          type: "text/plain",
          data: Buffer.from("b"),
        }),
      /уже используется/,
    );
    assert.equal(productSnapshot(db, user).tasks[0].attachments.length, 1);
  } finally {
    db.close();
  }
});

test("nested events aggregate topics and roles, and agenda moves keep descendants in one activity", () => {
  const db = fixture();
  try {
    act(db, "saveDirectory", { id: "sp", mode: "projects", name: "SP" });
    act(db, "saveDirectory", { id: "juraj", mode: "contacts", name: "Юрай" });
    create(db, "work", { project: "sp" });
    create(db, "trip", { kind: "event" });
    create(db, "meeting", { kind: "event", parent: "trip" });
    act(db, "linkTasks", {
      activityId: "meeting",
      taskIds: ["work"],
      requestId: "one",
    });
    assert.throws(
      () =>
        act(db, "linkTasks", {
          activityId: "trip",
          taskIds: ["work"],
          requestId: "one",
        }),
      /другого мероприятия/,
    );
    create(db, "q", {
      kind: "question",
      activityId: "meeting",
      counterparties: ["juraj"],
    });
    create(db, "nested", {
      kind: "preparation",
      activityId: "meeting",
      parent: "q",
    });
    let model = productSnapshot(db, user);
    assert.deepEqual(model.tasks.find((t) => t.id === "trip")!.topics, ["sp"]);
    assert.deepEqual(
      (model.tasks.find((t) => t.id === "trip") as any).rolePeople.counterparty,
      ["juraj"],
    );
    const q = model.tasks.find((t) => t.id === "q")!;
    model = act(db, "saveTask", { ...q, parent: null, activityId: "trip" });
    assert.equal(
      model.tasks.find((t) => t.id === "nested")!.activityId,
      "trip",
    );
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
  }
});

test("agenda ordering persists without changing ownership and stale reorder is rejected", () => {
  const db = fixture();
  try {
    create(db, "event", { kind: "event" });
    create(db, "first", { kind: "question", activityId: "event" });
    create(db, "second", { kind: "note", activityId: "event" });
    const ordered = act(db, "moveItem", {
      id: "second",
      revision: 0,
      direction: -1,
    });
    assert.deepEqual(
      ordered.tasks.filter((t) => t.activityId === "event").map((t) => t.id),
      ["second", "first"],
    );
    assert.throws(
      () => act(db, "moveItem", { id: "second", revision: 0, direction: 1 }),
      /другом окне/,
    );
    create(db, "third", { kind: "preparation", activityId: "event" });
    assert.deepEqual(
      productSnapshot(db, user)
        .tasks.filter((t) => t.activityId === "event")
        .map((t) => t.id),
      ["second", "first", "third"],
    );
  } finally {
    db.close();
  }
});

test("linking a branch retains the working subtask structure inside the agenda without moving originals", () => {
  const db = fixture();
  try {
    create(db, "root");
    create(db, "child", { parent: "root" });
    create(db, "grandchild", { parent: "child" });
    create(db, "event", { kind: "event" });
    const model = act(db, "linkTasks", {
      activityId: "event",
      taskIds: ["child", "root"],
      includeChildren: true,
      requestId: "branch",
    });
    const refs = model.tasks.filter((t) => t.kind === "reference"),
      a = refs.find((t) => t.linkedTaskId === "root")!,
      b = refs.find((t) => t.linkedTaskId === "child")!,
      c = refs.find((t) => t.linkedTaskId === "grandchild")!;
    assert.equal(refs.length, 3);
    assert.equal(b.parent, a.id);
    assert.equal(c.parent, b.id);
    assert.equal(model.tasks.find((t) => t.id === "child")!.parent, "root");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
  }
});

test("contact profiles retain fields across old-style updates, derive topics and merge links transactionally", () => {
  const db = fixture();
  try {
    for (const id of ["sp", "vnz"])
      act(db, "saveDirectory", { id, mode: "projects", name: id });
    act(db, "saveDirectory", {
      id: "profile",
      mode: "contacts",
      name: "Contact",
      phones: "+421 123",
      emails: "contact@example.test",
      addresses: "Address",
      company: "Org",
      topics: ["sp"],
      responsible: true,
    });
    create(db, "task", {
      project: "vnz",
      counterparties: ["profile"],
      description: "Уточнить @[Contact](contact:profile)",
    });
    let model = productSnapshot(db, user),
      contact = model.contacts.find((c) => c.id === "profile")!;
    assert.deepEqual(contact.topics.sort(), ["sp", "vnz"]);
    assert.equal(contact.phones, "+421 123");
    act(db, "saveDirectory", {
      id: "profile",
      mode: "contacts",
      name: "Renamed",
      responsible: true,
      revision: contact.revision,
    });
    contact = productSnapshot(db, user).contacts.find(
      (c) => c.id === "profile",
    )!;
    assert.equal(contact.emails, "contact@example.test");
    assert.deepEqual(contact.manualTopics, ["sp"]);
    assert.throws(
      () =>
        act(db, "saveDirectory", {
          id: "profile",
          mode: "contacts",
          name: "bad",
          phones: "lost",
          topics: ["missing"],
          revision: contact.revision,
        }),
      /не найдена/,
    );
    assert.equal(
      productSnapshot(db, user).contacts.find((c) => c.id === "profile")!
        .phones,
      "+421 123",
    );
    act(db, "saveDirectory", {
      id: "other",
      mode: "contacts",
      name: "Other",
      emails: "keep@example.test",
      topics: ["vnz"],
      responsible: true,
    });
    act(db, "removeDirectory", {
      id: "profile",
      mode: "contacts",
      revision: contact.revision,
      replacement: "other",
    });
    model = productSnapshot(db, user);
    contact = model.contacts.find((c) => c.id === "other")!;
    assert.equal(
      model.tasks.find((t) => t.id === "task")!.description,
      "Уточнить @[Contact](contact:other)",
    );
    assert.equal(contact.phones, "+421 123");
    assert.equal(contact.emails, "keep@example.test");
    assert.deepEqual(contact.manualTopics.sort(), ["sp", "vnz"]);
    assert.deepEqual(model.tasks.find((t) => t.id === "task")!.counterparties, [
      "other",
    ]);
    const sp = model.projects.find((p) => p.id === "sp")!;
    act(db, "removeDirectory", {
      id: "sp",
      mode: "projects",
      revision: sp.revision,
      replacement: "vnz",
    });
    assert.deepEqual(
      productSnapshot(db, user).contacts.find((c) => c.id === "other")!
        .manualTopics,
      ["vnz"],
    );
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
  }
});
