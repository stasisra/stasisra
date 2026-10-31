import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { z } from "zod";
import { cleanName, nameKey, touch, WorkspaceError } from "./database";
import { dateOnly } from "../dates";
import type { SessionUser } from "../session";
type Row = Record<string, any>;
type ProjectRecord = {
  id: string;
  name: string;
  color: string;
  archived: number;
  revision: number;
};
type ContactRecord = {
  id: string;
  name: string;
  type: string;
  responsible: number;
  archived: number;
  revision: number;
};
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const date = z
  .string()
  .refine((v) => dateOnly(v) !== null, "Некорректная календарная дата");
const taskInput = z.object({
  id,
  title: z.string().trim().min(1, "Введите название").max(1000),
  description: z.string().max(100000).default(""),
  project: z.string().max(100).default(""),
  parent: z.string().max(100).nullable().default(null),
  executors: z.array(id).max(100).default([]),
  responsible: z.string().max(100).default(""),
  start: date,
  end: date,
  percent: z.number().int().min(0).max(100),
  status: z.enum(["PLANNED", "IN_PROGRESS", "PAUSED", "DONE"]),
  kind: z.enum(["task", "event"]),
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
  revision: z.number().int().min(0).default(0),
  comments: z
    .array(
      z.object({
        id,
        kind: z.enum(["comment", "question"]),
        text: z.string().trim().min(1).max(100000),
      }),
    )
    .max(100)
    .default([]),
});
function row(
  db: Database.Database,
  table: "Task" | "Project" | "Contact" | "TaskComment",
  key: string,
) {
  return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key) as
    Row | undefined;
}
function requireRow(
  db: Database.Database,
  table: "Task" | "Project" | "Contact" | "TaskComment",
  key: string,
) {
  const result = row(db, table, key);
  if (!result)
    throw new WorkspaceError("Запись не найдена. Обновите данные.", 404);
  return result;
}
function revision(record: Row, expected: unknown) {
  if (record.revision !== expected)
    throw new WorkspaceError(
      "Запись изменена в другом окне. Загрузите актуальные данные и повторите действие.",
      409,
    );
}
function timezone(value: string) {
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: value }).format();
  } catch {
    throw new WorkspaceError("Неизвестный часовой пояс");
  }
  return value;
}
function epoch(value: unknown) {
  if (typeof value === "number") return value;
  const raw = String(value || "");
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed)
    ? parsed
    : new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z").getTime();
}
function ymd(value: unknown) {
  const time = epoch(value);
  if (!Number.isFinite(time))
    throw new WorkspaceError(
      "В базе есть некорректные даты. Требуется исправление.",
      422,
    );
  return new Date(time).toISOString().slice(0, 10);
}
function sqlDate(value: string) {
  return new Date(value + "T00:00:00Z").getTime();
}
function treeIds(db: Database.Database, root: string) {
  return (
    db
      .prepare(
        "WITH RECURSIVE branch(id) AS (SELECT ? UNION SELECT t.id FROM Task t JOIN branch b ON t.parentTaskId=b.id) SELECT id FROM branch",
      )
      .all(root) as { id: string }[]
  ).map((t) => t.id);
}
function syncLegacyNames(db: Database.Database, taskId: string) {
  const executors = db
    .prepare(
      "SELECT c.name FROM TaskExecutor e JOIN Contact c ON c.id=e.contactId WHERE e.taskId=? ORDER BY c.name",
    )
    .all(taskId) as { name: string }[];
  db.prepare(
    "UPDATE Task SET executorName=?,responsibleName=(SELECT name FROM Contact WHERE id=Task.responsibleContactId) WHERE id=?",
  ).run(executors.map((c) => c.name).join(", ") || null, taskId);
}
export function workspaceSnapshot(db: Database.Database, session: SessionUser) {
  const marker = db
    .prepare("SELECT value FROM WorkspaceMeta WHERE key='classification-v1'")
    .get() as { value: string } | undefined;
  if (!marker)
    throw new WorkspaceError("Завершите обновление: npm run db:upgrade", 503);
  const projects = (
    db
      .prepare(
        "SELECT id,name,color,archived,revision FROM Project ORDER BY createdAt,rowid",
      )
      .all() as ProjectRecord[]
  ).map((p) => ({ ...p, archived: !!p.archived }));
  const contacts = (
    db
      .prepare(
        "SELECT id,name,type,responsible,archived,revision FROM Contact ORDER BY name",
      )
      .all() as ContactRecord[]
  ).map((c) => ({
    ...c,
    responsible: !!c.responsible,
    archived: !!c.archived,
  }));
  const comments = db
    .prepare(
      "SELECT id,taskId,body,kind,resolved,revision,createdAt FROM TaskComment ORDER BY createdAt,rowid",
    )
    .all() as Row[];
  const files = db
    .prepare(
      "SELECT id,taskId,name,type,size,createdAt FROM Attachment ORDER BY createdAt,rowid",
    )
    .all() as Row[];
  const assignees = db
    .prepare("SELECT taskId,contactId FROM TaskExecutor ORDER BY rowid")
    .all() as Row[];
  const byTask = (records: Row[], key: string) => {
    const map = new Map<string, Row[]>();
    for (const r of records) {
      const values = map.get(r[key]) || [];
      values.push(r);
      map.set(r[key], values);
    }
    return map;
  };
  const notes = byTask(comments, "taskId"),
    attachments = byTask(files, "taskId"),
    executors = byTask(assignees, "taskId");
  const tasks = (
    db
      .prepare(
        "SELECT id,title,description,projectId,parentTaskId,responsibleContactId,startDate,endDate,status,percentComplete,kind,startTime,endTime,location,timeZone,revision,legacyTags,legacyAssignments FROM Task ORDER BY sortOrder,createdAt,id",
      )
      .all() as Row[]
  ).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description || "",
    project: t.projectId || "",
    parent: t.parentTaskId || null,
    executors: (executors.get(t.id) || []).map((e) => e.contactId),
    responsible: t.responsibleContactId || "",
    start: ymd(t.startDate),
    end: ymd(t.endDate),
    status: t.status,
    percent: t.percentComplete,
    kind: t.kind,
    startTime: t.startTime || "",
    endTime: t.endTime || "",
    location: t.location || "",
    timeZone: t.timeZone,
    revision: t.revision,
    legacyTags: t.legacyTags || "",
    legacyAssignments: t.legacyAssignments || "",
    comments: (notes.get(t.id) || []).map((c) => ({
      id: c.id,
      text: c.body,
      kind: c.kind,
      resolved: !!c.resolved,
      revision: c.revision,
      createdAt: epoch(c.createdAt),
    })),
    attachments: (attachments.get(t.id) || []).map((f) => ({
      id: f.id,
      taskId: f.taskId,
      name: f.name,
      type: f.type,
      size: f.size,
      createdAt: epoch(f.createdAt),
    })),
  }));
  const report = JSON.parse(marker.value) as {
      tasks: number;
      createdParents: number;
      issues: { taskId: string; reason: string; candidates?: string[] }[];
    },
    unassigned = new Set(tasks.filter((t) => !t.project).map((t) => t.id));
  return {
    instanceId: (
      db
        .prepare("SELECT value FROM WorkspaceMeta WHERE key='instance'")
        .get() as Row
    ).value,
    revision: Number(
      (
        db
          .prepare("SELECT value FROM WorkspaceMeta WHERE key='revision'")
          .get() as Row
      ).value,
    ),
    projects,
    contacts,
    tasks,
    session: { id: session.id, name: session.name },
    timeZone: process.env.APP_TIME_ZONE || "Asia/Jerusalem",
    migration: {
      tasks: report.tasks,
      createdParents: report.createdParents,
      unassigned: unassigned.size,
      issues: report.issues.filter((issue: Row) =>
        unassigned.has(issue.taskId),
      ),
    },
  };
}
function saveTask(
  db: Database.Database,
  input: unknown,
  create: boolean,
  session: SessionUser,
) {
  const data = taskInput.parse(input),
    old = row(db, "Task", data.id);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
  if (create && old) {
    if (old.creationFingerprint !== fingerprint)
      throw new WorkspaceError(
        "Задача уже создана, а черновик изменился. Загрузите актуальные данные и сохраните изменения ещё раз.",
        409,
      );
    return;
  } // client-generated id makes a retried create idempotent
  if (!create) {
    if (!old) throw new WorkspaceError("Задача не найдена", 404);
    revision(old, data.revision);
  }
  if (data.end < data.start)
    throw new WorkspaceError("Дата окончания раньше даты начала");
  if (
    data.kind === "event" &&
    data.start === data.end &&
    data.startTime &&
    data.endTime &&
    data.endTime < data.startTime
  )
    throw new WorkspaceError("Время окончания раньше времени начала");
  timezone(data.timeZone);
  let project = data.project || null;
  const parent = data.parent ? requireRow(db, "Task", data.parent) : null;
  if (parent) {
    if (parent.id === data.id || treeIds(db, data.id).includes(parent.id))
      throw new WorkspaceError("Нельзя создать цикл подзадач");
    project = parent.projectId;
  }
  if (project) {
    const p = requireRow(db, "Project", project);
    if (p.archived && p.id !== old?.projectId)
      throw new WorkspaceError("Тема скрыта. Верните её в справочнике.");
  }
  const executorIds = [...new Set(data.executors)];
  for (const key of executorIds) {
    const c = requireRow(db, "Contact", key);
    if (
      c.archived &&
      !db
        .prepare("SELECT 1 FROM TaskExecutor WHERE taskId=? AND contactId=?")
        .get(data.id, key)
    )
      throw new WorkspaceError("Исполнитель скрыт. Верните его в справочнике.");
  }
  if (data.responsible) {
    const c = requireRow(db, "Contact", data.responsible);
    if ((!c.responsible || c.archived) && old?.responsibleContactId !== c.id)
      throw new WorkspaceError(
        "Этот контакт не доступен для нового назначения ответственным",
      );
  }
  const values = [
    data.title,
    data.description,
    sqlDate(data.start),
    sqlDate(data.end),
    data.percent,
    data.status,
    project,
    data.parent || null,
    data.responsible || null,
    data.kind,
    data.startTime || null,
    data.endTime || null,
    data.location || null,
    data.timeZone,
    Date.now(),
  ];
  if (create) {
    db.prepare(
      "INSERT INTO Task(title,description,startDate,endDate,percentComplete,status,projectId,parentTaskId,responsibleContactId,kind,startTime,endTime,location,timeZone,updatedAt,id,createdAt,ownerId,creationFingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(...values, data.id, Date.now(), session.id, fingerprint);
    for (const note of data.comments)
      db.prepare(
        "INSERT INTO TaskComment(id,taskId,authorId,body,kind,resolved,createdAt) VALUES(?,?,?,?,?,0,?)",
      ).run(note.id, data.id, session.id, note.text, note.kind, Date.now());
  } else
    db.prepare(
      "UPDATE Task SET title=?,description=?,startDate=?,endDate=?,percentComplete=?,status=?,projectId=?,parentTaskId=?,responsibleContactId=?,kind=?,startTime=?,endTime=?,location=?,timeZone=?,updatedAt=?,revision=revision+1 WHERE id=?",
    ).run(...values, data.id);
  db.prepare("DELETE FROM TaskExecutor WHERE taskId=?").run(data.id);
  for (const key of executorIds)
    db.prepare("INSERT INTO TaskExecutor(taskId,contactId) VALUES(?,?)").run(
      data.id,
      key,
    );
  if (old && old.projectId !== project) {
    const ids = treeIds(db, data.id);
    for (const key of ids)
      if (key !== data.id)
        db.prepare(
          "UPDATE Task SET projectId=?,updatedAt=?,revision=revision+1 WHERE id=?",
        ).run(project, Date.now(), key);
  }
  syncLegacyNames(db, data.id);
}
const directoryInput = z.object({
  id,
  mode: z.enum(["projects", "contacts", "responsibles"]),
  name: z.string().transform(cleanName).pipe(z.string().min(1).max(200)),
  type: z.enum(["Человек", "Организация", "Группа"]).default("Человек"),
  responsible: z.boolean().default(false),
  revision: z.number().int().min(0).optional(),
});
function saveDirectory(db: Database.Database, input: unknown) {
  const data = directoryInput.parse(input),
    table = data.mode === "projects" ? "Project" : "Contact",
    old = row(db, table, data.id),
    key = nameKey(data.name);
  if (
    db
      .prepare(`SELECT id FROM ${table} WHERE key=? AND id<>?`)
      .get(key, data.id)
  )
    throw new WorkspaceError(
      "Такая запись уже существует. Выберите существующую карточку или объедините записи.",
      409,
    );
  if (
    old &&
    data.revision === undefined &&
    old.name === data.name &&
    (table === "Project" ||
      (old.type === data.type && !!old.responsible === data.responsible))
  )
    return;
  if (old) revision(old, data.revision);
  if (
    table === "Contact" &&
    old?.responsible &&
    !data.responsible &&
    db.prepare("SELECT 1 FROM Task WHERE responsibleContactId=?").get(old.id)
  )
    throw new WorkspaceError(
      "Есть назначения ответственным. Уберите роль с выбором замены.",
    );
  const now = Date.now();
  if (table === "Project") {
    if (old)
      db.prepare(
        "UPDATE Project SET name=?,key=?,updatedAt=?,revision=revision+1 WHERE id=?",
      ).run(data.name, key, now, data.id);
    else
      db.prepare(
        "INSERT INTO Project(id,name,key,createdAt,updatedAt) VALUES(?,?,?,?,?)",
      ).run(data.id, data.name, key, now, now);
  } else {
    if (old)
      db.prepare(
        "UPDATE Contact SET name=?,key=?,type=?,responsible=?,updatedAt=?,revision=revision+1 WHERE id=?",
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
    for (const t of db
      .prepare(
        "SELECT id FROM Task WHERE responsibleContactId=? OR id IN (SELECT taskId FROM TaskExecutor WHERE contactId=?)",
      )
      .all(data.id, data.id) as Row[])
      syncLegacyNames(db, t.id);
  }
}
function removeDirectory(db: Database.Database, input: Row) {
  const mode = z
      .enum(["projects", "contacts", "responsibles"])
      .parse(input.mode),
    key = id.parse(input.id),
    replacement = input.replacement ? id.parse(input.replacement) : null,
    table = mode === "projects" ? "Project" : "Contact",
    old = row(db, table, key);
  if (!old) return;
  if (
    mode === "responsibles" &&
    !old.responsible &&
    !db.prepare("SELECT 1 FROM Task WHERE responsibleContactId=?").get(key)
  )
    return;
  revision(old, input.revision);
  if (replacement === key)
    throw new WorkspaceError("Выберите другую запись для замены");
  const target = replacement ? requireRow(db, table, replacement) : null;
  if (target?.archived) throw new WorkspaceError("Запись для замены скрыта");
  if (table === "Project") {
    db.prepare(
      "UPDATE Task SET projectId=?,updatedAt=?,revision=revision+1 WHERE projectId=?",
    ).run(replacement, Date.now(), key);
    db.prepare("DELETE FROM Project WHERE id=?").run(key);
    return;
  }
  const affected = db
    .prepare(
      "SELECT id FROM Task WHERE responsibleContactId=? OR id IN (SELECT taskId FROM TaskExecutor WHERE contactId=?)",
    )
    .all(key, key) as Row[];
  if (
    target &&
    !target.responsible &&
    db.prepare("SELECT 1 FROM Task WHERE responsibleContactId=?").get(key)
  )
    throw new WorkspaceError("Выберите замену из ответственных");
  db.prepare(
    "UPDATE Task SET responsibleContactId=?,updatedAt=?,revision=revision+1 WHERE responsibleContactId=?",
  ).run(replacement, Date.now(), key);
  if (mode === "contacts") {
    if (replacement)
      db.prepare(
        "INSERT OR IGNORE INTO TaskExecutor(taskId,contactId) SELECT taskId,? FROM TaskExecutor WHERE contactId=?",
      ).run(replacement, key);
    db.prepare("DELETE FROM TaskExecutor WHERE contactId=?").run(key);
    db.prepare("DELETE FROM Contact WHERE id=?").run(key);
  } else
    db.prepare(
      "UPDATE Contact SET responsible=0,updatedAt=?,revision=revision+1 WHERE id=?",
    ).run(Date.now(), key);
  for (const t of affected) {
    syncLegacyNames(db, t.id);
    db.prepare(
      "UPDATE Task SET revision=revision+1,updatedAt=? WHERE id=?",
    ).run(Date.now(), t.id);
  }
}
export function workspaceAction(
  db: Database.Database,
  session: SessionUser,
  input: unknown,
) {
  const envelope = z
      .object({
        action: z.string().max(50),
        data: z.record(z.string(), z.unknown()),
      })
      .parse(input),
    data = envelope.data as Row;
  return db
    .transaction(() => {
      switch (envelope.action) {
        case "createTask":
          saveTask(db, data, true, session);
          break;
        case "saveTask":
          saveTask(db, data, false, session);
          break;
        case "deleteTask": {
          const task = row(db, "Task", id.parse(data.id));
          if (!task) break;
          revision(task, data.revision);
          db.prepare(
            "UPDATE Task SET parentTaskId=?,updatedAt=?,revision=revision+1 WHERE parentTaskId=?",
          ).run(task.parentTaskId, Date.now(), task.id);
          db.prepare("DELETE FROM Task WHERE id=?").run(task.id);
          break;
        }
        case "saveDirectory":
          saveDirectory(db, data);
          break;
        case "makeResponsible": {
          const c = requireRow(db, "Contact", id.parse(data.id));
          if (c.responsible && !c.archived) break;
          revision(c, data.revision);
          if (c.archived) throw new WorkspaceError("Контакт скрыт");
          db.prepare(
            "UPDATE Contact SET responsible=1,revision=revision+1,updatedAt=? WHERE id=?",
          ).run(Date.now(), c.id);
          break;
        }
        case "hideDirectory": {
          const mode = z
            .enum(["projects", "contacts", "responsibles"])
            .parse(data.mode);
          const table = mode === "projects" ? "Project" : "Contact",
            entry = requireRow(db, table, id.parse(data.id));
          if (!!entry.archived === data.archived) break;
          revision(entry, data.revision);
          db.prepare(
            `UPDATE ${table} SET archived=?,revision=revision+1,updatedAt=? WHERE id=?`,
          ).run(Number(z.boolean().parse(data.archived)), Date.now(), entry.id);
          break;
        }
        case "removeDirectory":
          removeDirectory(db, data);
          break;
        case "addNote": {
          const note = z
            .object({
              id,
              taskId: id,
              text: z.string().trim().min(1).max(100000),
              kind: z.enum(["comment", "question"]),
            })
            .parse(data);
          requireRow(db, "Task", note.taskId);
          const old = row(db, "TaskComment", note.id);
          if (old) {
            if (
              old.taskId !== note.taskId ||
              old.body !== note.text ||
              old.kind !== note.kind
            )
              throw new WorkspaceError("Идентификатор записи занят", 409);
            break;
          }
          db.prepare(
            "INSERT INTO TaskComment(id,taskId,authorId,body,kind,resolved,createdAt) VALUES(?,?,?,?,?,0,?)",
          ).run(
            note.id,
            note.taskId,
            session.id,
            note.text,
            note.kind,
            Date.now(),
          );
          break;
        }
        case "resolveNote": {
          const note = requireRow(db, "TaskComment", id.parse(data.id));
          if (!!note.resolved === data.resolved) break;
          revision(note, data.revision);
          if (note.kind !== "question")
            throw new WorkspaceError("Эта запись не является вопросом");
          db.prepare(
            "UPDATE TaskComment SET resolved=?,revision=revision+1 WHERE id=?",
          ).run(Number(z.boolean().parse(data.resolved)), note.id);
          break;
        }
        default:
          throw new WorkspaceError("Неизвестная операция");
      }
      touch(db);
      return workspaceSnapshot(db, session);
    })
    .immediate();
}
