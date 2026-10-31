// Run locally in the new application folder. Only tags and assignments change.
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const Database = require("better-sqlite3");
const key = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
function removeKozub(value) {
  if (value === null || value === undefined) return value;
  const tokens = String(value)
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
  if (!tokens.some((v) => key(v) === "козуб")) return value;
  return tokens.filter((v) => key(v) !== "козуб").join(", ") || null;
}
function cleanSnapshot(db, apply = false) {
  // Login records carry historical authorship. Never delete or silently rename them.
  const users = db.prepare("SELECT id,name FROM User").all();
  if (users.some((user) => removeKozub(user.name) !== user.name))
    throw new Error(
      "Козуб найден среди учётных записей. Очистка остановлена: нужно отдельно проверить связанные записи.",
    );
  const tasks = [];
  for (const row of db
    .prepare("SELECT id,tags,executorName,responsibleName FROM Task")
    .all()) {
    const tags = removeKozub(row.tags),
      executor = removeKozub(row.executorName),
      responsible = removeKozub(row.responsibleName);
    if (
      tags !== row.tags ||
      executor !== row.executorName ||
      responsible !== row.responsibleName
    )
      tasks.push({
        ...row,
        tags,
        executorName: executor,
        responsibleName: responsible,
      });
  }
  const policies = db
    .prepare(
      "SELECT id,scope,field,value FROM NamePolicy WHERE field IN ('tags','executorName','responsibleName')",
    )
    .all();
  const changes = policies.filter(
    (row) => removeKozub(row.value) !== row.value,
  );
  if (apply)
    db.transaction(() => {
      const update = db.prepare(
        "UPDATE Task SET tags=?,executorName=?,responsibleName=?,updatedAt=? WHERE id=?",
      );
      for (const row of tasks)
        update.run(
          row.tags,
          row.executorName,
          row.responsibleName,
          Date.now(),
          row.id,
        );
      for (const row of changes) {
        const next = removeKozub(row.value);
        const target =
          next &&
          db
            .prepare(
              "SELECT id,value FROM NamePolicy WHERE scope=? AND field=? AND id<>?",
            )
            .all(row.scope, row.field, row.id)
            .find((item) => key(item.value) === key(next));
        if (!next || target)
          db.prepare("DELETE FROM NamePolicy WHERE id=?").run(row.id);
        else
          db.prepare(
            "UPDATE NamePolicy SET value=?,updatedAt=? WHERE id=?",
          ).run(next, Date.now(), row.id);
      }
    })();
  return {
    mode: apply ? "applied" : "preview",
    tasksUpdated: tasks.length,
    dictionaryEntriesUpdated: changes.length,
  };
}
function cleanDatabase(db, apply = false) {
  const run = db.transaction(() => cleanSnapshot(db, apply));
  return apply ? run.immediate() : run();
}
function main() {
  if (
    !fs.existsSync("package.json") ||
    JSON.parse(fs.readFileSync("package.json", "utf8")).name !==
      "task-gantt-app"
  )
    throw new Error("Откройте папку task-gantt-app-fixed.");
  const env = parseEnv(fs.readFileSync(".env", "utf8"));
  const url = env.DATABASE_URL;
  if (!url?.startsWith("file:"))
    throw new Error("Не найден путь SQLite в .env.");
  const raw = url.slice(5);
  const filename = path.isAbsolute(raw) ? raw : path.resolve("prisma", raw);
  const apply = process.argv.includes("--apply");
  const db = new Database(filename, { fileMustExist: true, readonly: !apply });
  try {
    db.pragma("foreign_keys = ON");
    console.log(JSON.stringify(cleanDatabase(db, apply), null, 2));
  } finally {
    db.close();
  }
}
module.exports = { removeKozub, cleanDatabase };
if (require.main === module)
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
