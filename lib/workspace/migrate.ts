import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import classification from "../../config/tag-classification.json";
import { cleanName, nameKey, tokens, touch } from "./database";

type Row = Record<string, any>;
export type MigrationReport = {
  version: number;
  migratedAt: string;
  tasks: number;
  createdParents: number;
  issues: { taskId: string; reason: string; candidates?: string[] }[];
};
export function migrateWorkspace(db: Database.Database): MigrationReport {
  const previous = db
    .prepare("SELECT value FROM WorkspaceMeta WHERE key='classification-v1'")
    .get() as { value: string } | undefined;
  if (previous) return JSON.parse(previous.value);
  return db
    .transaction(() => {
      const now = Date.now(),
        issues: { taskId: string; reason: string; candidates?: string[] }[] =
          [];
      const rules = new Map(
        classification.tags.map((t) => [nameKey(t.sourceTag), t]),
      );
      const excluded = new Set(classification.excludedContacts.map(nameKey));
      const aliases = new Map(
        Object.entries(classification.contactAliases).map(([a, b]) => [
          nameKey(a),
          b,
        ]),
      );
      const responsibleKeys = new Set(classification.responsibles.map(nameKey));
      const contactType = (name: string) =>
        ["алкур", "словакия-инвест", "бух словакия", "beeli"].includes(
          nameKey(name),
        )
          ? "Организация"
          : nameKey(name) === "архитекторы"
            ? "Группа"
            : "Человек";
      const contact = (input: string) => {
        const name = aliases.get(nameKey(input)) || cleanName(input);
        if (!name || excluded.has(nameKey(name))) return null;
        const existing = db
          .prepare("SELECT id FROM Contact WHERE key=?")
          .get(nameKey(name)) as { id: string } | undefined;
        if (existing) return existing.id;
        const id = randomUUID();
        db.prepare(
          "INSERT INTO Contact(id,name,key,type,responsible,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)",
        ).run(
          id,
          name,
          nameKey(name),
          contactType(name),
          Number(responsibleKeys.has(nameKey(name))),
          now,
          now,
        );
        return id;
      };
      for (const rule of classification.tags.filter(
        (t) => t.category === "project",
      ))
        db.prepare(
          "INSERT OR IGNORE INTO Project(id,name,key,color,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
        ).run(randomUUID(), rule.name, nameKey(rule.name), "#7ba0df", now, now);
      for (const rule of classification.tags.filter(
        (t) => t.category === "counterparty",
      ))
        contact(rule.name);
      for (const name of classification.responsibles) contact(name);
      const projects = new Map(
        (db.prepare("SELECT id,key FROM Project").all() as Row[]).map((p) => [
          p.key,
          p.id as string,
        ]),
      );
      const rows = db
        .prepare(
          "SELECT t.*,e.name AS oldExecutor,r.name AS oldResponsible FROM Task t LEFT JOIN User e ON e.id=t.executorId LEFT JOIN User r ON r.id=t.responsibleId ORDER BY t.sortOrder,t.createdAt,t.id",
        )
        .all() as Row[];
      const byId = new Map(rows.map((t) => [t.id, t]));
      // Break only an invalid edge, keeping every record and all dependent content.
      for (const t of rows) {
        const seen = new Set<string>([t.id]);
        let current = t;
        while (current.parentTaskId) {
          const parent = current.parentTaskId;
          if (seen.has(parent) || !byId.has(parent)) {
            db.prepare("UPDATE Task SET parentTaskId=NULL WHERE id=?").run(
              current.id,
            );
            current.parentTaskId = null;
            issues.push({
              taskId: current.id,
              reason: "Проверить прежнюю связь с родительской задачей",
            });
            break;
          }
          seen.add(parent);
          current = byId.get(parent)!;
        }
      }
      const taskTags = new Map(rows.map((t) => [t.id, tokens(t.tags)]));
      const projectTags = (t: Row) => [
        ...new Set(
          (taskTags.get(t.id) || [])
            .map((tag) => rules.get(nameKey(tag)))
            .filter((rule) => rule?.category === "project")
            .map((rule) => projects.get(nameKey(rule!.name))!),
        ),
      ];
      const roots = new Map<string, Row[]>();
      for (const t of rows) {
        let root = t;
        while (root.parentTaskId) root = byId.get(root.parentTaskId)!;
        const group = roots.get(root.id) || [];
        group.push(t);
        roots.set(root.id, group);
      }
      for (const [rootId, branch] of roots) {
        const root = byId.get(rootId)!,
          own = projectTags(root),
          all = [...new Set(branch.flatMap(projectTags))],
          choices = own.length ? own : all;
        const project = choices.length === 1 ? choices[0] : null;
        if (choices.length > 1)
          issues.push({
            taskId: rootId,
            reason: "Ветка имеет несколько тем: выберите одну для всей ветки",
            candidates: choices,
          });
        for (const t of branch) {
          if (project && projectTags(t).some((id) => id !== project))
            issues.push({
              taskId: t.id,
              reason: "Старые темы подзадачи отличаются от темы родителя",
              candidates: projectTags(t),
            });
          db.prepare(
            "UPDATE Task SET projectId=?,legacyTags=COALESCE(legacyTags,tags),tags=?,kind=? WHERE id=?",
          ).run(
            project,
            (taskTags.get(t.id) || [])
              .filter((tag) => !rules.has(nameKey(tag)))
              .join(",") || null,
            (taskTags.get(t.id) || []).some(
              (tag) => rules.get(nameKey(tag))?.category === "event",
            ) ||
              /^(встреч[аи]|совещан|командиров|звонок|поездк)/iu.test(t.title)
              ? "event"
              : "task",
            t.id,
          );
          t.projectId = project;
        }
      }
      for (const policy of db
        .prepare(
          "SELECT value FROM NamePolicy WHERE field IN ('executorName','responsibleName')",
        )
        .all() as Row[])
        for (const name of tokens(policy.value)) contact(name);
      for (const t of rows) {
        const executorNames = tokens(t.executorName || t.oldExecutor),
          responsibleNames = tokens(t.responsibleName || t.oldResponsible);
        const tagContacts = (taskTags.get(t.id) || [])
          .map((tag) => rules.get(nameKey(tag)))
          .filter((r) => r?.category === "counterparty")
          .map((r) => r!.name);
        for (const name of tagContacts) contact(name);
        const executors = [
          ...new Set(
            [...executorNames, ...tagContacts].map(contact).filter(Boolean),
          ),
        ] as string[];
        const taggedResponsible = [
          ...new Set(
            tagContacts.filter((n) => responsibleKeys.has(nameKey(n))),
          ),
        ];
        const previousEligible = responsibleNames.some((n) =>
          responsibleKeys.has(nameKey(aliases.get(nameKey(n)) || n)),
        );
        const responsible = (
          taggedResponsible.length === 1 && !previousEligible
            ? taggedResponsible
            : responsibleNames
        )
          .map(contact)
          .filter(Boolean) as string[];
        if (taggedResponsible.length > 1)
          issues.push({
            taskId: t.id,
            reason:
              "В старых тегах несколько возможных ответственных: выберите одного",
          });
        db.prepare("UPDATE Task SET legacyAssignments=? WHERE id=?").run(
          JSON.stringify({
            executorName: t.executorName,
            responsibleName: t.responsibleName,
            executorId: t.executorId,
            responsibleId: t.responsibleId,
          }),
          t.id,
        );
        if (responsible.length > 1)
          issues.push({
            taskId: t.id,
            reason:
              "В прежнем поле ответственного указано несколько контактов; сохранён первый",
          });
        for (const id of executors)
          db.prepare(
            "INSERT OR IGNORE INTO TaskExecutor(taskId,contactId) VALUES(?,?)",
          ).run(t.id, id);
        db.prepare(
          "UPDATE Task SET responsibleContactId=?,executorName=?,responsibleName=?,executorId=?,responsibleId=? WHERE id=?",
        ).run(
          responsible[0] || null,
          executors
            .map(
              (id) =>
                (
                  db
                    .prepare("SELECT name FROM Contact WHERE id=?")
                    .get(id) as Row
                ).name,
            )
            .join(", ") || null,
          responsible[0]
            ? (
                db
                  .prepare("SELECT name FROM Contact WHERE id=?")
                  .get(responsible[0]) as Row
              ).name
            : null,
          executorNames.some((n) => excluded.has(nameKey(n))) ||
            excluded.has(nameKey(t.oldExecutor || ""))
            ? null
            : t.executorId,
          responsibleNames.some((n) => excluded.has(nameKey(n))) ||
            excluded.has(nameKey(t.oldResponsible || ""))
            ? null
            : t.responsibleId,
          t.id,
        );
      }
      // Labels become parents only when an existing root can be grouped unambiguously.
      let groups = 0;
      const labels = classification.tags
        .filter((t) => t.category === "task" || t.category === "event")
        .sort(
          (a, b) => Number(b.name === "ТЗ сайт") - Number(a.name === "ТЗ сайт"),
        );
      const assigned = new Set<string>();
      for (const label of labels) {
        const candidates = rows.filter(
          (t) =>
            t.projectId &&
            !t.parentTaskId &&
            !assigned.has(t.id) &&
            nameKey(t.title) !== nameKey(label.name) &&
            (taskTags.get(t.id) || []).some(
              (tag) => nameKey(tag) === nameKey(label.sourceTag),
            ),
        );
        for (const project of new Set(candidates.map((t) => t.projectId))) {
          const members = candidates.filter((t) => t.projectId === project);
          if (!members.length) continue;
          const ambiguous = members.filter(
            (t) =>
              (taskTags.get(t.id) || []).filter((tag) =>
                ["task", "event"].includes(
                  rules.get(nameKey(tag))?.category || "",
                ),
              ).length > 1 && label.name !== "ТЗ сайт",
          );
          for (const t of ambiguous)
            issues.push({
              taskId: t.id,
              reason:
                "Несколько прежних меток задач: проверьте родительскую задачу",
            });
          const safe = members.filter((t) => !ambiguous.includes(t));
          if (!safe.length) continue;
          let parent = rows.find(
            (t) =>
              t.projectId === project &&
              !t.parentTaskId &&
              nameKey(t.title) === nameKey(label.name),
          );
          if (!parent) {
            const id = randomUUID(),
              start = safe.reduce(
                (a, t) =>
                  new Date(t.startDate) < new Date(a) ? t.startDate : a,
                safe[0].startDate,
              ),
              end = safe.reduce(
                (a, t) => (new Date(t.endDate) > new Date(a) ? t.endDate : a),
                safe[0].endDate,
              );
            db.prepare(
              "INSERT INTO Task(id,title,description,startDate,endDate,updatedAt,createdAt,projectId,kind,status) VALUES(?,?,?,?,?,?,?,?,?,?)",
            ).run(
              id,
              label.name,
              "",
              start,
              end,
              now,
              now,
              project,
              label.category === "event" ? "event" : "task",
              safe.every((t) => t.status === "DONE") ? "DONE" : "PLANNED",
            );
            parent = { id, projectId: project };
            groups++;
          }
          for (const t of safe) {
            db.prepare("UPDATE Task SET parentTaskId=? WHERE id=?").run(
              parent.id,
              t.id,
            );
            t.parentTaskId = parent.id;
            assigned.add(t.id);
          }
        }
      }
      // Old dropdown policies no longer expose migrated mixed tags or excluded names.
      for (const p of db
        .prepare("SELECT id,scope,field,value FROM NamePolicy")
        .all() as Row[]) {
        let value: string | null = p.value;
        if (p.field === "tags" && rules.has(nameKey(p.value))) value = null;
        if (["executorName", "responsibleName"].includes(p.field))
          value =
            tokens(p.value)
              .filter((n) => !excluded.has(nameKey(n)))
              .map((n) => aliases.get(nameKey(n)) || n)
              .join(", ") || null;
        if (value === p.value) continue;
        if (
          !value ||
          db
            .prepare(
              "SELECT id FROM NamePolicy WHERE scope=? AND field=? AND value=? AND id<>?",
            )
            .get(p.scope, p.field, value, p.id)
        )
          db.prepare("DELETE FROM NamePolicy WHERE id=?").run(p.id);
        else
          db.prepare("UPDATE NamePolicy SET value=? WHERE id=?").run(
            value,
            p.id,
          );
      }
      const report = {
        version: 1,
        migratedAt: new Date(now).toISOString(),
        tasks: rows.length,
        createdParents: groups,
        issues,
      };
      db.prepare(
        "INSERT INTO WorkspaceMeta(key,value) VALUES('classification-v1',?)",
      ).run(JSON.stringify(report));
      touch(db);
      if ((db.pragma("foreign_key_check") as unknown[]).length)
        throw new Error("Нарушены связи после преобразования");
      return report;
    })
    .immediate();
}
