import type Database from "better-sqlite3";
import ExcelJS from "exceljs";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import classification from "../../config/tag-classification.json";
import { ID, createImportedItem, type Row } from "./service";
import {
  cleanName,
  nameKey,
  tokens,
  touch,
  WorkspaceError,
} from "../workspace/database";
import type { SessionUser } from "../session";
const sha = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const typeMap: Record<string, string> = {
  "Рабочая задача": "task",
  Мероприятие: "event",
  Подготовка: "preparation",
  Вопрос: "question",
  Заметка: "note",
};
const sourceSchema = z.object({
  format: z.literal("task-gantt-review/v1"),
  snapshotId: ID,
  records: z.object({
    Task: z.array(z.record(z.string(), z.unknown())).max(10000),
    TaskComment: z.array(z.record(z.string(), z.unknown())).default([]),
    Project: z.array(z.record(z.string(), z.unknown())).default([]),
    Contact: z.array(z.record(z.string(), z.unknown())).default([]),
    TaskExecutor: z.array(z.record(z.string(), z.unknown())).default([]),
    User: z.array(z.record(z.string(), z.unknown())).default([]),
    Attachment: z.array(z.record(z.string(), z.unknown())).default([]),
  }),
  reviewOrder: z.array(ID),
});
function checkZip(bytes: Buffer) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw new WorkspaceError("Некорректный файл Excel");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new WorkspaceError("Не удалось прочитать Excel");
  const count = bytes.readUInt16LE(end + 10);
  if (count > 10000) throw new WorkspaceError("Слишком сложный файл Excel");
  let offset = bytes.readUInt32LE(end + 16),
    total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new WorkspaceError("Повреждён архив Excel");
    total += bytes.readUInt32LE(offset + 24);
    if (total > 100 * 1024 * 1024)
      throw new WorkspaceError("Файл Excel слишком велик после распаковки");
    offset +=
      46 +
      bytes.readUInt16LE(offset + 28) +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
  }
}
function cell(row: ExcelJS.Row, col: number) {
  const value = row.getCell(col).value;
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number")
    return String(value).trim();
  throw new WorkspaceError(
    "В редактируемых полях используйте обычный текст или номер.",
  );
}
export async function readReview(dataJson: string, workbookBytes: Buffer) {
  const source = sourceSchema.parse(JSON.parse(dataJson)) as any;
  const taskIds = new Set(source.records.Task.map((t: Row) => ID.parse(t.id)));
  if (
    taskIds.size !== source.records.Task.length ||
    source.reviewOrder.length !== taskIds.size ||
    new Set(source.reviewOrder).size !== taskIds.size ||
    source.reviewOrder.some((id: string) => !taskIds.has(id))
  )
    throw new WorkspaceError("Нарушены ID исходной выгрузки");
  checkZip(workbookBytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBytes as never);
  const meta = workbook.getWorksheet("_meta"),
    sheet = workbook.getWorksheet("Отбор задач");
  if (!meta || !sheet)
    throw new WorkspaceError(
      "Выберите tasks-review.xlsx из подготовленной выгрузки",
    );
  const values = new Map<string, string>();
  meta.eachRow((row) => values.set(cell(row, 1), cell(row, 2)));
  if (
    values.get("snapshotId") !== source.snapshotId ||
    values.get("dataSha256") !== sha(dataJson)
  )
    throw new WorkspaceError(
      "Excel и data.json относятся к разным выгрузкам. Выберите исходную папку этого Excel.",
    );
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((c, i) => headers.set(String(c.value), i));
  for (const header of ["№", "ID", "Решение", "Тип после переноса"])
    if (!headers.has(header))
      throw new WorkspaceError(
        "В Excel отсутствует служебная колонка " + header,
      );
  const read = (row: ExcelJS.Row, name: string) =>
    headers.has(name) ? cell(row, headers.get(name)!) : "";
  const rows: Row[] = [],
    seen = new Set<string>();
  const numbers = new Map<string, number>(
    source.reviewOrder.map((id: string, i: number) => [id, i + 1]),
  );
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i),
      id = read(row, "ID");
    if (!id && !read(row, "Название") && !read(row, "Решение")) continue;
    if (!taskIds.has(id) || seen.has(id))
      throw new WorkspaceError(
        "Неизвестный или повторяющийся ID в строке " + i,
      );
    seen.add(id);
    if (Number(read(row, "№")) !== numbers.get(id))
      throw new WorkspaceError(
        "Не меняйте служебный номер задачи № " + numbers.get(id),
      );
    const decision = read(row, "Решение");
    if (!["Оставить", "Удалить"].includes(decision))
      throw new WorkspaceError(
        "Выберите Оставить или Удалить для задачи № " + numbers.get(id),
      );
    const kind = typeMap[read(row, "Тип после переноса")];
    if (!kind)
      throw new WorkspaceError(
        "Выберите тип после переноса для задачи № " + numbers.get(id),
      );
    const parent = read(row, "Новый родитель №");
    if (
      parent &&
      (!/^\d+$/.test(parent) || Number(parent) > source.reviewOrder.length)
    )
      throw new WorkspaceError(
        "Неверный номер нового родителя для задачи № " + numbers.get(id),
      );
    rows.push({
      id,
      number: numbers.get(id),
      keep: decision === "Оставить",
      kind,
      newTitle: read(row, "Новое название"),
      newProject: read(row, "Новая тема"),
      newParent: parent === "" ? null : Number(parent),
      comment: read(row, "Комментарий"),
    });
  }
  if (seen.size !== taskIds.size)
    throw new WorkspaceError(
      "В Excel удалены строки. Верните их из исходного Excel и отметьте «Удалить» в колонке Решение.",
    );
  rows.sort((a, b) => a.number - b.number);
  const digest = sha(JSON.stringify({ data: sha(dataJson), rows }));
  return { source, rows, digest };
}
function dates(value: unknown) {
  if (value == null || value === "") return "";
  const n = Number(value),
    d = new Date(Number.isFinite(n) ? n : String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}
function makePlan(source: Row, rows: Row[]) {
  const original = new Map<string, Row>(
      source.records.Task.map((t: Row) => [t.id, t]),
    ),
    review = new Map<string, Row>(rows.map((r) => [r.id, r])),
    kept = rows.filter((r) => r.keep),
    warnings: string[] = [];
  const parentOf = (id: string) => {
    const r = review.get(id)!,
      raw = original.get(id)!;
    return r.newParent === null
      ? raw.parentTaskId || null
      : r.newParent === 0
        ? null
        : source.reviewOrder[r.newParent - 1];
  };
  const ancestor = (id: string, predicate: (row: Row) => boolean) => {
    const seen = new Set<string>([id]);
    let p = parentOf(id);
    while (p) {
      if (seen.has(p))
        throw new WorkspaceError(
          "Цикл родителей в Excel у задачи № " + review.get(id)!.number,
        );
      seen.add(p);
      const row = review.get(p);
      if (!row)
        throw new WorkspaceError(
          "Не найден родитель задачи № " + review.get(id)!.number,
        );
      if (row.keep && predicate(row)) return p;
      p = parentOf(p);
    }
    return null;
  };
  // Validate the whole input forest before selecting the nearest retained parent.
  for (const row of kept) {
    const seen = new Set<string>();
    for (let id: string | null = row.id; id; id = parentOf(id)) {
      if (seen.has(id))
        throw new WorkspaceError(
          "Цикл родителей в Excel у задачи № " + row.number,
        );
      if (!review.has(id))
        throw new WorkspaceError("Не найден родитель задачи № " + row.number);
      seen.add(id);
    }
  }
  const plans = kept.map<Row>((row) => {
    const old = original.get(row.id)!,
      workParent =
        row.kind === "task" ? ancestor(row.id, (r) => r.kind === "task") : null,
      eventParent =
        row.kind === "event"
          ? ancestor(row.id, (r) => r.kind === "event")
          : null,
      activity = ancestor(row.id, (r) => r.kind === "event"),
      agendaParent = !["task", "event"].includes(row.kind)
        ? ancestor(
            row.id,
            (r) =>
              !["task", "event"].includes(r.kind) &&
              ancestor(r.id, (a) => a.kind === "event") === activity,
          )
        : null;
    if (!["task", "event"].includes(row.kind) && !activity)
      throw new WorkspaceError(
        "Для пункта № " +
          row.number +
          " выберите родителя-мероприятие в колонке «Новый родитель №».",
      );
    if (old.parentTaskId && review.get(old.parentTaskId)?.keep === false)
      warnings.push(
        "№ " +
          row.number +
          ": прежний родитель удалён, запись будет сохранена отдельно или под ближайшим оставленным родителем.",
      );
    const project =
      row.newProject ||
      source.records.Project.find((p: Row) => p.id === old.projectId)?.name ||
      "";
    return {
      ...row,
      old,
      title: row.newTitle || old.title,
      projectName: project,
      parentId: workParent || eventParent || agendaParent,
      activityId: activity,
    };
  });
  const byId = new Map<string, Row>(plans.map((p) => [p.id, p]));
  for (const p of plans)
    if (p.kind === "task" && p.parentId) {
      const parent = byId.get(p.parentId)!;
      if (
        p.newProject &&
        parent.projectName &&
        nameKey(p.newProject) !== nameKey(parent.projectName)
      )
        throw new WorkspaceError(
          "У задачи № " +
            p.number +
            " тема отличается от темы выбранного рабочего родителя.",
        );
    }
  const files: {
    id: string;
    taskId: string;
    name: string;
    type: string;
    size: number;
    sha256: string;
    relative: string;
  }[] = source.records.Attachment.filter((f: Row) => byId.has(f.taskId)).map(
    (f: Row) => ({
      id: ID.parse(f.id),
      taskId: f.taskId,
      name: String(f.name),
      type: String(f.type || "application/octet-stream"),
      size: Number(f.size),
      sha256: String(f.sha256),
      relative: String(f.relative),
    }),
  );
  for (const file of files)
    if (
      !/^files\/[a-f0-9]{32}\.[a-zA-Z0-9]+$/.test(file.relative) ||
      !Number.isInteger(file.size) ||
      file.size <= 0 ||
      file.size > 20 * 1024 * 1024 ||
      !/^\w{64}$/.test(file.sha256)
    )
      throw new WorkspaceError("Некорректные сведения о вложении");
  return {
    plans,
    warnings,
    files,
    counts: {
      total: rows.length,
      kept: kept.length,
      removed: rows.length - kept.length,
      tasks: plans.filter((p) => p.kind === "task").length,
      events: plans.filter((p) => p.kind === "event").length,
      points: plans.filter((p) => !["task", "event"].includes(p.kind)).length,
      files: files.length,
    },
  };
}
export async function previewReview(
  db: Database.Database,
  user: SessionUser,
  dataJson: string,
  workbook: Buffer,
) {
  const { source, rows, digest } = await readReview(dataJson, workbook),
    plan = makePlan(source, rows);
  const prior = db
    .prepare("SELECT * FROM ReviewImport WHERE snapshotId=?")
    .get(source.snapshotId) as Row | undefined;
  if (prior) {
    if (prior.digest !== digest)
      throw new WorkspaceError(
        "Эта выгрузка уже импортирована с другим отбором. Текущие записи не перезаписаны.",
        409,
      );
    return {
      completed: true,
      token: null,
      result: JSON.parse(prior.result),
      ...plan.counts,
      warnings: plan.warnings,
      files: [],
    };
  }
  for (const item of plan.plans)
    if (db.prepare("SELECT 1 FROM ContentItem WHERE id=?").get(item.id))
      throw new WorkspaceError(
        "В новой базе уже есть задача с ID из этой выгрузки. Импорт остановлен без изменений.",
        409,
      );
  const token = randomUUID();
  db.prepare("DELETE FROM ImportDraft WHERE createdAt<?").run(
    Date.now() - 86400000,
  );
  db.prepare(
    "INSERT INTO ImportDraft(id,userId,snapshotId,digest,sourceJson,reviewJson,createdAt) VALUES(?,?,?,?,?,?,?)",
  ).run(
    token,
    user.id,
    source.snapshotId,
    digest,
    dataJson,
    JSON.stringify(rows),
    Date.now(),
  );
  return {
    token,
    completed: false,
    snapshotId: source.snapshotId,
    ...plan.counts,
    warnings: plan.warnings,
    files: plan.files.map((f) => ({
      id: f.id,
      name: f.name,
      relative: f.relative,
      size: f.size,
    })),
    items: plan.plans.map((p) => ({
      number: p.number,
      title: p.title,
      kind: p.kind,
      project: p.projectName,
      parentId: p.parentId,
    })),
  };
}
function draft(db: Database.Database, user: SessionUser, token: string) {
  const row = db
    .prepare("SELECT * FROM ImportDraft WHERE id=? AND userId=?")
    .get(ID.parse(token), user.id) as Row | undefined;
  if (!row)
    throw new WorkspaceError(
      "Предпросмотр импорта устарел. Выберите файлы заново.",
      404,
    );
  return row;
}
export function stageImportFile(
  db: Database.Database,
  user: SessionUser,
  token: string,
  sourceId: string,
  bytes: Buffer,
) {
  const r = draft(db, user, token),
    source = JSON.parse(r.sourceJson),
    plan = makePlan(source, JSON.parse(r.reviewJson)),
    file = plan.files.find((f) => f.id === sourceId);
  if (!file || bytes.length !== file.size || sha(bytes) !== file.sha256)
    throw new WorkspaceError(
      "Файл не совпадает с исходным вложением. Выберите папку этой выгрузки.",
    );
  db.prepare(
    "INSERT INTO ImportDraftFile(draftId,sourceId,data,sha256) VALUES(?,?,?,?) ON CONFLICT(draftId,sourceId) DO NOTHING",
  ).run(token, sourceId, bytes, file.sha256);
  return { ok: true };
}
export function applyReview(
  db: Database.Database,
  user: SessionUser,
  token: string,
) {
  return db
    .transaction(() => {
      const r = draft(db, user, token),
        source = JSON.parse(r.sourceJson),
        rows = JSON.parse(r.reviewJson),
        plan = makePlan(source, rows);
      const prior = db
        .prepare("SELECT * FROM ReviewImport WHERE snapshotId=?")
        .get(source.snapshotId) as Row | undefined;
      if (prior) {
        if (prior.digest !== r.digest)
          throw new WorkspaceError(
            "Эта выгрузка уже импортирована с другим отбором",
            409,
          );
        return JSON.parse(prior.result);
      }
      for (const f of plan.files)
        if (
          !db
            .prepare(
              "SELECT 1 FROM ImportDraftFile WHERE draftId=? AND sourceId=? AND sha256=?",
            )
            .get(token, f.id, f.sha256)
        )
          throw new WorkspaceError(
            "Не загружен файл «" +
              f.name +
              "». Дождитесь загрузки всех вложений.",
          );
      const now = Date.now(),
        contactMap = new Map<string, string>();
      const aliases = new Map(
        Object.entries(classification.contactAliases).map(([a, b]) => [
          nameKey(a),
          b,
        ]),
      );
      const excluded = new Set(classification.excludedContacts.map(nameKey));
      const contact = (
        name: string,
        preferred?: string,
        responsible = false,
        type = "Человек",
      ) => {
        name = aliases.get(nameKey(name)) || cleanName(name);
        if (!name || excluded.has(nameKey(name))) return "";
        let c = db
          .prepare("SELECT * FROM Contact WHERE key=?")
          .get(nameKey(name)) as Row | undefined;
        if (!c) {
          const id =
            preferred &&
            !db.prepare("SELECT 1 FROM Contact WHERE id=?").get(preferred)
              ? preferred
              : randomUUID();
          db.prepare(
            "INSERT INTO Contact(id,name,key,type,responsible,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)",
          ).run(
            id,
            name,
            nameKey(name),
            ["Человек", "Организация", "Группа"].includes(type)
              ? type
              : "Человек",
            Number(responsible),
            now,
            now,
          );
          c = { id };
        }
        if (responsible)
          db.prepare("UPDATE Contact SET responsible=1 WHERE id=?").run(c.id);
        return c.id;
      };
      for (const c of source.records.Contact)
        contactMap.set(
          c.id,
          contact(String(c.name), c.id, !!c.responsible, c.type),
        );
      const topic = (name: string) => {
        name = cleanName(name);
        if (!name) return "";
        let p = db
          .prepare("SELECT id FROM Project WHERE key=?")
          .get(nameKey(name)) as Row | undefined;
        if (!p) {
          p = { id: randomUUID() };
          const old = source.records.Project.find(
            (p: Row) => nameKey(p.name) === nameKey(name),
          );
          db.prepare(
            "INSERT INTO Project(id,name,key,description,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
          ).run(p.id, name, nameKey(name), old?.description || "", now, now);
        }
        return p.id;
      };
      const taskMap = new Map<string, Row>(plan.plans.map((p) => [p.id, p])),
        pending = new Set<string>(plan.plans.map((p) => p.id)),
        created = new Set<string>();
      while (pending.size) {
        let progress = false;
        for (const id of [...pending]) {
          const p = taskMap.get(id)!,
            dependencies = [
              p.parentId,
              ...(!["task", "event"].includes(p.kind) ? [p.activityId] : []),
            ].filter(Boolean);
          if (dependencies.some((d) => pending.has(d))) continue;
          const old = p.old;
          const sourceExecutors = source.records.TaskExecutor.filter(
            (e: Row) => e.taskId === id,
          )
            .map((e: Row) => contactMap.get(e.contactId))
            .filter(Boolean);
          const fallback = (value: unknown) =>
            tokens(value)
              .map((name) => contact(name))
              .filter(Boolean);
          const executors = sourceExecutors.length
            ? sourceExecutors
            : fallback(
                old.executorName ||
                  source.records.User.find((u: Row) => u.id === old.executorId)
                    ?.name,
              );
          const responsible =
            contactMap.get(old.responsibleContactId) ||
            fallback(
              old.responsibleName ||
                source.records.User.find((u: Row) => u.id === old.responsibleId)
                  ?.name,
            )[0] ||
            "";
          if (responsible)
            db.prepare("UPDATE Contact SET responsible=1 WHERE id=?").run(
              responsible,
            );
          const parent = p.parentId ? taskMap.get(p.parentId) : null;
          if (
            p.kind === "task" &&
            parent?.kind === "task" &&
            parent.projectName &&
            p.projectName &&
            nameKey(parent.projectName) !== nameKey(p.projectName)
          ) {
            p.parentId = null;
            plan.warnings.push(
              "№ " +
                p.number +
                ": сохранена отдельная тема, рабочая задача размещена в корне темы.",
            );
          }
          createImportedItem(
            db,
            user,
            {
              id,
              kind: p.kind,
              title: p.title,
              description: old.description || "",
              project: p.kind === "task" ? topic(p.projectName) : "",
              topics:
                p.kind === "event" && p.projectName
                  ? [topic(p.projectName)]
                  : [],
              parent: p.parentId,
              activityId: ["task", "event"].includes(p.kind)
                ? null
                : p.activityId,
              executors,
              responsible,
              tags: tokens(old.tags),
              start: dates(old.startDate),
              end: dates(old.endDate),
              startTime: old.startTime || "",
              endTime: old.endTime || "",
              timeZone: old.timeZone || "Asia/Jerusalem",
              location: old.location || "",
              status: ["PLANNED", "IN_PROGRESS", "PAUSED", "DONE"].includes(
                old.status,
              )
                ? old.status
                : "PLANNED",
              percent: Math.min(
                100,
                Math.max(0, Number(old.percentComplete) || 0),
              ),
            },
            { ...old, reviewComment: p.comment },
          );
          pending.delete(id);
          created.add(id);
          progress = true;
        }
        if (!progress)
          throw new WorkspaceError(
            "Не удалось разрешить связи родителей. Проверьте выбранные типы и родителей.",
          );
      }
      for (const p of plan.plans)
        if (p.kind === "task" && p.activityId && created.has(p.activityId)) {
          const ref = createHash("sha256")
            .update(source.snapshotId + "\0" + p.id + "\0" + p.activityId)
            .digest("hex");
          createImportedItem(db, user, {
            id: ref,
            kind: "reference",
            title: p.title,
            activityId: p.activityId,
            linkedTaskId: p.id,
            description: p.old.description || "",
          });
          db.prepare(
            "INSERT INTO ItemContact(itemId,contactId,role) SELECT ?,contactId,role FROM ItemContact WHERE itemId=?",
          ).run(ref, p.id);
        }
      for (const p of plan.plans) {
        const parent = p.parentId ? taskMap.get(p.parentId) : null;
        if (
          p.kind === "task" &&
          parent?.kind === "task" &&
          p.activityId &&
          p.activityId === parent.activityId
        ) {
          const ref = (id: string) =>
            createHash("sha256")
              .update(source.snapshotId + "\0" + id + "\0" + p.activityId)
              .digest("hex");
          db.prepare("UPDATE ContentItem SET parentId=? WHERE id=?").run(
            ref(parent.id),
            ref(p.id),
          );
        }
      }
      for (const n of source.records.TaskComment)
        if (created.has(n.taskId)) {
          const id = ID.parse(n.id);
          if (db.prepare("SELECT 1 FROM ContentNote WHERE id=?").get(id))
            throw new WorkspaceError("Комментарий уже существует", 409);
          const author =
            source.records.User.find((u: Row) => u.id === n.authorId)?.name ||
            "";
          const authorId = db
            .prepare("SELECT 1 FROM User WHERE id=?")
            .get(n.authorId)
            ? n.authorId
            : null;
          db.prepare(
            "INSERT INTO ContentNote(id,body,kind,resolved,authorId,authorName,createdAt) VALUES(?,?,?,?,?,?,?)",
          ).run(
            id,
            String(n.body || ""),
            n.kind === "question" ? "question" : "comment",
            Number(!!n.resolved),
            authorId,
            author,
            typeof n.createdAt === "number"
              ? n.createdAt
              : new Date(n.createdAt).getTime() || now,
          );
          db.prepare("INSERT INTO ItemNote(itemId,noteId) VALUES(?,?)").run(
            n.taskId,
            id,
          );
        }
      for (const f of plan.files) {
        const asset = db
          .prepare(
            "SELECT data FROM ImportDraftFile WHERE draftId=? AND sourceId=?",
          )
          .get(token, f.id) as Row;
        const existing = db
          .prepare("SELECT sha256 FROM ContentFile WHERE id=?")
          .get(f.id) as Row | undefined;
        if (existing && existing.sha256 !== f.sha256)
          throw new WorkspaceError("Идентификатор файла уже используется", 409);
        if (!existing)
          db.prepare(
            "INSERT INTO ContentFile(id,name,type,size,data,sha256,createdAt) VALUES(?,?,?,?,?,?,?)",
          ).run(f.id, f.name, f.type, f.size, asset.data, f.sha256, now);
        db.prepare("INSERT INTO ItemFile(itemId,fileId) VALUES(?,?)").run(
          f.taskId,
          f.id,
        );
      }
      touch(db);
      const result = {
        ...plan.counts,
        warnings: plan.warnings,
        snapshotId: source.snapshotId,
        completed: true,
      };
      db.prepare(
        "INSERT INTO ReviewImport(snapshotId,digest,result,createdAt) VALUES(?,?,?,?)",
      ).run(source.snapshotId, r.digest, JSON.stringify(result), now);
      db.prepare("DELETE FROM ImportDraftFile WHERE draftId=?").run(token);
      return result;
    })
    .immediate();
}
