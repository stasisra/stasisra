// Read-only export of the live installation. Uses its already installed modules.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { createRequire } = require("node:module"),
  { parseEnv } = require("node:util"),
  { fileURLToPath } = require("node:url");
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
function option(name, fallback) {
  const n = process.argv.indexOf(name);
  if (n < 0) return fallback;
  if (!process.argv[n + 1]) throw Error("Missing value: " + name);
  return process.argv[n + 1];
}
function date(value) {
  if (value == null || value === "") return "";
  const number = Number(value),
    d = new Date(Number.isFinite(number) ? number : value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : String(value);
}
async function exportReview({ source, output, database, open = false }) {
  source = path.resolve(source);
  const requireApp = createRequire(path.join(source, "package.json"));
  if (
    JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"))
      .name !== "task-gantt-app"
  )
    throw Error("Select your working task-gantt-app installation.");
  const Database = requireApp("better-sqlite3"),
    ExcelJS = requireApp("exceljs");
  const config = {};
  for (const name of [
    ".env",
    ".env.production",
    ".env.local",
    ".env.production.local",
  ])
    if (fs.existsSync(path.join(source, name)))
      Object.assign(
        config,
        parseEnv(fs.readFileSync(path.join(source, name), "utf8")),
      );
  const url = config.DATABASE_URL || "file:./dev.db";
  if (!url.startsWith("file:")) throw Error("A SQLite database is required.");
  const raw = decodeURIComponent(url.slice(5).split("?")[0]);
  database = path.resolve(
    database ||
      (url.startsWith("file://")
        ? fileURLToPath(new URL(url))
        : path.isAbsolute(raw)
          ? raw
          : path.join(source, "prisma", raw)),
  );
  const snapshotId = crypto.randomUUID(),
    stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.resolve(
    output ||
      path.join(
        source,
        "exports",
        "review-" + stamp + "-" + snapshotId.slice(0, 6),
      ),
  );
  if (fs.existsSync(destination))
    throw Error("Export folder already exists. Nothing was overwritten.");
  const partial = destination + ".partial";
  fs.mkdirSync(partial, { recursive: true });
  let db;
  try {
    const live = new Database(database, {
      readonly: true,
      fileMustExist: true,
      timeout: 10000,
    });
    try {
      if (
        !live
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='Task'",
          )
          .get()
      )
        throw Error("Task table was not found.");
      await live.backup(path.join(partial, "database-full.db"));
    } finally {
      live.close();
    }
    db = new Database(path.join(partial, "database-full.db"), {
      readonly: true,
      fileMustExist: true,
    });
    if (db.pragma("quick_check", { simple: true }) !== "ok")
      throw Error("Database integrity check failed.");
    const exists = (name) =>
      !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(name);
    const records = {};
    for (const name of [
      "Task",
      "TaskComment",
      "Project",
      "Contact",
      "TaskExecutor",
      "NamePolicy",
    ])
      records[name] = exists(name)
        ? db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all()
        : [];
    records.User = exists("User")
      ? db.prepare("SELECT id,name,role FROM User ORDER BY rowid").all()
      : [];
    const files = [];
    fs.mkdirSync(path.join(partial, "files"));
    if (exists("Attachment"))
      for (const record of db
        .prepare(
          "SELECT id,taskId,name,type,size,createdAt,data FROM Attachment ORDER BY rowid",
        )
        .iterate()) {
        const extension = path.extname(record.name || "").slice(0, 16);
        const safeExtension = /^\.[a-zA-Z0-9]+$/.test(extension)
          ? extension
          : ".bin";
        const filename = hash(String(record.id)).slice(0, 32) + safeExtension,
          bytes = Buffer.from(record.data),
          relative = "files/" + filename;
        fs.writeFileSync(path.join(partial, relative), bytes, { flag: "wx" });
        const { data, ...meta } = record;
        files.push({
          ...meta,
          size: bytes.length,
          relative,
          sha256: hash(bytes),
        });
      }
    records.Attachment = files;
    const tasks = records.Task,
      byId = new Map(tasks.map((t) => [t.id, t])),
      children = new Map();
    for (const task of tasks) {
      const group = children.get(task.parentTaskId) || [];
      group.push(task);
      children.set(task.parentTaskId, group);
    }
    const ordered = [],
      seen = new Set();
    const visit = (root) => {
      const pending = [root];
      while (pending.length) {
        const t = pending.pop();
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        ordered.push(t);
        for (const child of [...(children.get(t.id) || [])].reverse())
          pending.push(child);
      }
    };
    for (const t of tasks)
      if (!t.parentTaskId || !byId.has(t.parentTaskId)) visit(t);
    for (const t of tasks) visit(t);
    const numbers = new Map(ordered.map((t, i) => [t.id, i + 1])),
      projects = new Map(records.Project.map((p) => [p.id, p])),
      contacts = new Map(records.Contact.map((c) => [c.id, c])),
      users = new Map(records.User.map((u) => [u.id, u]));
    const fullPath = (t) => {
      const names = [],
        visited = new Set();
      let current = t;
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        names.unshift(current.title);
        current = byId.get(current.parentTaskId);
      }
      if (current) names.unshift("[цикл в исходных данных]");
      return names.join(" → ");
    };
    const executors = (t) => {
      const names = records.TaskExecutor.filter((e) => e.taskId === t.id)
        .map((e) => contacts.get(e.contactId)?.name)
        .filter(Boolean);
      return names.length
        ? names.join(", ")
        : t.executorName || users.get(t.executorId)?.name || "";
    };
    const responsible = (t) =>
      contacts.get(t.responsibleContactId)?.name ||
      t.responsibleName ||
      users.get(t.responsibleId)?.name ||
      "";
    const payload = {
      format: "task-gantt-review/v1",
      snapshotId,
      createdAt: new Date().toISOString(),
      timeZone: config.APP_TIME_ZONE || "Asia/Jerusalem",
      records,
      reviewOrder: ordered.map((t) => t.id),
    };
    const json = JSON.stringify(payload, null, 2);
    fs.writeFileSync(path.join(partial, "data.json"), json);
    const wb = new ExcelJS.Workbook();
    wb.creator = "Task & Gantt";
    wb.created = new Date();
    const info = wb.addWorksheet("Инструкция");
    info.columns = [{ width: 35 }, { width: 110 }];
    for (const row of [
      [
        "Назначение",
        "Отметьте нужные задачи. Выгрузка не удаляет и не меняет записи в работающей программе.",
      ],
      [
        "Что заполнять",
        "На листе «Отбор задач» жёлтые колонки: Решение, Тип после переноса, Новое название, Новая тема, Новый родитель №, Комментарий. Остальное можно оставить.",
      ],
      [
        "Решение",
        "Оставить или Удалить. По умолчанию всё оставлено. Можно фильтровать и сортировать строки.",
      ],
      [
        "Родитель",
        "Номер из колонки №. Если родитель удалён, оставленную подзадачу перенесём отдельно.",
      ],
      [
        "Служебные данные",
        "Не удаляйте строки и служебные колонки; отмечайте решение. Скрытые ID нужны для точного сопоставления одинаковых названий.",
      ],
      [
        "Полные тексты",
        "Длинные описания и комментарии разбиты на части на листе «Полные тексты». Исходные значения полностью сохранены в data.json и копии базы.",
      ],
      [
        "Что прислать",
        "Сохраните изменённый tasks-review.xlsx и передайте его для проверки. Остальные файлы экспорта оставьте у себя для последующего импорта.",
      ],
      [
        "Архив",
        "database-full.db — полная локальная копия с задачами, файлами и учётными записями. data.json и files — рабочие данные для импорта. Настройки и секреты .env не копируются.",
      ],
      [
        "Важно",
        "Файл Excel задаёт будущий отбор. Текущая программа продолжает работать со своей прежней базой.",
      ],
      ["Снимок", snapshotId],
      ["Дата", payload.createdAt],
      ["Задач", tasks.length],
      ["Файлов", files.length],
    ]) {
      const r = info.addRow(row);
      r.alignment = { vertical: "top", wrapText: true };
      r.height = 42;
      r.getCell(1).font = { bold: true };
    }
    const textSheet = wb.addWorksheet("Полные тексты");
    textSheet.columns = [
      { header: "№ задачи", width: 12 },
      { header: "Поле", width: 25 },
      { header: "Часть", width: 10 },
      { header: "Текст", width: 120 },
      { header: "ID", width: 40, hidden: true },
    ];
    function text(value, taskId, field) {
      const str = String(value ?? "");
      if (str.length <= 30000) return str;
      for (
        let offset = 0, part = 1;
        offset < str.length;
        offset += 30000, part++
      )
        textSheet.addRow([
          numbers.get(taskId) || "",
          field,
          part,
          str.slice(offset, offset + 30000),
          taskId,
        ]);
      return (
        str.slice(0, 29500) +
        "\n[ПОЛНЫЙ ТЕКСТ: лист «Полные тексты», задача № " +
        (numbers.get(taskId) || taskId) +
        "]"
      );
    }
    const review = wb.addWorksheet("Отбор задач");
    const columns = [
      ["№", 8],
      ["Решение", 15],
      ["Тип после переноса", 23],
      ["Новое название", 40],
      ["Новая тема", 26],
      ["Новый родитель №", 20],
      ["Комментарий", 50],
      ["Название", 45],
      ["Полное описание", 85],
      ["Путь", 65],
      ["Родитель №", 14],
      ["Тема сейчас", 25],
      ["Исполнители", 30],
      ["Ответственный", 25],
      ["Статус", 20],
      ["Начало", 24],
      ["Дедлайн", 24],
      ["Готовность %", 14],
      ["Теги сейчас", 35],
      ["Исходные теги", 40],
      ["Комментариев", 16],
      ["Файлов", 12],
      ["ID", 40],
      ["Parent ID", 40],
    ];
    review.columns = columns.map(([header, width]) => ({ header, width }));
    review.getColumn(23).hidden = true;
    review.getColumn(24).hidden = true;
    for (const t of ordered) {
      const row = review.addRow([
        numbers.get(t.id),
        "Оставить",
        t.kind === "event" ? "Мероприятие" : "Рабочая задача",
        "",
        "",
        "",
        "",
        text(t.title, t.id, "Название"),
        text(t.description, t.id, "Описание"),
        text(fullPath(t), t.id, "Путь"),
        numbers.get(t.parentTaskId) || "",
        projects.get(t.projectId)?.name || "",
        executors(t),
        responsible(t),
        t.status,
        date(t.startDate),
        date(t.endDate),
        t.percentComplete,
        t.tags || "",
        t.legacyTags || t.tags || "",
        records.TaskComment.filter((c) => c.taskId === t.id).length,
        files.filter((f) => f.taskId === t.id).length,
        t.id,
        t.parentTaskId || "",
      ]);
      row.height = 90;
      row.alignment = { vertical: "top", wrapText: true };
      for (let col = 2; col <= 7; col++)
        row.getCell(col).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF2CC" },
        };
      row.getCell(2).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"Оставить,Удалить"'],
        showErrorMessage: true,
        error: "Выберите Оставить или Удалить",
      };
      row.getCell(3).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"Рабочая задача,Мероприятие,Подготовка,Вопрос,Заметка"'],
        showErrorMessage: true,
        error: "Выберите тип из списка",
      };
    }
    const comments = wb.addWorksheet("Комментарии");
    comments.columns = [
      { header: "№ задачи", width: 12 },
      { header: "Задача", width: 40 },
      { header: "Тип", width: 16 },
      { header: "Текст", width: 110 },
      { header: "Автор", width: 25 },
      { header: "Дата", width: 26 },
      { header: "Решён", width: 12 },
      { header: "ID", width: 40, hidden: true },
      { header: "Task ID", width: 40, hidden: true },
    ];
    for (const c of records.TaskComment)
      comments.addRow([
        numbers.get(c.taskId) || "",
        byId.get(c.taskId)?.title || "",
        c.kind || "comment",
        text(c.body, c.taskId, "Комментарий " + c.id),
        users.get(c.authorId)?.name || "",
        date(c.createdAt),
        c.resolved ? "Да" : "Нет",
        c.id,
        c.taskId,
      ]);
    const attachments = wb.addWorksheet("Файлы");
    attachments.columns = [
      { header: "№ задачи", width: 12 },
      { header: "Задача", width: 40 },
      { header: "Файл", width: 45 },
      { header: "Размер байт", width: 18 },
      { header: "Открыть", width: 35 },
      { header: "ID", width: 40, hidden: true },
      { header: "Task ID", width: 40, hidden: true },
    ];
    for (const f of files)
      attachments.addRow([
        numbers.get(f.taskId) || "",
        byId.get(f.taskId)?.title || "",
        f.name,
        f.size,
        { text: "Открыть файл", hyperlink: f.relative },
        f.id,
        f.taskId,
      ]);
    const directory = wb.addWorksheet("Справочники");
    directory.columns = [
      { header: "Раздел", width: 20 },
      { header: "Название", width: 45 },
      { header: "Тип", width: 25 },
      { header: "Ответственный", width: 20 },
      { header: "Скрыто", width: 15 },
      { header: "ID", width: 40, hidden: true },
    ];
    for (const p of records.Project)
      directory.addRow([
        "Тема",
        p.name,
        "",
        "",
        p.archived ? "Да" : "Нет",
        p.id,
      ]);
    for (const c of records.Contact)
      directory.addRow([
        "Контакт",
        c.name,
        c.type,
        c.responsible ? "Да" : "Нет",
        c.archived ? "Да" : "Нет",
        c.id,
      ]);
    for (const p of records.NamePolicy)
      directory.addRow([
        "Исходный справочник",
        p.value,
        p.field,
        "",
        p.hidden ? "Да" : "Нет",
        p.id,
      ]);
    const meta = wb.addWorksheet("_meta", { state: "veryHidden" });
    for (const row of [
      ["format", payload.format],
      ["snapshotId", snapshotId],
      ["dataSha256", hash(json)],
      ["taskCount", tasks.length],
    ])
      meta.addRow(row);
    for (const sheet of [review, comments, attachments, directory, textSheet]) {
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount },
      };
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF305887" },
      };
      sheet.getRow(1).height = 32;
      for (let i = 2; i <= sheet.rowCount; i++)
        sheet.getRow(i).alignment = { vertical: "top", wrapText: true };
    }
    wb.views = [{ activeTab: 2 }]; // Instruction, full texts, review.
    await wb.xlsx.writeFile(path.join(partial, "tasks-review.xlsx"));
    fs.writeFileSync(
      path.join(partial, "manifest.json"),
      JSON.stringify(
        {
          format: payload.format,
          snapshotId,
          dataSha256: hash(json),
          tasks: tasks.length,
          comments: records.TaskComment.length,
          files: files.length,
          createdAt: payload.createdAt,
        },
        null,
        2,
      ),
    );
    db.close();
    db = null;
    fs.renameSync(partial, destination);
    console.log(
      "Export complete: " +
        tasks.length +
        " tasks, " +
        records.TaskComment.length +
        " comments, " +
        files.length +
        " files.",
    );
    console.log("Folder: " + destination);
    console.log(
      "Open tasks-review.xlsx. Your working database was not changed.",
    );
    if (open && process.platform === "win32")
      require("node:child_process")
        .spawn("explorer.exe", [destination], {
          detached: true,
          stdio: "ignore",
        })
        .unref();
    return {
      destination,
      snapshotId,
      tasks: tasks.length,
      files: files.length,
    };
  } catch (error) {
    if (db) db.close();
    fs.writeFileSync(
      path.join(partial, "EXPORT_FAILED.txt"),
      String(error.message),
    );
    throw error;
  }
}
if (require.main === module)
  exportReview({
    source: option(
      "--source",
      process.platform === "win32"
        ? "C:\\Distr_Local\\task-gantt-app-workspace"
        : process.cwd(),
    ),
    output: option("--output", null),
    database: option("--database", null),
    open: process.argv.includes("--open"),
  }).catch((error) => {
    console.error("Export stopped: " + error.message);
    process.exitCode = 1;
  });
module.exports = { exportReview };
