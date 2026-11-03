import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { dateOnly } from "../dates";
import {
  cleanName,
  nameKey,
  touch,
  WorkspaceError,
} from "../workspace/database";
import type { SessionUser } from "../session";
export type Row = Record<string, any>;
export const ID = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const kinds = z.enum([
  "task",
  "event",
  "preparation",
  "question",
  "note",
  "reference",
]);
const calendar = z
  .string()
  .refine(
    (value) => !value || dateOnly(value) !== null,
    "Некорректная календарная дата",
  )
  .nullable()
  .optional();
const input = z.object({
  id: ID,
  title: z.string().trim().max(1000).default(""),
  description: z.string().max(100000).default(""),
  outcome: z.string().max(100000).default(""),
  kind: kinds.default("task"),
  project: z.string().max(100).default(""),
  parent: z.string().max(100).nullable().default(null),
  activityId: z.string().max(100).nullable().default(null),
  linkedTaskId: z.string().max(100).nullable().default(null),
  originItemId: z.string().max(100).nullable().default(null),
  topics: z.array(ID).max(100).default([]),
  counterparties: z.array(ID).max(200).default([]),
  executors: z.array(ID).max(200).default([]),
  responsible: z.string().max(100).default(""),
  tags: z
    .array(z.string().transform(cleanName).pipe(z.string().min(1).max(200)))
    .max(100)
    .default([]),
  start: calendar,
  end: calendar,
  startTime: z
    .string()
    .regex(/^(|[01]\d:[0-5]\d|2[0-3]:[0-5]\d)$/)
    .default(""),
  endTime: z
    .string()
    .regex(/^(|[01]\d:[0-5]\d|2[0-3]:[0-5]\d)$/)
    .default(""),
  location: z.string().max(2000).default(""),
  timeZone: z.string().max(100).default("Asia/Jerusalem"),
  status: z
    .enum(["PLANNED", "IN_PROGRESS", "PAUSED", "DONE", "CANCELLED"])
    .default("PLANNED"),
  percent: z.number().int().min(0).max(100).default(0),
  revision: z.number().int().min(0).default(0),
  comments: z
    .array(
      z.object({
        id: ID,
        text: z.string().trim().min(1).max(100000),
        kind: z.enum(["comment", "question"]),
      }),
    )
    .max(100)
    .default([]),
});
export function getRow(
  db: Database.Database,
  table: "ContentItem" | "Project" | "Contact" | "Tag" | "ContentNote",
  id: string,
) {
  return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as
    Row | undefined;
}
export function need(
  db: Database.Database,
  table: "ContentItem" | "Project" | "Contact" | "Tag" | "ContentNote",
  id: string,
) {
  const row = getRow(db, table, id);
  if (!row)
    throw new WorkspaceError("Запись не найдена. Обновите данные.", 404);
  return row;
}
export function checkRevision(row: Row, expected: unknown) {
  if (row.revision !== expected)
    throw new WorkspaceError(
      "Запись изменена в другом окне. Загрузите актуальную карточку; ваш черновик остаётся в форме.",
      409,
    );
}
function zone(value: string) {
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: value }).format();
  } catch {
    throw new WorkspaceError("Неизвестный часовой пояс");
  }
  return value;
}
export function branch(db: Database.Database, id: string) {
  return (
    db
      .prepare(
        "WITH RECURSIVE tree(id) AS (SELECT ? UNION SELECT c.id FROM ContentItem c JOIN tree p ON c.parentId=p.id) SELECT id FROM tree",
      )
      .all(id) as { id: string }[]
  ).map((r) => r.id);
}
export function isAgenda(kind: string) {
  return !["task", "event"].includes(kind);
}
function setPeople(db: Database.Database, id: string, data: Row) {
  const roles = {
    counterparty: [...new Set(data.counterparties)],
    executor: [...new Set(data.executors)],
    responsible: data.responsible ? [data.responsible] : [],
  };
  for (const [role, ids] of Object.entries(roles))
    for (const contactId of ids as string[]) {
      const c = need(db, "Contact", contactId);
      const current = db
        .prepare(
          "SELECT 1 FROM ItemContact WHERE itemId=? AND contactId=? AND role=?",
        )
        .get(id, contactId, role);
      if (
        (c.archived || (role === "responsible" && !c.responsible)) &&
        !current
      )
        throw new WorkspaceError(
          "Контакт скрыт или не доступен для назначения ответственным.",
        );
    }
  db.prepare("DELETE FROM ItemContact WHERE itemId=?").run(id);
  for (const [role, ids] of Object.entries(roles))
    for (const contactId of ids as string[])
      db.prepare(
        "INSERT INTO ItemContact(itemId,contactId,role) VALUES(?,?,?)",
      ).run(id, contactId, role);
}
export function setTags(db: Database.Database, id: string, names: string[]) {
  const ids: string[] = [];
  for (const name of names) {
    let tag = db.prepare("SELECT * FROM Tag WHERE key=?").get(nameKey(name)) as
      Row | undefined;
    if (!tag) {
      tag = { id: randomUUID(), name, key: nameKey(name) };
      db.prepare(
        "INSERT INTO Tag(id,name,key,createdAt,updatedAt) VALUES(?,?,?,?,?)",
      ).run(tag.id, tag.name, tag.key, Date.now(), Date.now());
    }
    if (
      tag.archived &&
      !db
        .prepare("SELECT 1 FROM ItemTag WHERE itemId=? AND tagId=?")
        .get(id, tag.id)
    )
      throw new WorkspaceError("Тег скрыт. Верните его в справочнике.");
    ids.push(tag.id);
  }
  db.prepare("DELETE FROM ItemTag WHERE itemId=?").run(id);
  for (const tagId of new Set(ids))
    db.prepare("INSERT INTO ItemTag(itemId,tagId) VALUES(?,?)").run(id, tagId);
}
export function insertNote(
  db: Database.Database,
  user: SessionUser,
  itemId: string,
  note: { id: string; text: string; kind: string },
) {
  const existing = getRow(db, "ContentNote", note.id);
  if (existing) {
    if (
      existing.body !== note.text ||
      existing.kind !== note.kind ||
      !db
        .prepare("SELECT 1 FROM ItemNote WHERE itemId=? AND noteId=?")
        .get(itemId, note.id)
    )
      throw new WorkspaceError("Идентификатор записи уже используется", 409);
    return;
  }
  db.prepare(
    "INSERT INTO ContentNote(id,body,kind,authorId,authorName,createdAt) VALUES(?,?,?,?,?,?)",
  ).run(note.id, note.text, note.kind, user.id, user.name, Date.now());
  db.prepare("INSERT INTO ItemNote(itemId,noteId) VALUES(?,?)").run(
    itemId,
    note.id,
  );
}
function saveItem(
  db: Database.Database,
  user: SessionUser,
  raw: unknown,
  create: boolean,
) {
  const data = input.parse(raw),
    old = getRow(db, "ContentItem", data.id),
    fingerprint = createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
  if (create && old) {
    if (old.creationFingerprint !== fingerprint)
      throw new WorkspaceError(
        "Эта запись уже создана. Загрузите её и сохраните изменения.",
        409,
      );
    return;
  }
  if (!create) {
    if (!old) throw new WorkspaceError("Запись не найдена", 404);
    checkRevision(old, data.revision);
    if (
      old.kind !== data.kind &&
      (old.kind === "task" ||
        old.kind === "event" ||
        data.kind === "task" ||
        data.kind === "event")
    )
      throw new WorkspaceError(
        "Для смены рабочего контекста используйте «Добавить в тему» или создание мероприятия.",
      );
  }
  const start = data.start || null,
    end = data.end || null;
  if (start && end && end < start)
    throw new WorkspaceError("Дата окончания раньше даты начала");
  if (
    data.kind === "event" &&
    start === end &&
    data.startTime &&
    data.endTime &&
    data.endTime < data.startTime
  )
    throw new WorkspaceError("Время окончания раньше времени начала");
  zone(data.timeZone);
  let parent = data.parent || null,
    activity = data.activityId || null,
    project = data.project || null,
    linked = data.linkedTaskId || null;
  const parentRow = parent ? need(db, "ContentItem", parent) : null;
  if (parent && (parent === data.id || branch(db, data.id).includes(parent)))
    throw new WorkspaceError("Нельзя создать цикл вложенных записей");
  if (data.kind === "task") {
    if (parentRow && parentRow.kind !== "task")
      throw new WorkspaceError(
        "Родителем рабочей задачи может быть только рабочая задача.",
      );
    if (parentRow) project = parentRow.projectId;
    activity = null;
    linked = null;
  } else if (data.kind === "event") {
    if (parentRow && parentRow.kind !== "event")
      throw new WorkspaceError(
        "Вложенное мероприятие должно относиться к мероприятию.",
      );
    project = null;
    activity = null;
    linked = null;
  } else {
    if (!activity || need(db, "ContentItem", activity).kind !== "event")
      throw new WorkspaceError("Выберите мероприятие для этого пункта");
    if (parentRow?.id === activity) parent = null;
    else if (
      parentRow &&
      (!isAgenda(parentRow.kind) || parentRow.activityId !== activity)
    )
      throw new WorkspaceError(
        "Родительский пункт находится в другом мероприятии.",
      );
    project = null;
    if (data.kind === "reference") {
      if (linked && need(db, "ContentItem", linked).kind !== "task")
        throw new WorkspaceError("Можно подключить только рабочую задачу");
      if (!linked && !old) throw new WorkspaceError("Выберите рабочую задачу");
    } else linked = null;
  }
  if (project) {
    const p = need(db, "Project", project);
    if (p.archived && old?.projectId !== project)
      throw new WorkspaceError("Тема скрыта. Верните её в справочнике.");
  }
  for (const id of data.topics) {
    const p = need(db, "Project", id);
    if (
      p.archived &&
      !db
        .prepare("SELECT 1 FROM EventProject WHERE itemId=? AND projectId=?")
        .get(data.id, id)
    )
      throw new WorkspaceError("Выбранная тема скрыта");
  }
  if (data.originItemId) need(db, "ContentItem", data.originItemId);
  const title =
    data.title || (linked ? need(db, "ContentItem", linked).title : "");
  if (!title) throw new WorkspaceError("Введите название");
  const now = Date.now(),
    values = [
      data.kind,
      title,
      data.description,
      data.outcome,
      project,
      parent,
      activity,
      linked,
      data.originItemId,
      start,
      end,
      data.startTime || null,
      data.endTime || null,
      data.location,
      data.timeZone,
      data.status,
      data.kind === "task" ? data.percent : 0,
      now,
    ];
  if (create)
    db.prepare(
      "INSERT INTO ContentItem(kind,title,description,outcome,projectId,parentId,activityId,linkedTaskId,originItemId,startDate,endDate,startTime,endTime,location,timeZone,status,percent,updatedAt,id,createdAt,creationFingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(...values, data.id, now, fingerprint);
  else
    db.prepare(
      "UPDATE ContentItem SET kind=?,title=?,description=?,outcome=?,projectId=?,parentId=?,activityId=?,linkedTaskId=?,originItemId=?,startDate=?,endDate=?,startTime=?,endTime=?,location=?,timeZone=?,status=?,percent=?,updatedAt=?,revision=revision+1 WHERE id=?",
    ).run(...values, data.id);
  setPeople(db, data.id, data);
  if (create)
    db.prepare(
      "UPDATE ContentItem SET position=(SELECT COALESCE(MAX(position),-1)+1 FROM ContentItem WHERE id<>?) WHERE id=?",
    ).run(data.id, data.id);
  setTags(db, data.id, data.tags);
  db.prepare("DELETE FROM EventProject WHERE itemId=?").run(data.id);
  if (data.kind === "event")
    for (const id of new Set(data.topics))
      db.prepare("INSERT INTO EventProject(itemId,projectId) VALUES(?,?)").run(
        data.id,
        id,
      );
  if (create)
    for (const note of data.comments) insertNote(db, user, data.id, note);
  if (create && data.kind === "event" && data.originItemId) {
    const origin = need(db, "ContentItem", data.originItemId);
    const taskId =
      origin.kind === "task"
        ? origin.id
        : origin.kind === "reference"
          ? origin.linkedTaskId
          : null;
    if (taskId)
      linkTasks(db, user, {
        activityId: data.id,
        taskIds: [taskId],
        copyPeople: true,
        requestId: data.id + "-origin",
      });
  }

  if (old && isAgenda(old.kind) && old.activityId !== activity)
    for (const childId of branch(db, data.id))
      if (childId !== data.id)
        db.prepare(
          "UPDATE ContentItem SET activityId=?,revision=revision+1,updatedAt=? WHERE id=? AND activityId=?",
        ).run(activity, now, childId, old.activityId);

  if (old?.kind === "task" && old.projectId !== project)
    for (const id of branch(db, data.id))
      if (id !== data.id)
        db.prepare(
          "UPDATE ContentItem SET projectId=?,revision=revision+1,updatedAt=? WHERE id=? AND kind='task'",
        ).run(project, now, id);
}
function directory(db: Database.Database, raw: unknown) {
  const data = z
    .object({
      id: ID,
      mode: z.enum(["projects", "contacts", "responsibles", "tags"]),
      name: z.string().transform(cleanName).pipe(z.string().min(1).max(200)),
      description: z.string().max(100000).default(""),
      type: z.enum(["Человек", "Организация", "Группа"]).default("Человек"),
      responsible: z.boolean().default(false),
      company: z.string().max(2000).optional(),
      position: z.string().max(2000).optional(),
      phones: z.string().max(10000).optional(),
      emails: z.string().max(10000).optional(),
      addresses: z.string().max(10000).optional(),
      website: z.string().max(4000).optional(),
      notes: z.string().max(100000).optional(),
      topics: z.array(ID).max(200).optional(),
      revision: z.number().int().optional(),
    })
    .parse(raw);
  const table =
      data.mode === "projects"
        ? "Project"
        : data.mode === "tags"
          ? "Tag"
          : "Contact",
    old = getRow(db, table, data.id),
    key = nameKey(data.name),
    duplicate = db
      .prepare(`SELECT id FROM ${table} WHERE key=? AND id<>?`)
      .get(key, data.id);
  if (duplicate)
    throw new WorkspaceError(
      "Такая запись уже существует. Выберите её или объедините записи.",
      409,
    );
  if (old) {
    if (
      data.revision === undefined &&
      old.name === data.name &&
      (table !== "Project" || old.description === data.description) &&
      (table !== "Contact" ||
        (old.type === data.type &&
          !!old.responsible === data.responsible &&
          [
            "company",
            "position",
            "phones",
            "emails",
            "addresses",
            "website",
            "notes",
          ].every(
            (key) =>
              (data as Row)[key] === undefined ||
              (data as Row)[key] === old[key],
          ) &&
          (data.topics === undefined ||
            JSON.stringify([...new Set(data.topics)].sort()) ===
              JSON.stringify(
                (
                  db
                    .prepare(
                      "SELECT projectId FROM ContactProject WHERE contactId=? ORDER BY projectId",
                    )
                    .all(data.id) as Row[]
                ).map((r) => r.projectId),
              ))))
    )
      return;
    checkRevision(old, data.revision);
  }
  if (
    table === "Contact" &&
    old?.responsible &&
    !data.responsible &&
    db
      .prepare(
        "SELECT 1 FROM ItemContact WHERE contactId=? AND role='responsible'",
      )
      .get(data.id)
  )
    throw new WorkspaceError(
      "Есть назначения ответственным. Выберите замену через удаление роли.",
    );
  const now = Date.now();
  if (table === "Project") {
    if (old)
      db.prepare(
        "UPDATE Project SET name=?,key=?,description=?,updatedAt=?,revision=revision+1 WHERE id=?",
      ).run(data.name, key, data.description, now, data.id);
    else
      db.prepare(
        "INSERT INTO Project(id,name,key,description,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
      ).run(data.id, data.name, key, data.description, now, now);
  } else if (table === "Tag") {
    if (old)
      db.prepare(
        "UPDATE Tag SET name=?,key=?,revision=revision+1,updatedAt=? WHERE id=?",
      ).run(data.name, key, now, data.id);
    else
      db.prepare(
        "INSERT INTO Tag(id,name,key,createdAt,updatedAt) VALUES(?,?,?,?,?)",
      ).run(data.id, data.name, key, now, now);
  } else {
    if (old)
      db.prepare(
        "UPDATE Contact SET name=?,key=?,type=?,responsible=?,revision=revision+1,updatedAt=? WHERE id=?",
      ).run(data.name, key, data.type, Number(data.responsible), now, data.id);
    else
      db.prepare(
        "INSERT INTO Contact(id,name,key,type,responsible,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)",
      ).run(
        data.id,
        data.name,
        key,
        data.type,
        Number(data.responsible),
        now,
        now,
      );
    for (const field of [
      "company",
      "position",
      "phones",
      "emails",
      "addresses",
      "website",
      "notes",
    ])
      if ((data as Row)[field] !== undefined)
        db.prepare(`UPDATE Contact SET ${field}=? WHERE id=?`).run(
          (data as Row)[field],
          data.id,
        );
    if (data.topics !== undefined) {
      for (const id of data.topics) need(db, "Project", id);
      db.prepare("DELETE FROM ContactProject WHERE contactId=?").run(data.id);
      for (const id of new Set(data.topics))
        db.prepare(
          "INSERT INTO ContactProject(contactId,projectId) VALUES(?,?)",
        ).run(data.id, id);
    }
  }
}
function removeDirectory(db: Database.Database, data: Row) {
  const mode = z
      .enum(["projects", "contacts", "responsibles", "tags"])
      .parse(data.mode),
    table =
      mode === "projects" ? "Project" : mode === "tags" ? "Tag" : "Contact",
    id = ID.parse(data.id),
    old = getRow(db, table, id);
  if (!old) return;
  checkRevision(old, data.revision);
  const replacement = data.replacement ? ID.parse(data.replacement) : null;
  if (replacement === id) throw new WorkspaceError("Выберите другую запись");
  const target = replacement ? need(db, table, replacement) : null;
  if (target?.archived) throw new WorkspaceError("Замена скрыта");
  const now = Date.now();
  if (table === "Project") {
    db.prepare(
      "UPDATE ContentItem SET projectId=?,revision=revision+1,updatedAt=? WHERE projectId=?",
    ).run(replacement, now, id);
    if (replacement)
      db.prepare(
        "INSERT OR IGNORE INTO EventProject(itemId,projectId) SELECT itemId,? FROM EventProject WHERE projectId=?",
      ).run(replacement, id);
    if (replacement)
      db.prepare(
        "INSERT OR IGNORE INTO ContactProject(contactId,projectId) SELECT contactId,? FROM ContactProject WHERE projectId=?",
      ).run(replacement, id);
    db.prepare("DELETE FROM Project WHERE id=?").run(id);
  } else if (table === "Tag") {
    const affected = db
      .prepare("SELECT itemId FROM ItemTag WHERE tagId=?")
      .all(id) as Row[];
    if (replacement)
      db.prepare(
        "INSERT OR IGNORE INTO ItemTag(itemId,tagId) SELECT itemId,? FROM ItemTag WHERE tagId=?",
      ).run(replacement, id);
    db.prepare("DELETE FROM Tag WHERE id=?").run(id);
    for (const item of affected)
      db.prepare(
        "UPDATE ContentItem SET revision=revision+1,updatedAt=? WHERE id=?",
      ).run(now, item.itemId);
  } else {
    const assignments = db
      .prepare(
        "SELECT * FROM ItemContact WHERE contactId=?" +
          (mode === "responsibles" ? " AND role='responsible'" : ""),
      )
      .all(id) as Row[];
    if (
      target &&
      !target.responsible &&
      assignments.some((a) => a.role === "responsible")
    )
      throw new WorkspaceError("Замена должна быть доступна в ответственных");
    for (const a of assignments) {
      db.prepare(
        "DELETE FROM ItemContact WHERE itemId=? AND contactId=? AND role=?",
      ).run(a.itemId, id, a.role);
      if (replacement)
        db.prepare(
          "INSERT OR IGNORE INTO ItemContact(itemId,contactId,role) VALUES(?,?,?)",
        ).run(a.itemId, replacement, a.role);
      db.prepare(
        "UPDATE ContentItem SET revision=revision+1,updatedAt=? WHERE id=?",
      ).run(now, a.itemId);
    }
    if (mode === "responsibles")
      db.prepare(
        "UPDATE Contact SET responsible=0,revision=revision+1,updatedAt=? WHERE id=?",
      ).run(now, id);
    else {
      if (replacement) {
        // A merged identity keeps every selected mention pointing to the survivor.
        for (const [table, columns] of [
          ["ContentItem", ["description", "outcome"]],
          ["Project", ["description"]],
          ["ContentNote", ["body"]],
        ] as [string, string[]][]) {
          for (const column of columns) {
            const from = "](contact:" + id + ")",
              to = "](contact:" + replacement + ")";
            const marker = ":::contact " + id + "\n",
              nextMarker = ":::contact " + replacement + "\n";
            db.prepare(
              `UPDATE ${table} SET ${column}=replace(replace(${column},?,?),?,?),revision=revision+1${table === "ContentNote" ? "" : ",updatedAt=" + now} WHERE instr(${column},?)>0 OR instr(${column},?)>0`,
            ).run(from, to, marker, nextMarker, from, marker);
          }
        }
        db.prepare(
          "INSERT OR IGNORE INTO ContactProject(contactId,projectId) SELECT ?,projectId FROM ContactProject WHERE contactId=?",
        ).run(replacement, id);
        for (const field of [
          "company",
          "position",
          "phones",
          "emails",
          "addresses",
          "website",
          "notes",
        ])
          if (!target![field] && old[field])
            db.prepare(`UPDATE Contact SET ${field}=? WHERE id=?`).run(
              old[field],
              replacement,
            );
        db.prepare(
          "UPDATE Contact SET revision=revision+1,updatedAt=? WHERE id=?",
        ).run(now, replacement);
      }
      db.prepare("DELETE FROM Contact WHERE id=?").run(id);
    }
  }
}
function linkTasks(db: Database.Database, user: SessionUser, data: Row) {
  const parsed = z
    .object({
      activityId: ID,
      taskIds: z.array(ID).min(1).max(1000),
      includeChildren: z.boolean().default(false),
      copyPeople: z.boolean().default(true),
      requestId: ID,
    })
    .parse(data);
  if (need(db, "ContentItem", parsed.activityId).kind !== "event")
    throw new WorkspaceError("Выберите мероприятие");
  const ids = new Set(
    parsed.taskIds.flatMap((id) =>
      parsed.includeChildren ? branch(db, id) : [id],
    ),
  );
  const referenceId = (taskId: string) =>
    createHash("sha256")
      .update(parsed.requestId + "\0" + taskId)
      .digest("hex");
  const createdReferences: { id: string; parent: string | null }[] = [];
  for (const taskId of ids) {
    const t = need(db, "ContentItem", taskId);
    if (t.kind !== "task") throw new WorkspaceError("Выберите рабочие задачи");
    const id = referenceId(taskId);
    const existing = getRow(db, "ContentItem", id);
    if (existing) {
      if (
        existing.activityId !== parsed.activityId ||
        existing.linkedTaskId !== taskId
      )
        throw new WorkspaceError(
          "Этот запрос уже использован для другого мероприятия",
          409,
        );
      continue;
    }
    saveItem(
      db,
      user,
      {
        id,
        kind: "reference",
        activityId: parsed.activityId,
        linkedTaskId: taskId,
        title: t.title,
      },
      true,
    );
    createdReferences.push({
      id,
      parent: ids.has(t.parentId) ? referenceId(t.parentId) : null,
    });
    if (parsed.copyPeople)
      db.prepare(
        "INSERT INTO ItemContact(itemId,contactId,role) SELECT ?,contactId,role FROM ItemContact WHERE itemId=?",
      ).run(id, taskId);
  }
  // All placements now exist, regardless of the order of selected branches.
  for (const r of createdReferences)
    if (r.parent)
      db.prepare("UPDATE ContentItem SET parentId=? WHERE id=?").run(
        r.parent,
        r.id,
      );
}
function promote(db: Database.Database, user: SessionUser, data: Row) {
  const root = need(db, "ContentItem", ID.parse(data.id));
  checkRevision(root, data.revision);
  if (!isAgenda(root.kind) || root.kind === "reference")
    throw new WorkspaceError("Выберите собственный пункт мероприятия");
  const project = data.project ? ID.parse(data.project) : null,
    parent = data.parent
      ? need(db, "ContentItem", ID.parse(data.parent))
      : null;
  if (parent && parent.kind !== "task")
    throw new WorkspaceError("Выберите родительскую рабочую задачу");
  const targetProject = parent?.projectId || project;
  if (targetProject) need(db, "Project", targetProject);
  const all = branch(db, root.id)
    .map((id) => need(db, "ContentItem", id))
    .filter(
      (item) =>
        item.activityId === root.activityId && item.kind !== "reference",
    );
  const converted = new Set(all.map((i) => i.id)),
    refIds = new Map(all.map((i) => [i.id, randomUUID()]));
  for (const item of all) {
    const referenceId = refIds.get(item.id)!,
      workParent = converted.has(item.parentId)
        ? item.parentId
        : parent?.id || null;
    db.prepare(
      "UPDATE ContentItem SET kind='task',projectId=?,parentId=?,activityId=NULL,linkedTaskId=NULL,revision=revision+1,updatedAt=? WHERE id=?",
    ).run(targetProject, workParent, Date.now(), item.id);
    saveItem(
      db,
      user,
      {
        id: referenceId,
        kind: "reference",
        activityId: root.activityId,
        linkedTaskId: item.id,
        title: item.title,
        description: item.description,
        outcome: item.outcome,
        parent: converted.has(item.parentId) ? null : item.parentId,
        start: item.startDate,
        end: item.endDate,
        status: item.status,
      },
      true,
    );
    for (const table of ["ItemContact", "ItemTag", "ItemFile", "ItemNote"]) {
      const column =
        table === "ItemContact"
          ? "contactId,role"
          : table === "ItemTag"
            ? "tagId"
            : table === "ItemFile"
              ? "fileId"
              : "noteId";
      db.prepare(
        `INSERT INTO ${table}(itemId,${column}) SELECT ?,${column} FROM ${table} WHERE itemId=?`,
      ).run(referenceId, item.id);
    }
  }
  for (const item of all) {
    const ref = refIds.get(item.id)!;
    if (converted.has(item.parentId))
      db.prepare("UPDATE ContentItem SET parentId=? WHERE id=?").run(
        refIds.get(item.parentId),
        ref,
      );
    db.prepare(
      "UPDATE ContentItem SET parentId=?,revision=revision+1,updatedAt=? WHERE parentId=? AND activityId=?",
    ).run(ref, Date.now(), item.id, root.activityId);
  }
}
export function productSnapshot(db: Database.Database, user: SessionUser) {
  const contactTopics = db
    .prepare("SELECT contactId,projectId FROM ContactProject ORDER BY rowid")
    .all() as Row[];
  const projects = db
    .prepare(
      "SELECT id,name,color,description,archived,revision FROM Project ORDER BY createdAt,rowid",
    )
    .all() as Row[];
  const contacts = db
    .prepare(
      "SELECT id,name,type,responsible,archived,revision,company,position,phones,emails,addresses,website,notes FROM Contact ORDER BY name",
    )
    .all() as Row[];
  const tags = db
    .prepare("SELECT id,name,archived,revision FROM Tag ORDER BY name")
    .all() as Row[];
  const rows = db
    .prepare(
      "SELECT id,kind,title,description,outcome,projectId,parentId,activityId,linkedTaskId,originItemId,startDate,endDate,startTime,endTime,location,timeZone,status,percent,position,revision,sourceMeta,createdAt,updatedAt FROM ContentItem ORDER BY position,createdAt,id",
    )
    .all() as Row[];
  const people = db
      .prepare("SELECT itemId,contactId,role FROM ItemContact ORDER BY rowid")
      .all() as Row[],
    itemTags = db
      .prepare(
        "SELECT x.itemId,t.id,t.name FROM ItemTag x JOIN Tag t ON t.id=x.tagId ORDER BY x.rowid",
      )
      .all() as Row[];
  const notes = db
    .prepare(
      "SELECT x.itemId,n.id,n.body,n.kind,n.resolved,n.revision,n.createdAt,COALESCE(NULLIF(n.authorName,''),u.name) AS author FROM ItemNote x JOIN ContentNote n ON n.id=x.noteId LEFT JOIN User u ON u.id=n.authorId ORDER BY n.createdAt,n.rowid",
    )
    .all() as Row[];
  const files = db
    .prepare(
      "SELECT x.itemId,f.id,f.name,f.type,f.size,f.createdAt FROM ItemFile x JOIN ContentFile f ON f.id=x.fileId ORDER BY f.createdAt,f.rowid",
    )
    .all() as Row[];
  const topics = db
      .prepare("SELECT itemId,projectId FROM EventProject ORDER BY rowid")
      .all() as Row[],
    byId = new Map(rows.map((r) => [r.id, r]));
  const group = (list: Row[]) => {
    const map = new Map<string, Row[]>();
    for (const r of list) {
      const values = map.get(r.itemId) || [];
      values.push(r);
      map.set(r.itemId, values);
    }
    return map;
  };
  const ps = group(people),
    ts = group(itemTags),
    ns = group(notes),
    fs = group(files),
    ep = group(topics);
  const topicsOf = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    const r = byId.get(id);
    if (!r) return [];
    const own = (ep.get(id) || []).map((p) => p.projectId);
    for (const item of rows) {
      if (item.activityId === id && item.linkedTaskId) {
        const topic = byId.get(item.linkedTaskId)?.projectId;
        if (topic) own.push(topic);
      }
      if (item.kind === "event" && item.parentId === id)
        own.push(...topicsOf(item.id, seen));
    }
    return [...new Set(own)];
  };
  const items = rows.map((r) => {
    const linked = r.linkedTaskId ? byId.get(r.linkedTaskId) : null,
      assigned = ps.get(r.id) || [],
      meta = r.sourceMeta ? JSON.parse(r.sourceMeta) : {};
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      workingTitle: linked?.title || "",
      description: r.description,
      outcome: r.outcome,
      project: r.projectId || linked?.projectId || "",
      sourceProject: r.projectId || "",
      parent: r.parentId || r.activityId || null,
      sourceParent: r.parentId || null,
      activityId: r.activityId || null,
      linkedTaskId: r.linkedTaskId || null,
      originItemId: r.originItemId || null,
      topics: r.kind === "event" ? topicsOf(r.id) : [],
      manualTopics: (ep.get(r.id) || []).map((p) => p.projectId),
      counterparties: assigned
        .filter((p) => p.role === "counterparty")
        .map((p) => p.contactId),
      executors: assigned
        .filter((p) => p.role === "executor")
        .map((p) => p.contactId),
      responsible:
        assigned.find((p) => p.role === "responsible")?.contactId || "",
      tags: (ts.get(r.id) || []).map((t) => t.name),
      tagIds: (ts.get(r.id) || []).map((t) => t.id),
      start: r.startDate || "",
      end: r.endDate || "",
      startTime: r.startTime || "",
      endTime: r.endTime || "",
      location: r.location,
      timeZone: r.timeZone,
      status: r.status,
      percent: r.percent,
      revision: r.revision,
      legacyTags: meta.legacyTags || "",
      legacyAssignments: meta.legacyAssignments || "",
      comments: (ns.get(r.id) || []).map((n) => ({
        id: n.id,
        text: n.body,
        kind: n.kind,
        resolved: !!n.resolved,
        revision: n.revision,
        createdAt: n.createdAt,
        author: n.author || "",
      })),
      attachments: (fs.get(r.id) || []).map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        size: f.size,
        createdAt: f.createdAt,
      })),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
  const eventById = new Map(
    items.filter((i) => i.kind === "event").map((i) => [i.id, i]),
  );
  const aggregated = new Set<string>();
  const aggregate = (id: string, seen = new Set<string>()) => {
    const event = eventById.get(id);
    if (!event || aggregated.has(id) || seen.has(id)) return;
    seen.add(id);
    const members = items.filter((i) => i.activityId === id),
      children = items.filter(
        (i) => i.kind === "event" && i.sourceParent === id,
      );
    for (const child of children) aggregate(child.id, seen);
    const own = [event, ...members];
    const roles = {
      counterparty: [
        ...new Set([
          ...own.flatMap((i) => i.counterparties),
          ...children.flatMap((i) => (i as Row).rolePeople?.counterparty || []),
        ]),
      ],
      executor: [
        ...new Set([
          ...own.flatMap((i) => i.executors),
          ...children.flatMap((i) => (i as Row).rolePeople?.executor || []),
        ]),
      ],
      responsible: [
        ...new Set([
          ...own.map((i) => i.responsible).filter(Boolean),
          ...children.flatMap((i) => (i as Row).rolePeople?.responsible || []),
        ]),
      ],
    };
    (event as Row).rolePeople = roles;
    (event as Row).participants = [
      ...new Set([
        ...roles.counterparty,
        ...roles.executor,
        ...roles.responsible,
      ]),
    ];
    (event as Row).allTagIds = [
      ...new Set([
        ...own.flatMap((i) => i.tagIds),
        ...children.flatMap((i) => (i as Row).allTagIds || []),
      ]),
    ];
    aggregated.add(id);
  };
  for (const id of eventById.keys()) aggregate(id);
  for (const work of items.filter((i) => i.kind === "task")) {
    const ids = new Set<string>(
      items
        .filter(
          (i) =>
            i.kind === "reference" &&
            i.linkedTaskId === work.id &&
            i.activityId,
        )
        .map((i) => i.activityId),
    );
    for (const event of items.filter(
      (i) => i.kind === "event" && i.originItemId === work.id,
    ))
      ids.add(event.id);
    for (const id of [...ids]) {
      let event = byId.get(id);
      const seen = new Set<string>();
      while (event?.parentId && !seen.has(event.parentId)) {
        seen.add(event.parentId);
        ids.add(event.parentId);
        event = byId.get(event.parentId);
      }
    }
    (work as Row).relatedEvents = [...ids];
  }
  const meta = (key: string) =>
    (db.prepare("SELECT value FROM WorkspaceMeta WHERE key=?").get(key) as Row)
      ?.value;
  for (const c of contacts) {
    c.manualTopics = contactTopics
      .filter((t) => t.contactId === c.id)
      .map((t) => t.projectId);
    c.topics = [
      ...new Set([
        ...c.manualTopics,
        ...items
          .filter(
            (i) =>
              i.counterparties.includes(c.id) ||
              i.executors.includes(c.id) ||
              i.responsible === c.id,
          )
          .flatMap((i) =>
            i.kind === "event"
              ? i.topics
              : i.project
                ? [i.project]
                : items.find((e) => e.id === i.activityId)?.topics || [],
          ),
      ]),
    ];
  }
  return {
    instanceId: meta("instance"),
    revision: Number(meta("revision") || 0),
    version: 3,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      color: p.color,
      revision: p.revision,
      archived: !!p.archived,
    })),
    contacts: contacts.map((c) => ({
      id: String(c.id),
      name: String(c.name),
      type: String(c.type),
      revision: Number(c.revision),
      company: String(c.company),
      position: String(c.position),
      phones: String(c.phones),
      emails: String(c.emails),
      addresses: String(c.addresses),
      website: String(c.website),
      notes: String(c.notes),
      manualTopics: c.manualTopics as string[],
      topics: c.topics as string[],
      archived: !!c.archived,
      responsible: !!c.responsible,
    })),
    tags: tags.map((t) => ({ ...t, archived: !!t.archived })),
    tasks: items,
    session: { id: user.id, name: user.name },
    timeZone: process.env.APP_TIME_ZONE || "Asia/Jerusalem",
    migration: {
      unassigned: items.filter((i) => i.kind === "task" && !i.project).length,
    },
  };
}
export function productAction(
  db: Database.Database,
  user: SessionUser,
  raw: unknown,
) {
  const { action, data } = z
      .object({
        action: z.string().max(50),
        data: z.record(z.string(), z.unknown()),
      })
      .parse(raw),
    d = data as Row;
  return db
    .transaction(() => {
      switch (action) {
        case "createTask":
          saveItem(db, user, d, true);
          break;
        case "saveTask":
          saveItem(db, user, d, false);
          break;
        case "moveItem": {
          const parsed = z
            .object({
              id: ID,
              revision: z.number().int().min(0),
              direction: z.union([z.literal(-1), z.literal(1)]),
            })
            .parse(d);
          const current = need(db, "ContentItem", parsed.id);
          checkRevision(current, parsed.revision);
          const siblings = db
            .prepare(
              "SELECT id,position FROM ContentItem WHERE parentId IS ? AND activityId IS ? AND " +
                (isAgenda(current.kind)
                  ? "kind NOT IN ('task','event')"
                  : "kind=?") +
                " ORDER BY position,createdAt,id",
            )
            .all(
              ...(isAgenda(current.kind)
                ? [current.parentId, current.activityId]
                : [current.parentId, current.activityId, current.kind]),
            ) as Row[];
          const index = siblings.findIndex((r) => r.id === current.id),
            next = index + parsed.direction;
          if (next < 0 || next >= siblings.length) break;
          [siblings[index], siblings[next]] = [siblings[next], siblings[index]];
          siblings.forEach((r, i) =>
            db
              .prepare(
                "UPDATE ContentItem SET position=?,revision=revision+1,updatedAt=? WHERE id=?",
              )
              .run(i, Date.now(), r.id),
          );
          break;
        }
        case "deleteTask": {
          const r = getRow(db, "ContentItem", ID.parse(d.id));
          if (!r) break;
          checkRevision(r, d.revision);
          db.prepare(
            "UPDATE ContentItem SET parentId=?,revision=revision+1,updatedAt=? WHERE parentId=?",
          ).run(r.parentId, Date.now(), r.id);
          db.prepare("DELETE FROM ContentItem WHERE id=?").run(r.id);
          db.prepare(
            "DELETE FROM ContentNote WHERE id NOT IN (SELECT noteId FROM ItemNote)",
          ).run();
          db.prepare(
            "DELETE FROM ContentFile WHERE id NOT IN (SELECT fileId FROM ItemFile)",
          ).run();
          break;
        }
        case "saveDirectory":
          directory(db, d);
          break;
        case "hideDirectory": {
          const mode = z
              .enum(["projects", "contacts", "responsibles", "tags"])
              .parse(d.mode),
            table =
              mode === "projects"
                ? "Project"
                : mode === "tags"
                  ? "Tag"
                  : "Contact",
            r = need(db, table, ID.parse(d.id)),
            archived = z.boolean().parse(d.archived);
          if (!!r.archived === archived) break;
          checkRevision(r, d.revision);
          db.prepare(
            `UPDATE ${table} SET archived=?,revision=revision+1,updatedAt=? WHERE id=?`,
          ).run(Number(archived), Date.now(), r.id);
          break;
        }
        case "removeDirectory":
          removeDirectory(db, d);
          break;
        case "makeResponsible": {
          const r = need(db, "Contact", ID.parse(d.id));
          if (r.responsible && !r.archived) break;
          checkRevision(r, d.revision);
          if (r.archived) throw new WorkspaceError("Контакт скрыт");
          db.prepare(
            "UPDATE Contact SET responsible=1,revision=revision+1,updatedAt=? WHERE id=?",
          ).run(Date.now(), r.id);
          break;
        }
        case "addNote": {
          const n = z
            .object({
              id: ID,
              taskId: ID,
              text: z.string().trim().min(1).max(100000),
              kind: z.enum(["comment", "question"]),
            })
            .parse(d);
          need(db, "ContentItem", n.taskId);
          insertNote(db, user, n.taskId, n);
          break;
        }
        case "resolveNote": {
          const n = need(db, "ContentNote", ID.parse(d.id)),
            resolved = z.boolean().parse(d.resolved);
          if (!!n.resolved === resolved) break;
          checkRevision(n, d.revision);
          if (n.kind !== "question")
            throw new WorkspaceError("Эта запись не является вопросом");
          db.prepare(
            "UPDATE ContentNote SET resolved=?,revision=revision+1 WHERE id=?",
          ).run(Number(resolved), n.id);
          break;
        }
        case "linkTasks":
          linkTasks(db, user, d);
          break;
        case "promoteItem":
          promote(db, user, d);
          break;
        default:
          throw new WorkspaceError("Неизвестная операция");
      }
      touch(db);
      return productSnapshot(db, user);
    })
    .immediate();
}

export function createImportedItem(
  db: Database.Database,
  user: SessionUser,
  data: unknown,
  sourceMeta: unknown = {},
) {
  saveItem(db, user, data, true);
  const id = (data as Row).id;
  db.prepare("UPDATE ContentItem SET sourceMeta=? WHERE id=?").run(
    JSON.stringify(sourceMeta),
    id,
  );
}
