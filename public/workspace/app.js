(async function () {
  "use strict";
  let requests = 0;
  let productUI = null;
  const pendingFiles = new Map(),
    noteRequests = new Map();

  const $ = (s) => document.querySelector(s),
    $$ = (s) => [...document.querySelectorAll(s)];
  const E = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const icon = (name, small = false) =>
    `<svg class="icon ${small ? "small-icon" : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let TODAY = "";
  const DAY = 86400000;
  const TaskFilter = window.TaskTreeFilter;
  if (!TaskFilter)
    throw new Error("Обновите страницу: не загружен фильтр задач");

  function syncStatus(text, error = false) {
    const element = document.querySelector("#sync-status");
    if (element) {
      element.textContent = text;
      element.classList.toggle("sync-error", error);
    }
  }
  async function checkedFetch(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(
        data.error || "Не удалось выполнить запрос. Повторите действие.",
      );
      error.status = response.status;
      if (response.status === 401) {
        syncStatus("Сессия завершена. Войдите снова.", true);
      }
      throw error;
    }
    return response;
  }
  function normalizeModel(data) {
    if (
      !data ||
      !Array.isArray(data.tasks) ||
      !Array.isArray(data.contacts) ||
      !Array.isArray(data.projects)
    )
      throw new Error("Сервер вернул некорректные данные");
    for (const t of data.tasks) {
      t.comments ||= [];
      t.attachments ||= [];
      for (const c of t.comments)
        c.date = new Date(c.createdAt).toLocaleString("ru-RU", {
          timeZone: data.timeZone || "Asia/Jerusalem",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
    }
    return data;
  }
  async function getWorkspace() {
    return normalizeModel(await (await checkedFetch("/api/next")).json());
  }
  function acceptModel(data, force = false) {
    data = normalizeModel(data);
    if (
      force ||
      data.instanceId !== model.instanceId ||
      data.revision >= model.revision
    ) {
      model = data;
      productUI?.refreshLookups();
    }
  }
  async function mutate(action, data) {
    requests++;
    syncStatus("Сохраняем…");
    try {
      const response = await checkedFetch("/api/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data }),
      });
      acceptModel(await response.json());
      syncStatus(
        "Сохранено · " +
          new Date().toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          }),
      );
      return model;
    } catch (error) {
      syncStatus(
        error.status === 409
          ? "Данные изменены в другом окне"
          : "Не удалось сохранить. Повторите действие.",
        true,
      );
      throw error;
    } finally {
      requests--;
    }
  }
  async function reloadWorkspace(force = false) {
    try {
      acceptModel(await getWorkspace(), force);
      render();
      if (ui.drawer?.id) {
        const current = task(ui.drawer.id);
        if (current) refreshActivity(current.id);
        if (!current || current.revision !== ui.drawer.data.revision)
          errorIn(
            "#task-error",
            Object.assign(
              new Error(
                "Карточка изменена в другом окне. Ваши поля сохранены в форме.",
              ),
              { status: 409 },
            ),
          );
      }
      syncStatus("Данные обновлены");
    } catch (error) {
      toast(error.message);
      syncStatus("Не удалось обновить данные", true);
    }
  }
  function errorIn(selector, error) {
    const node = $(selector);
    if (node)
      node.innerHTML = `<div class="form-error" role="alert">${E(error.message)}${error.status === 409 && ui.drawer?.id ? '<button type="button" class="textbtn" data-action="reload-card">Загрузить актуальную карточку</button>' : ""}</div>`;
    else toast(error.message);
  }
  function busyButton(button, busy) {
    if (button) {
      button.disabled = busy;
      button.dataset.busy = String(busy);
    }
  }
  const localToday = (zone) => {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: zone || "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const value = (type) => parts.find((p) => p.type === type).value;
    return value("year") + "-" + value("month") + "-" + value("day");
  };
  function allFiles(id) {
    const committed =
      (task(id) || (ui.drawer?.data.id === id ? ui.drawer.data : null))
        ?.attachments || [];
    return [
      ...committed,
      ...[...pendingFiles.values()]
        .filter((f) => f.taskId === id)
        .map((f) => f.meta),
    ];
  }
  async function attachmentBlob(file) {
    const pending = pendingFiles.get(file.id);
    if (pending) return pending.file;
    const response = await checkedFetch(
      "/api/next/files/" + encodeURIComponent(file.id),
    );
    return new Blob([await response.arrayBuffer()], {
      type: file.type || "application/octet-stream",
    });
  }
  async function uploadOne(taskId, entry) {
    const form = new FormData();
    form.set("file", entry.file);
    form.set("uploadId", entry.meta.id);
    await checkedFetch(
      "/api/next/items/" + encodeURIComponent(taskId) + "/files",
      { method: "POST", body: form },
    );
    pendingFiles.delete(entry.meta.id);
  }
  async function uploadFiles(input) {
    const id = input.dataset.uploadTask,
      files = [...input.files];
    input.value = "";
    if (!record(id)) return;
    ui.uploads++;
    try {
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024 || !file.size) {
          toast("Выберите непустой файл до 20 МБ");
          continue;
        }
        const meta = {
            id: uid(),
            name: file.name,
            size: file.size,
            type: file.type || "application/octet-stream",
            pending: true,
          },
          entry = { taskId: id, file, meta };
        pendingFiles.set(meta.id, entry);
        if (task(id)) {
          try {
            await uploadOne(id, entry);
            acceptModel(await getWorkspace());
            syncStatus("Файл сохранён");
          } catch (error) {
            toast("Файл не загружен: " + error.message);
          }
        }
        refreshActivity(id);
      }
    } finally {
      ui.uploads--;
    }
  }
  function captureTaskForm(form) {
    const values = new FormData(form);
    return {
      id: ui.drawer.id || ui.drawer.data.id,
      title: String(values.get("title") || "").trim(),
      description: String(values.get("description") || "").trim(),
      project: $("#task-project").value,
      parent: String(values.get("parent") || "") || null,
      executors: values.getAll("executors").map(String),
      responsible: String(values.get("responsible") || ""),
      start: String(values.get("start") || ""),
      end: String(values.get("end") || ""),
      percent: Number(values.get("percent") || 0),
      status: String(values.get("status") || ""),
      kind: String(values.get("kind") || "task"),
      startTime: String(values.get("startTime") || ""),
      endTime: String(values.get("endTime") || ""),
      location: String(values.get("location") || "").trim(),
      timeZone: String(
        values.get("timeZone") || ui.drawer.data.timeZone || model.timeZone,
      ),
      revision: ui.drawer.data.revision || 0,
      counterparties: values.getAll("counterparties").map(String),
      tags: [
        ...new Set(
          [
            ...(ui.drawer.data.tags || []),
            String($("#task-tag-input")?.value || "").trim(),
          ].filter(Boolean),
        ),
      ],
      topics: values.getAll("topics").map(String),
      activityId: ui.drawer.data.activityId || null,
      linkedTaskId: ui.drawer.data.linkedTaskId || null,
      originItemId: ui.drawer.data.originItemId || null,
      outcome: String(values.get("outcome") || ""),
      comments: ui.drawer.id
        ? []
        : ui.drawer.data.comments.map((c) => ({
            id: c.id,
            text: c.text,
            kind: c.kind,
          })),
    };
  }
  function taskFormSignature() {
    const form = $("#task-form");
    return form ? JSON.stringify(captureTaskForm(form)) : "";
  }
  function drawerDirty() {
    return !!(
      ui.drawer &&
      ((ui.drawer.baseline && ui.drawer.baseline !== taskFormSignature()) ||
        [...pendingFiles.values()].some(
          (f) => f.taskId === ui.drawer.data.id,
        ) ||
        (!ui.drawer.id &&
          (ui.drawer.data.comments.length ||
            allFiles(ui.drawer.data.id).length)))
    );
  }
  function closeDrawer(force = false) {
    if (!force && (requests || ui.uploads)) {
      toast("Дождитесь завершения сохранения или загрузки");
      return;
    }
    if (!force && drawerDirty()) {
      modal(
        "Закрыть без сохранения?",
        '<p class="activity-empty">Несохранённые поля будут потеряны. Уже добавленные комментарии и загруженные файлы сохранятся.</p>',
        '<button class="btn" data-action="close-modal">Продолжить редактирование</button><button class="btn danger" data-action="discard-drawer">Закрыть без сохранения</button>',
        true,
      );
      return;
    }
    if (ui.drawer) {
      for (const [key, value] of pendingFiles)
        if (value.taskId === ui.drawer.data.id) pendingFiles.delete(key);
    }
    ui.drawer = null;
    $("#drawer-root").innerHTML = "";
    const url = new URL(location.href);
    url.searchParams.delete("task");
    url.searchParams.delete("new");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  async function saveTask(form) {
    if (form.dataset.busy === "true" || ui.uploads) return;
    const button = $('#drawer-root [form="task-form"]'),
      data = captureTaskForm(form),
      wasNew = !ui.drawer.id;
    if (!data.title) {
      errorIn("#task-error", new Error("Введите название"));
      return;
    }
    if (data.start && data.end && data.end < data.start) {
      errorIn("#task-error", new Error("Дата окончания раньше даты начала"));
      return;
    }
    form.dataset.busy = "true";
    form.inert = true;
    form.setAttribute("aria-busy", "true");
    busyButton(button, true);
    try {
      await mutate(wasNew ? "createTask" : "saveTask", data);
      ui.drawer.id = data.id;
      ui.drawer.data.revision = task(data.id).revision;
      for (const entry of [...pendingFiles.values()].filter(
        (f) => f.taskId === data.id,
      ))
        await uploadOne(data.id, entry);
      if (allFiles(data.id).some((f) => f.pending))
        throw new Error(
          "Остались незагруженные файлы. Нажмите «Сохранить» для повторной попытки.",
        );
      acceptModel(await getWorkspace());
      closeDrawer(true);
      render();
      toast("Запись сохранена");
      return true;
    } catch (error) {
      if (error.status === 409 && wasNew) {
        try {
          acceptModel(await getWorkspace());
          if (task(data.id)) {
            ui.drawer.id = data.id;
            ui.drawer.data.revision = task(data.id).revision;
          }
        } catch {}
      }
      errorIn("#task-error", error);
      refreshActivity(data.id);
      return false;
    } finally {
      form.dataset.busy = "false";
      form.inert = false;
      form.removeAttribute("aria-busy");
      busyButton(button, false);
    }
  }
  async function postNote(composer) {
    if (!composer || composer.dataset.busy === "true") return;
    const id = composer.dataset.task,
      t = record(id),
      input = composer.querySelector(".note-text"),
      text = input.value.trim(),
      kind = composer.querySelector(".note-kind").value;
    if (!text || !t) return;
    const key = composer.dataset.scope + ":" + id,
      previous = noteRequests.get(key),
      note =
        previous?.text === text && previous.kind === kind
          ? previous
          : { id: uid(), text, kind };
    noteRequests.set(key, note);
    composer.dataset.busy = "true";
    const button = composer.querySelector("button");
    busyButton(button, true);
    input.readOnly = true;
    composer.querySelector(".note-kind").disabled = true;
    try {
      if (task(id)) await mutate("addNote", { ...note, taskId: id });
      else
        t.comments.push({
          ...note,
          date: "Черновик",
          resolved: false,
          revision: 0,
        });
      noteRequests.delete(key);
      delete ui.noteDrafts[key];
      input.value = "";
      refreshActivity(id);
      const target =
        composer.dataset.scope === "row"
          ? document.querySelector(
              `.note-composer[data-scope="row"][data-task="${CSS.escape(id)}"] .note-text`,
            )
          : $("#comment-text");
      target?.focus();
      toast(task(id) ? "Запись сохранена" : "Запись добавлена в черновик");
    } catch (error) {
      toast(error.message);
    } finally {
      composer.dataset.busy = "false";
      busyButton(button, false);
      input.readOnly = false;
      composer.querySelector(".note-kind").disabled = false;
    }
  }
  async function resolveNote(id, noteId, expectedRevision, resolved) {
    const t = record(id),
      note = t?.comments.find((c) => c.id === noteId);
    if (!note) return;
    try {
      if (task(id))
        await mutate("resolveNote", {
          id: note.id,
          resolved,
          revision: expectedRevision,
        });
      else note.resolved = resolved;
      refreshActivity(id);
    } catch (error) {
      toast(error.message);
    }
  }
  async function saveDirectory() {
    const button = $('#modal-root [data-action="directory-save"]');
    if (button?.dataset.busy === "true") return;
    const { mode, id, revision } = directoryContext,
      existing = $("#existing-contact")?.value;
    busyButton(button, true);
    const body = $("#modal-root .modal-body");
    if (body) body.inert = true;
    try {
      if (existing) {
        const c = person(existing);
        await mutate("makeResponsible", { id: c.id, revision: c.revision });
      } else {
        const name = $("#directory-name").value.trim();
        if (!name) throw new Error("Введите название");
        await mutate("saveDirectory", {
          id: id || directoryContext.newId,
          mode,
          name,
          description: $("#directory-description")?.value || "",
          type: ["projects", "tags"].includes(mode)
            ? "Человек"
            : mode === "responsibles" && !id
              ? "Человек"
              : $("#contact-type").value,
          responsible:
            mode === "responsibles" && !id
              ? true
              : !!$("#contact-responsible")?.checked,
          revision,
        });
      }
      render();
      manage(mode);
      toast("Справочник сохранён");
    } catch (error) {
      errorIn("#directory-error", error);
    } finally {
      if (body) body.inert = false;
      busyButton(button, false);
    }
  }
  async function hideDirectory(id, expectedRevision, archived) {
    const mode = ui.manager,
      item =
        mode === "projects"
          ? proj(id)
          : mode === "tags"
            ? model.tags.find((t) => t.id === id)
            : person(id);
    try {
      await mutate("hideDirectory", {
        mode,
        id,
        archived,
        revision: expectedRevision,
      });
      render();
      manage(mode);
    } catch (error) {
      toast(error.message);
    }
  }
  async function confirmDirectoryDelete() {
    const button = $('#modal-root [data-action="confirm-directory-delete"]');
    if (button?.dataset.busy === "true") return;
    busyButton(button, true);
    const { mode, id, revision } = deleteContext,
      replacement = $("#replacement")?.value || "";
    try {
      await mutate("removeDirectory", { mode, id, revision, replacement });
      if (mode === "projects") {
        ui.projects = [
          ...new Set(
            ui.projects.map((value) =>
              value === id ? replacement || "none" : value,
            ),
          ),
        ];
        ui.project = ui.projects.length === 1 ? ui.projects[0] : "all";
      }
      if (mode === "tags") {
        ui.includeTags = [
          ...new Set(
            ui.includeTags.flatMap((value) =>
              value === id ? (replacement ? [replacement] : []) : [value],
            ),
          ),
        ];
        ui.excludeTags = [
          ...new Set(
            ui.excludeTags.flatMap((value) =>
              value === id ? (replacement ? [replacement] : []) : [value],
            ),
          ),
        ];
      }
      if (ui.counterparty === id) ui.counterparty = replacement;
      if (ui.executor === id) ui.executor = replacement;
      if (ui.responsible === id) ui.responsible = replacement;
      ui.filterDraft = null;
      render();
      manage(mode);
      toast("Запись убрана, задачи сохранены");
    } catch (error) {
      toast(error.message);
    } finally {
      busyButton(button, false);
    }
  }
  async function confirmTaskDelete(id) {
    const button = $('#modal-root [data-action="confirm-task-delete"]');
    if (button?.dataset.busy === "true") return;
    busyButton(button, true);
    try {
      await mutate("deleteTask", {
        id,
        revision: pendingTaskDeletion.revision,
      });
      closeModal();
      closeDrawer(true);
      render();
      toast("Задача удалена, подзадачи сохранены");
    } catch (error) {
      toast(error.message);
    } finally {
      busyButton(button, false);
    }
  }
  let pendingTaskDeletion;
  function askRemoveFile(id, fileId) {
    const file = allFiles(id).find((f) => f.id === fileId);
    if (!file) return;
    modal(
      "Убрать файл?",
      `<p class="activity-empty">${E(file.name)}. Задача и обсуждение сохранятся.</p>`,
      `<button class="btn" data-action="close-modal">Отмена</button><button class="btn danger" data-action="confirm-remove-file" data-id="${E(id)}" data-file="${E(fileId)}">Убрать файл</button>`,
      true,
    );
  }
  async function removeFile(id, fileId) {
    try {
      if (pendingFiles.has(fileId)) pendingFiles.delete(fileId);
      else {
        await checkedFetch(
          "/api/next/files/" +
            encodeURIComponent(fileId) +
            "?itemId=" +
            encodeURIComponent(id),
          {
            method: "DELETE",
          },
        );
        acceptModel(await getWorkspace());
      }
      closeModal();
      refreshActivity(id);
      toast("Файл убран");
    } catch (error) {
      toast(error.message);
    }
  }
  async function retryFile(id, fileId) {
    const entry = pendingFiles.get(fileId);
    if (!entry || !task(id)) return;
    try {
      await uploadOne(id, entry);
      acceptModel(await getWorkspace());
      refreshActivity(id);
    } catch (error) {
      toast(error.message);
    }
  }
  function urlForState() {
    const u = new URL(location.href);
    u.pathname = "/tasks";
    for (const key of [
      "view",
      "projects",
      "executor",
      "responsible",
      "status",
      "from",
      "to",
      "dateMode",
      "done",
      "q",
    ])
      u.searchParams.delete(key);
    if (ui.view !== "table") u.searchParams.set("view", ui.view);
    if (ui.projects.length)
      u.searchParams.set("projects", ui.projects.join(","));
    for (const key of ["executor", "responsible", "status", "from", "to"])
      if (ui[key]) u.searchParams.set(key, ui[key]);
    if (ui.dateMode !== "overlap") u.searchParams.set("dateMode", ui.dateMode);
    if (ui.done) u.searchParams.set("done", "1");
    if (ui.q) u.searchParams.set("q", ui.q);
    if (ui.searchEverywhere) u.searchParams.set("allSections", "1");
    else u.searchParams.delete("allSections");
    const fragment = new URLSearchParams(u.hash.slice(1));
    for (const key of ["tasks", "except", "taskMode"]) fragment.delete(key);
    if (hasTaskSelection(ui))
      fragment.set("taskMode", ui.taskAll ? "all" : "selected");
    if (ui.taskInclude.length) fragment.set("tasks", ui.taskInclude.join(","));
    if (ui.taskExclude.length) fragment.set("except", ui.taskExclude.join(","));
    u.hash = fragment.toString();
    return u.pathname + u.search + u.hash;
  }
  function syncLocation() {
    history.replaceState(null, "", urlForState());
  }
  function initialLocation() {
    const u = new URL(location.href);
    ui.view =
      u.pathname === "/gantt"
        ? "gantt"
        : u.pathname === "/deadlines"
          ? "deadlines"
          : u.pathname === "/activities"
            ? "events"
            : ["table", "gantt", "deadlines", "events", "calendar"].includes(
                  u.searchParams.get("view"),
                )
              ? u.searchParams.get("view")
              : "table";
    ui.projects = (u.searchParams.get("projects") || "")
      .split(",")
      .filter((id) => id === "none" || model.projects.some((p) => p.id === id));
    ui.project = ui.projects.length === 1 ? ui.projects[0] : "all";
    for (const key of ["executor", "responsible"])
      ui[key] = model.contacts.some((c) => c.id === u.searchParams.get(key))
        ? u.searchParams.get(key)
        : "";
    ui.status = statuses[u.searchParams.get("status")]
      ? u.searchParams.get("status")
      : "";
    for (const key of ["from", "to"])
      ui[key] = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get(key) || "")
        ? u.searchParams.get(key)
        : "";
    ui.dateMode = ["overlap", "start", "deadline"].includes(
      u.searchParams.get("dateMode"),
    )
      ? u.searchParams.get("dateMode")
      : "overlap";
    ui.done = u.searchParams.get("done") === "1";
    ui.q = (u.searchParams.get("q") || "").slice(0, 1000);
    ui.searchEverywhere = u.searchParams.get("allSections") === "1";
    $("#search-everywhere").checked = ui.searchEverywhere;
    const fragment = new URLSearchParams(u.hash.slice(1));
    setTaskSelection(ui, {
      all:
        fragment.get("taskMode") === "all" ||
        (fragment.get("taskMode") !== "selected" && !fragment.has("tasks")),
      include: (fragment.get("tasks") || "").split(","),
      exclude: (fragment.get("except") || "").split(","),
    });
    if (ui.from && ui.to && ui.from > ui.to) ui.from = ui.to = "";
    if (ui.view === "deadlines") {
      ui.dateMode = "deadline";
      if (!ui.from && !ui.to) {
        ui.from = TODAY;
        ui.to = addDays(TODAY, 6);
      }
    }
    $("#search").value = ui.q;
  }
  async function previewOffice(file, blob, id) {
    closeModal();
    const context = { fileId: file.id, book: null, sheet: 0, row: 0, col: 0 };
    officeView = context;
    modal(
      file.name,
      `<div class="preview-meta">${fileSize(file.size)} · Вложение задачи</div><div id="office-body"><p class="activity-empty">Подготовка документа к просмотру…</p></div>`,
      `<button class="btn" data-action="close-modal">Закрыть</button><button class="btn primary" data-action="download-file" data-id="${E(id)}" data-file="${E(file.id)}">${icon("download", true)}Скачать оригинал</button>`,
    );
    $("#modal-root .modal").classList.add("preview-modal");
    try {
      const buffer = await blob.arrayBuffer();
      if (officeView !== context) return;
      const worker = new Worker("/workspace/office-worker.js");
      context.worker = worker;
      const result = await new Promise((resolve, reject) => {
        context.cancel = () => {
          clearTimeout(context.timer);
          worker.terminate();
          reject(new Error("cancelled"));
        };
        context.timer = setTimeout(() => {
          worker.terminate();
          reject(
            new Error(
              "Документ не удалось обработать за 10 секунд. Скачайте оригинал.",
            ),
          );
        }, 10000);
        worker.onmessage = (event) => {
          clearTimeout(context.timer);
          worker.terminate();
          event.data.error
            ? reject(new Error(event.data.error))
            : resolve(event.data);
        };
        worker.onerror = () => {
          clearTimeout(context.timer);
          worker.terminate();
          reject(
            new Error("Не удалось открыть документ. Оригинал можно скачать."),
          );
        };
        worker.postMessage({ buffer, name: file.name }, [buffer]);
      });
      if (officeView !== context) return;
      if (result.book) {
        context.book = result.book;
        renderWorkbook();
      } else {
        const html = DOMPurify.sanitize(result.html, {
          ALLOWED_TAGS: [
            "p",
            "br",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "strong",
            "em",
            "u",
            "s",
            "del",
            "sub",
            "sup",
            "ul",
            "ol",
            "li",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td",
            "blockquote",
            "img",
            "span",
            "hr",
          ],
          ALLOWED_ATTR: ["src", "alt", "width", "height", "colspan", "rowspan"],
          ALLOWED_URI_REGEXP: /^data:image\//i,
          FORBID_ATTR: ["style", "srcset", "id", "name"],
        });
        $("#office-body").innerHTML =
          `<p class="activity-empty">Word · режим чтения. Разметка может отличаться от оригинала.</p><article class="word-document">${html || "<p>В документе нет текста для просмотра.</p>"}</article>`;
      }
    } catch (error) {
      if (officeView === context && $("#office-body"))
        $("#office-body").innerHTML =
          `<div class="file-unavailable">${E(error.message)}</div>`;
    }
  }
  const statuses = {
    PLANNED: "Запланировано",
    IN_PROGRESS: "В работе",
    PAUSED: "Ожидание",
    CANCELLED: "Отменено",
    DONE: "Готово",
  };
  const makeTask = (
    id,
    title,
    p,
    parent,
    r,
    ex,
    start,
    end,
    pct,
    status = "PLANNED",
    kind = "task",
    description = "",
  ) => ({
    id,
    title,
    project: p,
    parent: parent || null,
    responsible: r || "",
    executors: ex,
    start,
    end,
    percent: pct,
    status,
    kind,
    description,
    comments: [],
    attachments: [],
    startTime: "",
    endTime: "",
    location: "",
    timeZone: "Asia/Jerusalem",
  });
  let model = await getWorkspace();
  TODAY = localToday(model.timeZone);
  const ui = {
    project: "all",
    projects: [],
    taskAll: true,
    taskInclude: [],
    taskExclude: [],
    taskPickerCollapsed: new Set(),
    counterparty: "",
    includeTags: [],
    excludeTags: [],
    tagMode: "any",
    groupBy: "topics",
    searchEverywhere: false,
    from: "",
    to: "",
    dateMode: "overlap",
    filterDraft: null,
    responsible: "",
    executor: "",
    status: "",
    due: "",
    q: "",
    done: false,
    expand: true,
    view: "table",
    ganttOffset: 0,
    collapsed: new Set(),
    closedProjects: new Set(),
    manager: "projects",
    managerArchived: false,
    drawer: null,
    uploads: 0,
    quick: null,
    noteDrafts: {},
  };
  const uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const person = (id) => model.contacts.find((c) => c.id === id),
    proj = (id) => model.projects.find((p) => p.id === id),
    task = (id) => model.tasks.find((t) => t.id === id);
  const initials = (name) =>
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0] || "")
      .join("")
      .toUpperCase();
  function toast(text) {
    $("#toast").textContent = text;
    $("#toast").style.display = "block";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => ($("#toast").style.display = "none"), 2800);
  }
  function dateInfo(t) {
    if (!t.end) return '<span class="muted">Без срока</span>';
    const delta = Math.round((new Date(t.end) - new Date(TODAY)) / DAY);
    const label = new Date(t.end + "T12:00:00")
      .toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
      .replace(".", "");
    return `<div class="date ${delta < 0 && t.status !== "DONE" ? "overdue" : ""}">${E(label)}${delta < 0 && t.status !== "DONE" ? "<small>Просрочено</small>" : delta === 0 ? "<small>Сегодня</small>" : ""}</div>`;
  }
  function responsibleHtml(id) {
    const c = person(id);
    if (!c) return '<span class="muted">Не назначен</span>';
    const n = model.contacts.indexOf(c) % 5;
    return `<div class="person"><span class="avatar a${n}">${E(initials(c.name))}</span><span class="name" title="${E(c.name)}">${E(c.name)}</span></div>`;
  }
  function executorHtml(ids) {
    const names = ids.map((id) => person(id)?.name).filter(Boolean);
    return `<div class="executors" title="${E(names.join(", "))}">${E(names[0] || "Не назначен")}${names.length > 1 ? `<span class="second">+${names.length - 1}</span>` : ""}</div>`;
  }
  function blankQuery() {
    return {
      projects: [],
      taskAll: true,
      taskInclude: [],
      taskExclude: [],
      scope: "work",
      counterparty: "",
      includeTags: [],
      excludeTags: [],
      tagMode: "any",
      executor: "",
      responsible: "",
      status: "",
      from: "",
      to: "",
      dateMode: "overlap",
      showDone: false,
      text: "",
      due: "",
    };
  }
  const cloneQuery = (q) => ({
    ...blankQuery(),
    ...q,
    projects: [...(q.projects || [])],
    taskInclude: [...(q.taskInclude || [])],
    taskExclude: [...(q.taskExclude || [])],
    includeTags: [...(q.includeTags || [])],
    excludeTags: [...(q.excludeTags || [])],
  });
  function queryFromUi() {
    return {
      projects: [...ui.projects],
      taskAll: ui.taskAll,
      taskInclude: [...ui.taskInclude],
      taskExclude: [...ui.taskExclude],
      scope: ui.searchEverywhere
        ? "all"
        : ["events", "calendar"].includes(ui.view)
          ? "events"
          : "work",
      counterparty: ui.counterparty,
      includeTags: [...ui.includeTags],
      excludeTags: [...ui.excludeTags],
      tagMode: ui.tagMode,
      executor: ui.executor,
      responsible: ui.responsible,
      status: ui.status,
      from: ui.from,
      to: ui.to,
      dateMode: ui.dateMode,
      showDone: ui.done,
      text: ui.q,
      due: ui.due,
    };
  }
  function queryMatches(t, q) {
    if (!t || !productUI.beforeQuery(t, q)) return false;
    if (!q.showDone && t.status === "DONE" && q.status !== "DONE") return false;
    const topics =
      t.kind === "event"
        ? t.topics
        : t.activityId && t.kind !== "reference"
          ? task(t.activityId)?.topics || []
          : t.project
            ? [t.project]
            : [];
    if (
      q.projects.length &&
      !(topics.length
        ? topics.some((id) => q.projects.includes(id))
        : q.projects.includes("none"))
    )
      return false;
    const roles = t.kind === "event" ? t.rolePeople : null;
    if (
      q.counterparty &&
      !(roles?.counterparty || t.counterparties || []).includes(q.counterparty)
    )
      return false;
    if (q.executor && !(roles?.executor || t.executors).includes(q.executor))
      return false;
    if (
      q.responsible &&
      !(roles?.responsible || [t.responsible]).includes(q.responsible)
    )
      return false;
    if (q.status && t.status !== q.status) return false;
    const tags = t.allTagIds || t.tagIds || [];
    if (
      q.includeTags?.length &&
      !(q.tagMode === "all"
        ? q.includeTags.every((id) => tags.includes(id))
        : q.includeTags.some((id) => tags.includes(id)))
    )
      return false;
    if (q.excludeTags?.some((id) => tags.includes(id))) return false;
    if (
      q.text &&
      !searchKey(
        `${t.title} ${t.description} ${productUI.extraSearch(t)}`,
      ).includes(searchKey(q.text))
    )
      return false;
    if (
      hasTaskSelection(q) &&
      t.kind === "task" &&
      !taskSelection(q).selected.has(t.id)
    )
      return false;
    if (q.from || q.to) {
      if (q.dateMode === "overlap") {
        const first = t.start || t.end,
          last = t.end || t.start;
        if (!first || (q.from && last < q.from) || (q.to && first > q.to))
          return false;
      } else {
        const date = q.dateMode === "start" ? t.start : t.end;
        if (!date || (q.from && date < q.from) || (q.to && date > q.to))
          return false;
      }
    }
    if (q.due === "late" && !(t.end && t.end < TODAY && t.status !== "DONE"))
      return false;
    if (
      q.due === "week" &&
      !(t.end >= TODAY && t.end <= addDays(TODAY, 6) && t.status !== "DONE")
    )
      return false;
    return true;
  }
  function addDays(date, days) {
    return new Date(new Date(date + "T00:00:00Z").getTime() + days * DAY)
      .toISOString()
      .slice(0, 10);
  }
  let hierarchyCache;
  function hierarchy() {
    if (!hierarchyCache || hierarchyCache.tasks !== model.tasks) {
      hierarchyCache = {
        ...TaskFilter.createIndex(model.tasks),
        tasks: model.tasks,
        branches: new Map(),
        paths: new Map(),
        selection: null,
      };
    }
    return hierarchyCache;
  }
  function selectionInput(q) {
    return {
      all: q.taskAll !== false,
      include: q.taskInclude || [],
      exclude: q.taskExclude || [],
    };
  }
  function setTaskSelection(q, input) {
    const value = TaskFilter.normalize(input);
    q.taskAll = value.all;
    q.taskInclude = value.include;
    q.taskExclude = value.exclude;
  }
  function hasTaskSelection(q) {
    return (
      q.taskAll === false || q.taskInclude?.length || q.taskExclude?.length
    );
  }
  function taskSelection(q) {
    const index = hierarchy(),
      input = selectionInput(q),
      key = JSON.stringify(input);
    if (index.selection?.key !== key)
      index.selection = { key, ...TaskFilter.resolve(index, input) };
    return index.selection;
  }
  function taskPath(id) {
    const index = hierarchy();
    if (index.paths.has(id)) return index.paths.get(id);
    const first = index.byId.get(id);
    if (!first) return "Задача удалена";
    const names = [];
    for (let current = id; current; current = index.parents.get(current))
      names.unshift(index.byId.get(current).title);
    const value = [themeName(first.project || "none"), ...names].join(" › ");
    index.paths.set(id, value);
    return value;
  }
  const searchKey = (value) =>
    String(value || "")
      .normalize("NFC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/g, "е")
      .trim();
  function taskSelectionLabel(q) {
    if (!hasTaskSelection(q)) return "Все задачи выбранных тем";
    if (!q.taskAll && q.taskInclude.length === 1 && !q.taskExclude.length)
      return task(q.taskInclude[0])?.title || "Задача удалена";
    const count = [...taskSelection(q).selected].filter(
      (id) =>
        !q.projects.length || q.projects.includes(task(id).project || "none"),
    ).length;
    return count ? `Отмечено задач: ${count}` : "Задачи не выбраны";
  }
  function taskPickerRows(q, text = "") {
    const index = hierarchy(),
      selection = taskSelection(q),
      words = searchKey(text).split(/\s+/).filter(Boolean);
    const eligible = new Set(
      model.tasks
        .filter((t) => t.kind === "task")
        .filter(
          (t) => !q.projects.length || q.projects.includes(t.project || "none"),
        )
        .map((t) => t.id),
    );
    let visible = eligible;
    if (words.length) {
      visible = new Set();
      for (const id of eligible)
        if (words.every((word) => searchKey(taskPath(id)).includes(word))) {
          let current = id;
          while (current && eligible.has(current) && !visible.has(current)) {
            visible.add(current);
            current = index.parents.get(current);
          }
        }
    }
    const rows = [],
      hidden = new Set();
    for (const entry of index.order) {
      if (!visible.has(entry.id)) continue;
      if (
        !words.length &&
        entry.parent &&
        (hidden.has(entry.parent) || ui.taskPickerCollapsed.has(entry.parent))
      ) {
        hidden.add(entry.id);
        continue;
      }
      rows.push(entry);
    }
    const header = `<div class="task-picker-count" role="status">${rows.length ? `Показано: ${Math.min(rows.length, 200)}${rows.length > 200 ? ` из ${rows.length}. Уточните поиск.` : ""}` : "В выбранных темах совпадений нет"}</div>`;
    return (
      header +
      rows
        .slice(0, 200)
        .map((entry) => {
          const t = entry.task,
            count = selection.stats.get(t.id),
            children = index.children.has(t.id),
            full = count.selected === count.total,
            partial = count.selected > 0 && !full;
          return `<div class="task-option-row" data-task-option="${E(t.id)}" style="--task-depth:${Math.min(entry.level, 6)}">${children ? `<button type="button" class="task-tree-toggle" data-action="task-picker-toggle" data-id="${E(t.id)}" aria-label="${ui.taskPickerCollapsed.has(t.id) && !words.length ? "Раскрыть" : "Свернуть"} подзадачи: ${E(t.title)}" aria-expanded="${!ui.taskPickerCollapsed.has(t.id) || !!words.length}">${icon("chevron", true)}</button>` : '<span class="task-tree-spacer"></span>'}<label><input type="checkbox" data-task-choice="${E(t.id)}" aria-label="Выбрать задачу: ${E(taskPath(t.id))}" ${full ? "checked" : ""} data-partial="${partial}"><span><strong>${E(t.title)}</strong><small>${E(taskPath(t.id))}</small></span></label>${children ? `<button type="button" class="textbtn only-task-branch" data-action="only-task-branch" data-id="${E(t.id)}" aria-label="Только эта ветка: ${E(t.title)}">Только ветка</button>` : ""}</div>`;
        })
        .join("")
    );
  }
  function taskPicker(q) {
    return `<div class="query-field query-task-field"><label>Задачи <span class="task-field-hint">· дерево и галочки</span></label><details class="task-picker"><summary aria-label="Выбрать задачи темы"><span class="task-summary-label">${E(taskSelectionLabel(q))}</span>${icon("chevron", true)}</summary><div class="task-picker-body"><label>Поиск по названию или пути<input class="task-picker-search" aria-label="Найти задачу в дереве" placeholder="Например: выруб, посадка…" maxlength="1000"></label><p>Галочка у родителя выбирает все подзадачи. Ненужные подзадачи можно снять отдельно.</p><div class="task-picker-tools"><button type="button" class="textbtn" data-action="tasks-all">Все задачи</button><button type="button" class="textbtn" data-action="tasks-none">Снять все</button></div><div class="task-options" role="group" aria-label="Дерево задач выбранных тем">${taskPickerRows(q)}</div><div class="task-picker-footer"><span>После выбора нажмите «Применить»</span><button class="btn primary" type="button" data-action="query-apply" data-scope="main">Применить</button></div></div></details></div>`;
  }
  function placeTaskPicker() {
    const picker = $("#filters .task-picker[open]");
    if (!picker) return;
    const summary = picker.querySelector("summary").getBoundingClientRect(),
      body = picker.querySelector(".task-picker-body");
    const width = Math.min(560, innerWidth - 24);
    body.style.width = width + "px";
    body.style.maxWidth = Math.max(0, innerWidth - 24) + "px";
    body.style.maxHeight =
      Math.max(180, Math.min(560, innerHeight - 32)) + "px";
    body.style.left =
      Math.max(12, Math.min(summary.left, innerWidth - width - 12)) + "px";
    body.style.top =
      Math.max(
        16,
        Math.min(summary.bottom + 6, innerHeight - body.offsetHeight - 16),
      ) + "px";
  }
  window.addEventListener("resize", placeTaskPicker);
  document.addEventListener("scroll", placeTaskPicker, true);
  function refreshTaskPicker() {
    const picker = $("#filters .task-picker");
    if (!picker) return;
    const q = queryDraft("main");
    picker.querySelector(".task-summary-label").textContent =
      taskSelectionLabel(q);
    picker.querySelector(".task-options").innerHTML = taskPickerRows(
      q,
      picker.querySelector(".task-picker-search").value,
    );
    for (const checkbox of picker.querySelectorAll('[data-partial="true"]'))
      checkbox.indeterminate = true;
    placeTaskPicker();
  }
  function taskPickerPending() {
    const feedback = $("#query-feedback-main");
    feedback.textContent = "Выбор задач изменён — нажмите «Применить»";
    feedback.classList.remove("error");
    markQueryButtons("main");
  }
  function outputBranchRows(text = "") {
    const q = meeting.queryDraft,
      words = searchKey(text).split(/\s+/).filter(Boolean);
    const candidates = model.tasks.filter(
      (t) =>
        t.kind === "task" &&
        (!q.projects.length || q.projects.includes(t.project || "none")) &&
        words.every((word) => searchKey(taskPath(t.id)).includes(word)),
    );
    candidates.sort(
      (a, b) =>
        Number(words.every((word) => searchKey(b.title).includes(word))) -
          Number(words.every((word) => searchKey(a.title).includes(word))) ||
        Number(hierarchy().children.has(b.id)) -
          Number(hierarchy().children.has(a.id)),
    );
    return `<div class="task-picker-count">Найдено: ${candidates.length}${candidates.length > 60 ? ". Уточните поиск — показаны первые 60." : ""}</div>${candidates
      .slice(0, 60)
      .map(
        (t) =>
          `<button type="button" class="branch-result" data-action="output-branch-select" data-id="${E(t.id)}"><strong>${E(t.title)}</strong><small>${E(taskPath(t.id))}</small></button>`,
      )
      .join("")}`;
  }
  function outputBranchPicker() {
    return `<div class="field"><label>Задача со всеми подзадачами</label><details class="branch-picker"><summary aria-label="Выбрать ветку для вывода"><span>${E(task(meeting.root)?.title || "Выберите ветку")}</span>${icon("chevron", true)}</summary><div class="branch-picker-body"><input class="output-branch-search" aria-label="Найти ветку для вывода" placeholder="Название или путь…"><div class="branch-results">${outputBranchRows()}</div></div></details><small>${E(taskPath(meeting.root))}</small></div>`;
  }
  document.addEventListener("input", (event) => {
    if (event.target.matches(".task-picker-search")) refreshTaskPicker();
    if (event.target.matches(".output-branch-search"))
      event.target
        .closest(".branch-picker")
        .querySelector(".branch-results").innerHTML = outputBranchRows(
        event.target.value,
      );
  });
  document.addEventListener("change", (event) => {
    if (!event.target.matches("[data-task-choice]")) return;
    const q = queryDraft("main");
    setTaskSelection(
      q,
      TaskFilter.toggle(
        hierarchy(),
        selectionInput(q),
        event.target.dataset.taskChoice,
        event.target.checked,
      ),
    );
    refreshTaskPicker();
    taskPickerPending();
  });
  document.addEventListener(
    "toggle",
    (event) => {
      if (!event.target.open) return;
      if (event.target.matches?.(".task-picker")) {
        refreshTaskPicker();
        event.target.querySelector(".task-picker-search")?.focus();
      }
      if (event.target.matches?.(".branch-picker"))
        event.target.querySelector(".output-branch-search")?.focus();
    },
    true,
  );

  function queryError(q) {
    return q.from && q.to && q.from > q.to
      ? "Дата «По» должна быть не раньше даты «С»."
      : "";
  }
  function activeQuery(q) {
    return !!(
      q.projects.length ||
      hasTaskSelection(q) ||
      q.counterparty ||
      q.includeTags?.length ||
      q.excludeTags?.length ||
      q.executor ||
      q.responsible ||
      q.status ||
      q.from ||
      q.to ||
      q.text ||
      q.due
    );
  }
  function themeName(id) {
    return id === "none" ? "Без темы" : proj(id)?.name || "Тема удалена";
  }
  function querySummary(q) {
    const parts = [
      q.projects.length
        ? "Темы: " + q.projects.map(themeName).join(", ")
        : "Все темы",
    ];
    if (hasTaskSelection(q)) parts.push(taskSelectionLabel(q));
    if (q.counterparty)
      parts.push(
        "Контрагент: " + (person(q.counterparty)?.name || "не найден"),
      );
    for (const [key, label] of [
      ["includeTags", "Теги"],
      ["excludeTags", "Без тегов"],
    ])
      if (q[key]?.length)
        parts.push(
          label +
            ": " +
            q[key]
              .map(
                (id) => model.tags.find((t) => t.id === id)?.name || "удалён",
              )
              .join(", "),
        );
    if (q.executor)
      parts.push("Исполнитель: " + (person(q.executor)?.name || "не найден"));
    if (q.responsible)
      parts.push(
        "Ответственный: " + (person(q.responsible)?.name || "не найден"),
      );
    if (q.status) parts.push("Статус: " + statuses[q.status]);
    const dateLabel = {
      overlap: "Задачи в периоде",
      deadline: "Дедлайн",
      start: "Начало",
    }[q.dateMode];
    const format = (d) =>
      d ? new Date(d + "T12:00:00").toLocaleDateString("ru-RU") : "";
    if (q.from || q.to)
      parts.push(
        `${dateLabel}: ${q.from ? "с " + format(q.from) : ""}${q.to ? " по " + format(q.to) : ""}`.trim(),
      );
    if (q.text) parts.push("Поиск: " + q.text);
    if (q.showDone) parts.push("Включая завершённые");
    if (q.due === "late") parts.push("Просроченные");
    return parts.join(" · ");
  }
  function queryDraft(scope) {
    if (scope === "output") return meeting.queryDraft;
    if (!ui.filterDraft) ui.filterDraft = cloneQuery(queryFromUi());
    return ui.filterDraft;
  }
  function themePicker(q, scope) {
    const themes = [
      ...model.projects.filter((p) => !p.archived || q.projects.includes(p.id)),
      { id: "none", name: "Без темы" },
    ];
    return `<details class="query-theme-picker"><summary aria-label="Выбрать темы"><span class="theme-summary-label">${E(q.projects.length ? q.projects.map(themeName).join(", ") : "Все темы")}</span>${icon("chevron", true)}</summary><div class="theme-picker-body"><p>Отметьте одну или несколько тем. Без отметок — все темы.</p><input class="theme-search" placeholder="Найти тему…" aria-label="Поиск темы"><div class="theme-choices">${themes.map((p) => `<label data-theme-name="${E(p.name.toLowerCase())}"><input type="checkbox" data-query-theme="${E(p.id)}" ${q.projects.includes(p.id) ? "checked" : ""}><span>${E(p.name)}</span></label>`).join("")}</div><div class="theme-picker-foot"><button class="textbtn" data-action="query-all-themes" data-scope="${scope}">Все темы</button><button class="btn" data-action="query-themes-done">Готово</button></div></div></details>`;
  }
  function queryControls(q, scope) {
    const contacts = model.contacts.filter(
      (c) => !c.archived || q.executor === c.id || q.responsible === c.id,
    );
    const id = (key) =>
      scope === "main"
        ? {
            executor: "executor-filter",
            counterparty: "counterparty-filter",
            responsible: "responsible-filter",
            status: "status-filter",
            from: "filter-from",
            to: "filter-to",
            dateMode: "filter-date-mode",
          }[key] || "query-" + key
        : "output-" + key;
    const field = (key, label, inner) =>
      `<div class="query-field"><label for="${id(key)}">${label}</label>${inner}</div>`;
    const select = (key, items, first) =>
      `<select id="${id(key)}" data-query-key="${key}" aria-label="${E({ executor: "Исполнитель", responsible: "Ответственный", status: "Статус", counterparty: "Контрагент" }[key] || key)}">${options(items, q[key], first)}</select>`;
    return `<section class="query-panel ${scope === "output" ? "query-output" : ""}" data-query-scope="${scope}"><div class="query-main-row ${scope === "main" ? "with-task-picker" : ""}"><div class="query-field"><label>Темы / проекты <span style="font-weight:400;color:#95a2b5">· выбор галочками</span></label>${themePicker(q, scope)}</div>${scope === "main" && !["events", "calendar"].includes(ui.view) ? taskPicker(q) : ""}${field("counterparty", "Контрагент", select("counterparty", contacts, "Все контрагенты"))}${field("executor", "Исполнитель", select("executor", contacts, "Все исполнители"))}${field(
      "responsible",
      "Ответственный",
      select(
        "responsible",
        contacts.filter(
          (c) =>
            c.responsible ||
            c.id === q.responsible ||
            model.tasks.some((t) => t.responsible === c.id),
        ),
        "Все ответственные",
      ),
    )}${field(
      "status",
      "Статус",
      select(
        "status",
        Object.entries(statuses).map(([id, name]) => ({ id, name })),
        "Все статусы",
      ),
    )}</div><details class="tag-filter-details"><summary>Теги ${q.includeTags.length || q.excludeTags.length ? "· выбраны" : ""}</summary><div class="tag-filter-grid"><div><span>Включить теги</span>${
      model.tags
        .filter((t) => !t.archived || q.includeTags.includes(t.id))
        .map(
          (t) =>
            `<label><input type="checkbox" data-query-tag="includeTags" value="${E(t.id)}" ${q.includeTags.includes(t.id) ? "checked" : ""}>${E(t.name)}</label>`,
        )
        .join("") || "<small>Теги создаются в карточках</small>"
    }<select data-query-key="tagMode" aria-label="Режим тегов"><option value="any" ${q.tagMode === "any" ? "selected" : ""}>Любой выбранный тег</option><option value="all" ${q.tagMode === "all" ? "selected" : ""}>Все выбранные теги</option></select></div><div><span>Исключить теги</span>${model.tags
      .filter((t) => !t.archived || q.excludeTags.includes(t.id))
      .map(
        (t) =>
          `<label><input type="checkbox" data-query-tag="excludeTags" value="${E(t.id)}" ${q.excludeTags.includes(t.id) ? "checked" : ""}>${E(t.name)}</label>`,
      )
      .join(
        "",
      )}</div></div></details><div class="query-period-row">${field("dateMode", "Период — по какой дате", `<select id="${id("dateMode")}" data-query-key="dateMode" ${scope === "main" && ui.view === "deadlines" ? "disabled" : ""}><option value="overlap" ${q.dateMode === "overlap" ? "selected" : ""}>Задачи в периоде</option><option value="deadline" ${q.dateMode === "deadline" ? "selected" : ""}>Дедлайн</option><option value="start" ${q.dateMode === "start" ? "selected" : ""}>Начало задачи</option></select>`)}${field("from", "С", `<input id="${id("from")}" data-query-key="from" type="date" value="${E(q.from)}">`)}${field("to", "По включительно", `<input id="${id("to")}" data-query-key="to" type="date" value="${E(q.to)}">`)}<div class="query-buttons"><button class="btn primary" data-action="query-apply" data-scope="${scope}">Применить</button><button class="btn" data-action="query-reset" data-scope="${scope}">Сбросить</button></div></div><div class="query-date-hint">${q.dateMode === "overlap" ? "Задача попадёт в выборку, если хотя бы часть её срока пересекается с периодом." : q.dateMode === "deadline" ? "В выборку попадут задачи с дедлайном в выбранном диапазоне." : "В выборку попадут задачи, начинающиеся в выбранном диапазоне."}</div><div class="query-presets"><span>Быстрый период:</span>${[
      ["today", "Сегодня"],
      ["week", "7 дней"],
      ["month", "30 дней"],
      ["late", "Просроченные"],
      ["any", "Без периода"],
    ]
      .map(
        ([id, label]) =>
          `<button data-action="query-period" data-id="${id}" data-scope="${scope}">${label}</button>`,
      )
      .join(
        "",
      )}</div>${scope === "output" ? `<div class="query-field"><label for="output-text">Поиск в задачах и записях</label><input id="output-text" data-query-key="text" value="${E(q.text)}" placeholder="Слова из названия или вопроса"></div><label class="meeting-option"><input type="checkbox" data-query-key="showDone" ${q.showDone ? "checked" : ""}>Включить завершённые</label>` : ""}<div class="query-feedback" id="query-feedback-${scope}" role="status"></div></section>`;
  }
  function queryPending(scope) {
    const applied = scope === "output" ? meeting.query : queryFromUi();
    return (
      JSON.stringify(cloneQuery(queryDraft(scope))) !==
      JSON.stringify(cloneQuery(applied))
    );
  }
  function markQueryButtons(scope) {
    if (scope === "output") {
      for (const action of ["meeting-print", "output-csv", "output-xlsx"]) {
        const button = $('#meeting-root [data-action="' + action + '"]');
        if (button) button.disabled = !meeting.valid || queryPending(scope);
      }
    } else {
      const button = $('.head-actions [data-action="meeting-open"]');
      if (button) button.disabled = queryPending(scope);
    }
  }
  function applyQuery(scope) {
    const q = cloneQuery(queryDraft(scope)),
      error = queryError(q),
      feedback = $("#query-feedback-" + scope);
    if (error) {
      feedback.textContent = error;
      feedback.classList.add("error");
      return;
    }
    if (scope === "output") {
      meeting.query = q;
      meeting.queryDraft = cloneQuery(q);
      refreshOutputCandidates();
      renderMeetingTree();
      renderMeetingPreview();
    } else {
      if (ui.view === "deadlines") q.dateMode = "deadline";
      q.showDone = ui.done;
      ui.projects = [...q.projects];
      ui.project = q.projects.length === 1 ? q.projects[0] : "all";
      setTaskSelection(ui, selectionInput(q));
      ui.counterparty = q.counterparty;
      ui.includeTags = [...q.includeTags];
      ui.excludeTags = [...q.excludeTags];
      ui.tagMode = q.tagMode;
      for (const key of [
        "executor",
        "responsible",
        "status",
        "from",
        "to",
        "dateMode",
        "due",
      ])
        ui[key] = q[key];
      ui.q = q.text;
      $("#search").value = ui.q;
      ui.filterDraft = cloneQuery(q);
      render();
    }
    document
      .querySelectorAll(".query-theme-picker[open]")
      .forEach((p) => (p.open = false));
    const status = $("#query-feedback-" + scope);
    if (status) {
      status.textContent = "Фильтры применены";
      status.classList.remove("error");
    }
  }
  function resetQuery(scope) {
    if (scope === "output") {
      meeting.queryDraft = blankQuery();
      meeting.queryDraft.dateMode = meeting.query.dateMode;
      meeting.excluded.clear();
    } else {
      ui.filterDraft = blankQuery();
      ui.filterDraft.showDone = ui.done;
      if (ui.view === "deadlines") ui.filterDraft.dateMode = "deadline";
    }
    applyQuery(scope);
    if (scope === "output") {
      renderMeetingControls();
      renderMeetingPreview();
    }
  }
  function quickPeriod(scope, period) {
    const q = queryDraft(scope);
    q.due = "";
    q.from = period === "any" ? "" : TODAY;
    q.to =
      period === "any"
        ? ""
        : period === "today"
          ? TODAY
          : period === "week"
            ? addDays(TODAY, 6)
            : addDays(TODAY, 29);
    if (period === "late") {
      q.from = "";
      q.to = addDays(TODAY, -1);
      q.dateMode = "deadline";
    }
    applyQuery(scope);
    if (scope === "output") {
      renderMeetingControls();
      renderMeetingPreview();
    }
  }
  function queryInput(event) {
    const panel = event.target.closest("[data-query-scope]");
    if (!panel) return;
    const scope = panel.dataset.queryScope,
      q = queryDraft(scope),
      target = event.target;
    if (target.classList.contains("theme-search")) {
      const value = target.value.toLowerCase();
      panel
        .querySelectorAll("[data-theme-name]")
        .forEach(
          (row) => (row.hidden = !row.dataset.themeName.includes(value)),
        );
      return;
    }
    if (target.dataset.queryTheme) {
      const id = target.dataset.queryTheme;
      q.projects = target.checked
        ? [...new Set([...q.projects, id])]
        : q.projects.filter((p) => p !== id);
      if (scope === "main") {
        setTaskSelection(q, { all: true });
        refreshTaskPicker();
      }
      panel.querySelector(".theme-summary-label").textContent = q.projects
        .length
        ? q.projects.map(themeName).join(", ")
        : "Все темы";
    } else if (target.dataset.queryTag) {
      const key = target.dataset.queryTag;
      q[key] = target.checked
        ? [...new Set([...q[key], target.value])]
        : q[key].filter((id) => id !== target.value);
    } else if (target.dataset.queryKey)
      q[target.dataset.queryKey] =
        target.type === "checkbox" ? target.checked : target.value;
    else return;
    const feedback = $("#query-feedback-" + scope);
    feedback.textContent =
      queryError(q) || "Изменения не применены — нажмите «Применить»";
    feedback.classList.toggle("error", !!queryError(q));
    markQueryButtons(scope);
    if (target.dataset.queryKey === "dateMode")
      panel.querySelector(".query-date-hint").textContent =
        q.dateMode === "overlap"
          ? "Задачи, чей срок пересекается с выбранным периодом."
          : q.dateMode === "deadline"
            ? "Задачи с дедлайном в диапазоне."
            : "Задачи, начинающиеся в диапазоне.";
  }
  document.addEventListener("input", queryInput);
  document.addEventListener("change", (event) => {
    if (event.target.tagName === "SELECT") queryInput(event);
  });
  document.addEventListener("click", (event) => {
    document
      .querySelectorAll(
        ".query-theme-picker[open], .task-picker[open], .branch-picker[open]",
      )
      .forEach((p) => {
        if (!p.contains(event.target)) p.open = false;
      });
  });
  function updateQuerySummary() {
    const q = queryFromUi(),
      count = model.tasks.filter((t) => queryMatches(t, q)).length;
    $("#chips").innerHTML =
      `<span class="applied-query"><strong>Найдено: ${count}</strong> · ${E(querySummary(q))}</span>${activeQuery(q) ? '<button class="textbtn" data-action="query-reset" data-scope="main">Сбросить выборку</button>' : ""}`;
  }
  function renderFilters() {
    const draft = queryDraft("main");
    $("#filters").innerHTML =
      queryControls(draft, "main") +
      `<div class="query-view-options"><label><input id="show-done" type="checkbox" ${ui.done ? "checked" : ""}>Показывать завершённые</label><label><input id="expand-all" type="checkbox" ${ui.expand ? "checked" : ""}>Раскрыть подзадачи</label><div class="view-switch"><button class="${ui.view === "table" ? "active" : ""}" data-action="view" data-id="table" title="Таблица">${icon("lines", true)}</button><button class="${ui.view === "gantt" ? "active" : ""}" data-action="view" data-id="gantt" title="Гант">${icon("gantt", true)}</button></div></div>`;
    updateQuerySummary();
    markQueryButtons("main");
    productUI.afterFilters();
  }
  function matches(t) {
    return queryMatches(t, queryFromUi());
  }
  function filtered() {
    const direct = model.tasks.filter(matches);
    return { direct, set: new Set(direct.map((t) => t.id)), rows: direct };
  }
  function descendants(id) {
    const index = hierarchy();
    if (!index.branches.has(id))
      index.branches.set(id, TaskFilter.descendants(index, id));
    return index.branches.get(id);
  }
  function treeRows(items) {
    const ids = new Set(items.map((t) => t.id)),
      out = [],
      seen = new Set();
    function visit(t, level) {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      out.push({ t, level });
      if (ui.expand && !ui.collapsed.has(t.id))
        for (const c of items.filter((c) => c.parent === t.id))
          visit(c, level + 1);
    }
    for (const t of items.filter((t) => !t.parent || !ids.has(t.parent)))
      visit(t, 0);
    for (const t of items)
      if (!seen.has(t.id) && (!t.parent || !ids.has(t.parent))) visit(t, 0);
    return out;
  }
  function renderSide() {
    const active = model.tasks.filter(
      (t) => t.kind === "task" && t.status !== "DONE",
    );
    $("#all-count").textContent = active.length;
    $("#none-count").textContent = active.filter((t) => !t.project).length;
    $("#all-link").classList.toggle("selected", ui.projects.length === 0);
    $("#none-link").classList.toggle("selected", ui.projects.includes("none"));
    $("#project-list").innerHTML = model.projects
      .filter((p) => !p.archived)
      .map(
        (p) =>
          `<button class="side-item ${ui.projects.includes(p.id) ? "selected" : ""}" data-action="project" data-id="${E(p.id)}" title="${E(p.name)}"><span class="dot" style="--dot:${E(p.color)}"></span><span class="label">${E(p.name)}</span><span class="num">${active.filter((t) => t.project === p.id).length}</span></button>`,
      )
      .join("");
  }
  function options(items, selected, first) {
    return (
      `<option value="">${E(first)}</option>` +
      items
        .map(
          (x) =>
            `<option value="${E(x.id)}" ${x.id === selected ? "selected" : ""}>${E(x.name)}</option>`,
        )
        .join("")
    );
  }
  const record = (id) =>
    task(id) || (ui.drawer?.data.id === id ? ui.drawer.data : null);
  const noteDate = () =>
    new Date().toLocaleString("ru-RU", {
      timeZone: "Asia/Jerusalem",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  const previewUrls = new Set();
  function revokePreviews() {
    for (const url of previewUrls) URL.revokeObjectURL(url);
    previewUrls.clear();
  }
  function fileSize(size) {
    return size < 1024
      ? `${size} Б`
      : size < 1048576
        ? `${Math.round(size / 1024)} КБ`
        : `${(size / 1048576).toFixed(1)} МБ`;
  }
  function attachmentList(t, compact = false) {
    const files = allFiles(t.id);
    if (compact)
      return (
        files
          .slice(-2)
          .map(
            (f) =>
              `<button type="button" class="file-chip" data-action="preview-file" data-id="${E(t.id)}" data-file="${E(f.id)}" title="Просмотреть ${E(f.name)}">${icon("paperclip", true)}${E(f.name)}</button>`,
          )
          .join("") +
        (files.length > 2
          ? `<button class="textbtn" data-action="edit-task" data-id="${E(t.id)}">ещё ${files.length - 2}</button>`
          : "")
      );
    return (
      files
        .map(
          (f) =>
            `<div class="attachment-row"><button type="button" class="attachment-name" data-action="preview-file" data-id="${E(t.id)}" data-file="${E(f.id)}">${icon("paperclip", true)}<span>${E(f.name)}<small>${fileSize(f.size)} · ${f.pending ? "ожидает загрузки" : "открыть"}</small></span></button><button type="button" class="tinybtn" data-action="download-file" data-id="${E(t.id)}" data-file="${E(f.id)}" aria-label="Скачать ${E(f.name)}" title="Скачать">${icon("download", true)}</button><button type="button" class="tinybtn" data-action="remove-file" data-id="${E(t.id)}" data-file="${E(f.id)}" aria-label="Удалить файл ${E(f.name)}" title="Удалить файл">${icon("trash", true)}</button></div>`,
        )
        .join("") ||
      '<p class="activity-empty">Документы, фотографии и материалы к задаче.</p>'
    );
  }
  function notesHtml(t) {
    return (
      (t.comments || [])
        .map(
          (c) =>
            `<div class="activity-note ${c.kind === "question" ? (c.resolved ? "resolved-note" : "question-note") : ""}"><div class="note-heading"><strong>${c.kind === "question" ? (c.resolved ? "Вопрос решён" : "Открытый вопрос") : "Комментарий"}</strong><span>Вы · ${E(c.date)}</span>${c.kind === "question" ? `<button type="button" class="textbtn" data-action="resolve-note" data-id="${E(t.id)}" data-note="${E(c.id)}" data-revision="${c.revision || 0}" data-resolved="${!c.resolved}">${c.resolved ? "Открыть снова" : "Отметить решённым"}</button>` : ""}</div><div class="note-body">${E(c.text)}</div></div>`,
        )
        .join("") ||
      '<p class="activity-empty">Запишите вопрос или договорённость — они будут видны и в списке задач.</p>'
    );
  }
  function noteComposer(t, scope) {
    const draft = ui.noteDrafts[`${scope}:${t.id}`] || {
      kind: "comment",
      text: "",
    };
    return `<div class="note-composer" data-task="${E(t.id)}" data-scope="${scope}"><div class="composer-top"><select class="note-kind" aria-label="Тип записи"><option value="comment" ${draft.kind === "comment" ? "selected" : ""}>Комментарий</option><option value="question" ${draft.kind === "question" ? "selected" : ""}>Вопрос</option></select><span>Enter — добавить · Shift+Enter — новая строка</span></div><div class="composer-input"><textarea ${scope === "drawer" ? 'id="comment-text"' : ""} class="note-text" rows="2" maxlength="10000" placeholder="Быстро записать комментарий или вопрос…" aria-label="Комментарий или вопрос">${E(draft.text)}</textarea><button type="button" class="btn primary" data-action="post-note" data-id="${E(t.id)}">Добавить</button></div></div>`;
  }
  function activitySummary(t) {
    const comments = t.comments || [],
      open = comments.filter((c) => c.kind === "question" && !c.resolved),
      last = comments.at(-1);
    const summaries = [
      ...(open.length ? [open.at(-1)] : []),
      ...(last && last !== open.at(-1) ? [last] : []),
    ];
    return `<div class="activity-summary">${summaries.map((c) => `<button class="note-preview ${c.kind === "question" && !c.resolved ? "question-preview" : ""}" type="button" data-action="quick-note" data-id="${E(t.id)}"><strong>${c.kind === "question" ? (c.resolved ? "Вопрос решён" : "Вопрос") : "Комментарий"}:</strong> ${E(c.text)}</button>`).join("")}<div class="task-activity-actions">${attachmentList(t, true)}<button type="button" class="textbtn quick-note-button" data-action="quick-note" data-id="${E(t.id)}">${icon("message", true)} Комментарий / вопрос${open.length ? ` <span class="question-count">Вопросов: ${open.length}</span>` : ""}</button><label class="textbtn quick-file">${icon("paperclip", true)} Файл<input type="file" multiple data-upload-task="${E(t.id)}" aria-label="Прикрепить файлы к ${E(t.title)}" hidden></label></div></div>`;
  }
  function refreshActivity(id) {
    const focus = document.activeElement,
      composer = focus?.closest(".note-composer"),
      restore =
        composer && focus.classList.contains("note-text")
          ? {
              id: composer.dataset.task,
              scope: composer.dataset.scope,
              start: focus.selectionStart,
              end: focus.selectionEnd,
            }
          : null;
    renderContent();
    if (restore) {
      const input = document.querySelector(
        `.note-composer[data-task="${CSS.escape(restore.id)}"][data-scope="${restore.scope}"] .note-text`,
      );
      input?.focus();
      input?.setSelectionRange(restore.start, restore.end);
    }

    if (ui.drawer?.data.id === id) {
      const t = record(id);
      if ($("#drawer-files")) $("#drawer-files").innerHTML = attachmentList(t);
      if ($("#comment-list")) $("#comment-list").innerHTML = notesHtml(t);
    }
  }
  async function previewFile(id, fileId, download = false) {
    const file = allFiles(id).find((f) => f.id === fileId);
    if (!file) return;
    try {
      const blob = await attachmentBlob(file);
      if (!blob) {
        toast("Файл недоступен в этом браузере. Прикрепите его заново.");
        return;
      }
      if (download) {
        const url = URL.createObjectURL(blob),
          link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return;
      }
      if (/\.(docx|xlsx|xls|xlsb|xlsm|ods)$/i.test(file.name)) {
        await previewOffice(file, blob, id);
        return;
      }
      closeModal();
      const url = URL.createObjectURL(blob);
      previewUrls.add(url);
      let body;
      if (/^image\/(png|jpeg|gif|webp|bmp|avif|svg\+xml)$/.test(blob.type))
        body = `<img class="file-image" src="${url}" alt="${E(file.name)}">`;
      else if (
        (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) &&
        (await blob.slice(0, 5).text()) === "%PDF-"
      ) {
        const pdfUrl = URL.createObjectURL(
          new Blob([blob], { type: "application/pdf" }),
        );
        previewUrls.add(pdfUrl);
        body = `<iframe class="file-pdf" src="${pdfUrl}" title="${E(file.name)}"></iframe>`;
      } else if (
        /^text\/(plain|csv)/.test(blob.type) ||
        /\.(txt|md|csv|json|log)$/i.test(file.name)
      )
        body = `<pre class="file-text">${E(await blob.slice(0, 1048576).text())}</pre>${blob.size > 1048576 ? '<p class="activity-empty">Показан первый 1 МБ. Полный файл можно скачать.</p>' : ""}`;
      else
        body =
          '<div class="file-unavailable">Для этого формата встроенный просмотр недоступен.<br>Скачайте файл и откройте его в установленной программе.</div>';
      modal(
        file.name,
        `<div class="preview-meta">${fileSize(file.size)} · Вложение задачи</div>${body}`,
        `<button class="btn" data-action="close-modal">Закрыть</button><button class="btn primary" data-action="download-file" data-id="${E(id)}" data-file="${E(file.id)}">${icon("download", true)}Скачать файл</button>`,
      );
      $("#modal-root .modal").classList.add("preview-modal");
    } catch {
      toast("Не удалось открыть файл. Попробуйте прикрепить его заново.");
    }
  }
  let officeView = null;
  function excelValue(cell, book) {
    if (!cell) return "";
    if (cell.t === "n" && cell.z && XLSX.SSF.is_date(cell.z)) {
      const format = cell.z.replace(/([dmy])\.(?=[dmy])/gi, '$1"."');
      try {
        return XLSX.SSF.format(format, cell.v, {
          date1904: !!book.Workbook?.WBProps?.date1904,
        });
      } catch {}
    }
    return cell.w ?? XLSX.utils.format_cell(cell);
  }
  function renderWorkbook() {
    const view = officeView,
      book = view?.book,
      sheet = book?.Sheets[book.SheetNames[view.sheet]];
    if (!sheet) return;
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
    const rowStart = range.s.r + view.row * 100,
      colStart = range.s.c + view.col * 30;
    const rowEnd = Math.min(range.e.r, rowStart + 99),
      colEnd = Math.min(range.e.c, colStart + 29);
    let head = '<th class="sheet-corner">№</th>';
    for (let col = colStart; col <= colEnd; col++)
      head += `<th>${XLSX.utils.encode_col(col)}</th>`;
    let rows = "";
    for (let row = rowStart; row <= rowEnd; row++) {
      let cells = `<th>${row + 1}</th>`;
      for (let col = colStart; col <= colEnd; col++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
        const value = excelValue(cell, book);
        cells += `<td class="${row === range.s.r ? "first-sheet-row" : ""}">${E(value)}</td>`;
      }
      rows += `<tr>${cells}</tr>`;
    }
    const pageInfo = `Строки ${rowStart + 1}–${rowEnd + 1} из ${range.e.r + 1} · Столбцы ${XLSX.utils.encode_col(colStart)}–${XLSX.utils.encode_col(colEnd)}`;
    $("#office-body").innerHTML =
      `<div class="office-toolbar">${book.SheetNames.map((name, index) => `<button type="button" class="btn ${index === view.sheet ? "soft" : ""}" data-action="office-sheet" data-id="${index}">${E(name)}</button>`).join("")}</div><div class="spreadsheet-scroll"><table class="spreadsheet"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div><div class="sheet-pagination"><span>${E(pageInfo)}</span><button class="btn" data-action="office-row" data-id="-1" ${view.row === 0 ? "disabled" : ""}>↑ 100 строк</button><button class="btn" data-action="office-row" data-id="1" ${rowEnd >= range.e.r ? "disabled" : ""}>↓ 100 строк</button><button class="btn" data-action="office-col" data-id="-1" ${view.col === 0 ? "disabled" : ""}>← Столбцы</button><button class="btn" data-action="office-col" data-id="1" ${colEnd >= range.e.c ? "disabled" : ""}>Столбцы →</button></div><p class="activity-empty">Режим просмотра. Значения и формат чисел берутся из файла; формулы не пересчитываются, макросы не выполняются.</p>`;
  }
  function updateEventFields() {
    const event = $("#task-kind").value === "event";
    $("#event-fields").hidden = !event;
    $("#percent-field").hidden = event;
    $("#task-percent").disabled = event;
    $("#kind-hint").textContent = event
      ? "Встреча, звонок или поездка: дата, время и участники."
      : "Задача: результат, который нужно получить к сроку.";
    $("#executor-label").textContent = event
      ? "Участники / исполнители"
      : "Исполнители";
  }
  function deadlineHeading(date) {
    if (!date) return "Без срока";
    if (date === TODAY)
      return (
        "Сегодня · " +
        new Date(date + "T12:00:00").toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
        })
      );
    const delta = Math.round((new Date(date) - new Date(TODAY)) / DAY);
    return `${delta === 1 ? "Завтра · " : ""}${new Date(date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" })}`;
  }
  function deadlineSection(label, rows, late = false) {
    return `<section class="section deadline-section"><div class="section-head"><span class="dot" style="--dot:${late ? "#d97174" : "#7ba0df"}"></span><h2>${E(label)}</h2><span class="count">${rows.length}</span></div><div class="table-head"><span>Задача / тема</span><span>Исполнитель</span><span>Ответственный</span><span>Дедлайн</span><span class="progress-col">Готовность</span><span>Статус</span><span></span></div>${rows.map((t) => renderTaskRow(t, 0, true, true)).join("")}</section>`;
  }
  function renderDeadlines() {
    const q = { ...queryFromUi(), dateMode: "deadline" },
      all = model.tasks
        .filter((t) => queryMatches(t, q))
        .sort((a, b) => a.end.localeCompare(b.end));
    const late = all.filter(
        (t) => t.end && t.end < TODAY && t.status !== "DONE",
      ),
      upcoming = all.filter(
        (t) => t.end && (t.end >= TODAY || t.status === "DONE"),
      );
    $("#page-title").textContent = "Дедлайны";
    $("#breadcrumb").textContent = "Рабочее пространство / Дедлайны";
    $("#page-subtitle").textContent =
      "Одна выборка для экрана, печати и экспорта. Период задаётся в фильтрах.";
    let html = "";
    if (late.length) html += deadlineSection("Просрочено", late, true);
    for (const date of [...new Set(upcoming.map((t) => t.end))])
      html += deadlineSection(
        deadlineHeading(date),
        upcoming.filter((t) => t.end === date),
      );
    const undated = all.filter((t) => !t.end);
    if (undated.length) html += deadlineSection("Без срока", undated);
    if (!all.length)
      html =
        '<div class="section empty"><h3>В выбранном периоде дедлайнов нет</h3><p>Измените даты, темы или человека в фильтрах.</p></div>';
    $("#task-content").innerHTML = html;
    $("#result-count").textContent =
      `Найдено: ${all.length} · Из них просрочено: ${late.length}`;
  }

  function renderTaskRow(t, level, matched, showProject = false) {
    const kids = hierarchy().children.get(t.id)?.length || 0;
    return `<div class="task-row ${kids ? "parent" : ""} ${matched ? "" : "context"}" data-task="${E(t.id)}"><div class="task-cell" style="padding-left:${level * 21}px"><span class="arrow-holder">${kids && !showProject ? `<button class="collapse ${ui.collapsed.has(t.id) || !ui.expand ? "shut" : ""}" data-action="toggle-task" data-id="${E(t.id)}" aria-label="${ui.collapsed.has(t.id) ? "Раскрыть" : "Свернуть"} подзадачи" aria-expanded="${!ui.collapsed.has(t.id) && ui.expand}">${icon("chevron")}</button>` : ""}</span><span class="task-icon ${t.kind === "event" ? "event" : ""}">${icon(t.kind === "event" ? "calendar" : "task", true)}</span><div class="task-label"><button class="task-title" data-action="edit-task" data-id="${E(t.id)}">${E(t.title)}</button>${kids ? `<span class="child-count">${kids}</span><button type="button" class="branch-shortcut" data-action="only-task-branch" data-id="${E(t.id)}" aria-label="Вся ветка: ${E(t.title)}">Вся ветка</button>` : ""}${showProject ? `<span class="task-project-label">${E(proj(t.project)?.name || "Без темы")}</span>` : ""}${!matched ? '<small class="task-desc">Родительская задача</small>' : t.description ? `<small class="task-desc">${E(t.description)}</small>` : ""}${t.kind === "event" && (t.startTime || t.location) ? `<div class="event-summary">${E(t.startTime || "Весь день")}${t.endTime ? "–" + E(t.endTime) : ""}${t.location ? " · " + E(t.location) : ""}</div>` : ""}${t.parent && task(t.parent) && !matches(task(t.parent)) ? `<small class="task-parent-path">Внутри: ${E(taskPath(t.parent))}</small>` : ""}${activitySummary(t)}</div></div>${executorHtml(t.executors)}${responsibleHtml(t.responsible)}${dateInfo(t)}<div class="progress-wrap progress-col">${t.kind === "event" ? '<span class="muted">Мероприятие</span>' : `<span class="track"><i style="width:${t.percent}%"></i></span>${t.percent}%`}</div><div><span class="status ${t.status}"><i></i>${statuses[t.status]}</span></div><button class="rowmore" data-action="task-menu" data-id="${E(t.id)}" aria-label="Действия: ${E(t.title)}">⋯</button>${ui.quick === t.id ? `<section class="inline-activity"><div class="activity-heading">Комментарии и вопросы<button type="button" class="tinybtn" data-action="quick-note" data-id="${E(t.id)}" aria-label="Закрыть быстрые записи">${icon("close", true)}</button></div><div class="notes-list">${notesHtml(t)}</div>${noteComposer(t, "row")}</section>` : ""}</div>`;
  }
  function section(p, rows, directSet) {
    const id = p?.id || "",
      name = p?.name || "Без темы",
      color = p?.color || "#b7c0ce",
      closed = ui.closedProjects.has(id),
      matched = rows.filter((t) => directSet.has(t.id)).length;
    const header = `<div class="section-head"><button class="collapse ${closed ? "shut" : ""}" data-action="toggle-project" data-id="${E(id)}" aria-label="Свернуть тему">${icon("chevron")}</button><span class="dot" style="--dot:${E(color)}"></span><h2>${E(name)}</h2><span class="count">${matched}</span><span class="section-hint">${p?.archived ? "Скрытая тема" : id === "web" ? "Задачи и подзадачи сайта" : ""}</span><button class="textbtn add" data-action="add-to-project" data-id="${E(id)}">+ Задача</button></div>`;
    if (closed) return `<section class="section">${header}</section>`;
    let content;
    if (ui.view === "gantt") content = gantt(rows);
    else
      content = `<div class="table-head"><span>Задача</span><span>Исполнитель</span><span>Ответственный</span><span>Срок</span><span class="progress-col">Готовность</span><span>Статус</span><span></span></div>${treeRows(
        rows,
      )
        .map(({ t, level }) => renderTaskRow(t, level, directSet.has(t.id)))
        .join("")}`;
    return `<section class="section">${header}${content}</section>`;
  }
  function gantt(rows) {
    const start = new Date(TODAY);
    start.setUTCDate(start.getUTCDate() - 4 + ui.ganttOffset);
    let days = "";
    for (let i = 0; i < 21; i++) {
      const d = new Date(+start + i * DAY);
      days += `<span class="day ${d.toISOString().slice(0, 10) === TODAY ? "today" : ""}">${d.getUTCDate()}</span>`;
    }
    return `<div class="gantt-scroll"><div class="gantt-row"><div class="gantt-label muted">${E(start.toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }))}</div><div class="gantt-days">${days}</div></div>${treeRows(
      rows,
    )
      .map(({ t, level }) => {
        const from = Math.round((new Date(t.start || t.end) - start) / DAY),
          to = Math.round((new Date(t.end || t.start) - start) / DAY),
          visible = to >= 0 && from < 21;
        return `<div class="gantt-row"><div class="gantt-label" style="padding-left:${16 + level * 18}px"><button class="task-title" data-action="edit-task" data-id="${E(t.id)}">${E(t.title)}</button></div><div class="gantt-days">${'<span class="day"></span>'.repeat(21)}${visible ? `<button class="bar" style="left:${(Math.max(0, from) / 21) * 100}%;width:${((Math.min(20, to) - Math.max(0, from) + 1) / 21) * 100}%" data-action="edit-task" data-id="${E(t.id)}" aria-label="${E(t.title)}"><span style="width:${t.percent}%"></span><b>${t.percent}%</b></button>` : `<span class="off-range">${t.start || t.end ? "Вне диапазона" : "Без срока"}</span>`}</div></div>`;
      })
      .join("")}</div>`;
  }
  function renderContent() {
    updateQuerySummary();
    syncLocation();
    const status = $("#unassigned-count");
    if (status)
      status.textContent = model.migration?.unassigned
        ? "Без темы: " + model.migration.unassigned
        : "";
    $("#nav-deadlines").classList.toggle("active", ui.view === "deadlines");
    $("#nav-table").classList.toggle("active", ui.view === "table");
    $("#nav-gantt").classList.toggle("active", ui.view === "gantt");
    $("#nav-events")?.classList.toggle(
      "active",
      ["events", "calendar"].includes(ui.view),
    );
    if (productUI.renderView()) return;
    if (ui.view === "deadlines") {
      renderDeadlines();
      return;
    }
    const { direct, set, rows } = filtered();
    $("#page-title").textContent =
      ui.projects.length > 1
        ? "Выбранные темы (" + ui.projects.length + ")"
        : ui.project === "all"
          ? "Все темы"
          : ui.project === "none"
            ? "Без темы"
            : proj(ui.project)?.name || "Тема";
    $("#breadcrumb").textContent =
      ui.project === "all"
        ? "Рабочее пространство / Задачи"
        : "Темы / " + $("#page-title").textContent;
    $("#page-subtitle").textContent =
      ui.project === "all"
        ? "Рабочие задачи и подзадачи, сгруппированные по темам"
        : "Задачи, подзадачи и мероприятия этой темы";
    if (!ui.taskAll && ui.taskInclude.length === 1 && !ui.taskExclude.length) {
      const root = task(ui.taskInclude[0]);
      $("#page-title").textContent = root?.title || "Выбранная задача удалена";
      $("#breadcrumb").textContent = taskPath(ui.taskInclude[0]);
      $("#page-subtitle").textContent =
        "Выбранная задача и все подзадачи · остальные фильтры действуют внутри выборки";
    }
    $("#result-count").textContent =
      `В выборке: ${direct.length} · Из них просрочено: ${direct.filter((t) => t.end && t.end < TODAY && t.status !== "DONE").length}`;
    const topic = ui.projects.length === 1 ? proj(ui.projects[0]) : null;
    if (topic?.description) $("#page-subtitle").textContent = topic.description;
    if (productUI.renderGrouped(rows)) return;
    let html =
      ui.view === "gantt"
        ? '<div class="gantt-navigation"><button class="btn" data-action="gantt-previous">← 3 недели</button><button class="btn" data-action="gantt-today">Сегодня</button><button class="btn" data-action="gantt-next">3 недели →</button></div>'
        : "";
    for (const p of [
      ...model.projects,
      { id: "", name: "Без темы", color: "#b7c0ce" },
    ]) {
      const group = rows.filter((t) => t.project === p.id);
      if (group.length) html += section(p, group, set);
    }
    $("#task-content").innerHTML =
      html ||
      `<div class="section empty"><div class="empty-icon">${icon("folder")}</div><h3>${activeQuery(queryFromUi()) ? "Задач по этим условиям нет" : "В этой теме пока нет задач"}</h3><p>${activeQuery(queryFromUi()) ? "Попробуйте снять один из фильтров." : "Создайте первую рабочую задачу."}</p><button class="btn ${activeQuery(queryFromUi()) ? "" : "primary"}" data-action="${activeQuery(queryFromUi()) ? "reset-filters" : "create-task"}">${activeQuery(queryFromUi()) ? "Сбросить фильтры" : "+ Создать задачу"}</button></div>`;
    $("#nav-table").classList.toggle("active", ui.view === "table");
    $("#nav-gantt").classList.toggle("active", ui.view === "gantt");
  }
  function render() {
    renderSide();
    renderFilters();
    renderContent();
  }
  function closeModal() {
    if (requests && $("#modal-root").children.length) {
      toast("Дождитесь завершения сохранения");
      return;
    }
    revokePreviews();
    officeView?.cancel?.();
    officeView = null;
    $("#modal-root").innerHTML = "";
    const url = new URL(location.href);
    url.searchParams.delete("manage");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  function modal(title, body, footer = "", small = false) {
    $("#modal-root").innerHTML =
      `<div class="modal-backdrop"><section class="modal ${small ? "small" : ""}" role="dialog" aria-modal="true" aria-label="${E(title)}"><div class="modal-head"><h2>${E(title)}</h2><button class="tinybtn" data-action="close-modal" aria-label="Закрыть">${icon("close")}</button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ""}</section></div>`;
  }
  function openTask(
    id = null,
    parent = null,
    project = null,
    kind = "task",
    extra = {},
  ) {
    productUI.openCard(id, parent, project, kind, extra);
  }
  function deleteTask(id) {
    const t = task(id);
    if (!t) return;
    pendingTaskDeletion = { id, revision: t.revision };
    const message =
      t.kind === "event"
        ? "Мероприятие и его собственные вопросы и подготовка будут удалены. Рабочие задачи останутся в темах. Вложенные мероприятия сохранятся самостоятельно."
        : t.kind === "task"
          ? "Подзадачи сохранятся и перейдут к родителю удалённой задачи. Связанные мероприятия и их собственные материалы сохранятся."
          : "Удалится этот пункт с собственным обсуждением. Вложенные пункты сохранятся. Связанная рабочая задача останется в своей теме.";
    modal(
      "Удалить запись?",
      `<p>${E(t.title)}</p><p class="activity-empty">${message}</p>`,
      `<button class="btn" data-action="close-modal">Отмена</button><button class="btn danger" data-action="confirm-task-delete" data-id="${E(id)}">Удалить запись</button>`,
      true,
    );
  }
  function manage(tab = ui.manager) {
    ui.manager = tab;
    $("#modal-root").innerHTML =
      `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="Справочники"><div class="modal-head"><div><h2>Справочники</h2><p>Одно имя — одна карточка. Роли и связи сохраняются при переименовании.</p></div><button class="tinybtn" data-action="close-modal" aria-label="Закрыть">${icon("close")}</button></div><div class="tabs">${[
        ["projects", "Темы / проекты"],
        ["contacts", "Контрагенты"],
        ["responsibles", "Ответственные"],
        ["tags", "Теги"],
      ]
        .map(
          ([id, label]) =>
            `<button data-action="manage-tab" data-id="${id}" class="${tab === id ? "active" : ""}">${label}</button>`,
        )
        .join(
          "",
        )}</div><div class="modal-body"><div class="manage-top"><label style="display:flex;gap:7px;font-size:11px;color:#8b9aaf;align-items:center"><input id="manager-archived" type="checkbox" ${ui.managerArchived ? "checked" : ""}>Показывать скрытые</label><button class="btn primary" data-action="directory-add">${icon("plus", true)}${tab === "projects" ? "Тема" : tab === "responsibles" ? "Ответственный" : tab === "tags" ? "Тег" : "Контрагент"}</button></div><div id="directory-list"></div></div><div class="modal-foot"><button class="btn" data-action="close-modal">Готово</button></div></section></div>`;
    renderDirectory();
  }
  function renderDirectory() {
    const mode = ui.manager;
    let items =
      mode === "projects"
        ? model.projects
        : mode === "tags"
          ? model.tags
          : model.contacts.filter(
              (c) => mode !== "responsibles" || c.responsible,
            );
    items = items.filter((item) => !item.archived || ui.managerArchived);
    $("#directory-list").innerHTML =
      `<div class="dir-head"><span>Название</span><span>${mode === "projects" ? "Состояние" : "Роли"}</span><span>Задач</span><span style="text-align:right">Действия</span></div>${
        items
          .map((item) => {
            const count = model.tasks.filter((t) =>
              mode === "projects"
                ? t.project === item.id
                : mode === "responsibles"
                  ? t.responsible === item.id
                  : mode === "tags"
                    ? t.tagIds.includes(item.id)
                    : t.counterparties.includes(item.id) ||
                      t.executors.includes(item.id) ||
                      t.responsible === item.id,
            ).length;
            return `<div class="dir-row"><div style="display:flex;gap:9px;align-items:center" class="${item.archived ? "muted" : ""}">${mode === "projects" ? `<span class="dot" style="--dot:${item.color}"></span>` : `<span class="avatar">${E(initials(item.name))}</span>`}<span>${E(item.name)}</span></div><div class="roles">${mode === "projects" ? `<span class="badge">${item.archived ? "Скрыта" : "Активна"}</span>` : `<span class="badge">${E(item.type)}</span>${item.responsible ? '<span class="badge role">Ответственный</span>' : ""}${item.archived ? '<span class="badge">Скрыт</span>' : ""}`}</div><span class="muted" style="font-size:11px">${count}</span><div class="dir-actions"><button class="tinybtn" data-action="directory-edit" data-id="${E(item.id)}" title="Переименовать" aria-label="Переименовать ${E(item.name)}">${icon("edit", true)}</button><button class="tinybtn" data-action="directory-hide" data-id="${E(item.id)}" data-revision="${item.revision}" data-archived="${!item.archived}" title="${item.archived ? "Вернуть в выбор" : "Скрыть из выбора"}" aria-label="${item.archived ? "Вернуть" : "Скрыть"} ${E(item.name)}">${icon("eye", true)}</button><button class="tinybtn" data-action="directory-delete" data-id="${E(item.id)}" title="${mode === "responsibles" ? "Убрать из ответственных" : "Удалить"}" aria-label="Удалить ${E(item.name)}">${icon("trash", true)}</button></div></div>`;
          })
          .join("") || '<div class="empty">Записей нет</div>'
      }`;
  }
  let directoryContext = null;
  function directoryEdit(id = null, forceProject = false) {
    const mode = forceProject ? "projects" : ui.manager,
      item = id
        ? mode === "projects"
          ? proj(id)
          : mode === "tags"
            ? model.tags.find((t) => t.id === id)
            : person(id)
        : null;
    directoryContext = { mode, id, revision: item?.revision, newId: uid() };
    if (mode === "responsibles" && !id) {
      const available = model.contacts.filter(
        (c) => !c.responsible && !c.archived && c.type === "Человек",
      );
      modal(
        "Добавить ответственного",
        `<div class="field"><label for="existing-contact">Выбрать человека из справочника</label><select id="existing-contact">${options(available, "", "Создать новую карточку")}</select></div><div class="field"><label for="directory-name">Имя нового человека</label><input id="directory-name" placeholder="Имя и фамилия"></div><div id="directory-error"></div>`,
        `<button class="btn" data-action="manage">Назад</button><button class="btn primary" data-action="directory-save">Добавить</button>`,
        true,
      );
    } else
      modal(
        item
          ? "Редактировать запись"
          : mode === "projects"
            ? "Новая тема"
            : mode === "tags"
              ? "Новый тег"
              : "Новый контрагент",
        `<div class="field"><label for="directory-name">${mode === "projects" ? "Название темы" : "Название / имя"}</label><input id="directory-name" value="${E(item?.name || "")}" placeholder="Введите название" maxlength="100"></div>${!["projects", "tags"].includes(mode) ? `<div class="field"><label for="contact-type">Тип</label><select id="contact-type">${["Человек", "Организация", "Группа"].map((type) => `<option ${item?.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></div><label style="display:flex;align-items:center;gap:8px;font-size:12px"><input type="checkbox" id="contact-responsible" ${item?.responsible ? "checked" : ""}>Доступен в списке ответственных</label>` : mode === "projects" ? '<div class="info-box">Тема объединяет задачи и мероприятия. Людей назначают на конкретные задачи.</div>' : '<div class="info-box">Свободная метка для поиска и группировки любых записей.</div>'}<div id="directory-error"></div>`,
        `<button class="btn" data-action="manage">Отмена</button><button class="btn primary" data-action="directory-save">Сохранить</button>`,
        true,
      );
    if (mode === "projects")
      $("#modal-root .modal-body").insertAdjacentHTML(
        "beforeend",
        `<div class="field"><label for="directory-description">Описание / проблематика</label><textarea id="directory-description">${E(item?.description || "")}</textarea></div>`,
      );
    setTimeout(() => $("#directory-name")?.focus(), 30);
  }
  let deleteContext = null;
  function directoryDelete(id) {
    const mode = ui.manager,
      item =
        mode === "projects"
          ? proj(id)
          : mode === "tags"
            ? model.tags.find((t) => t.id === id)
            : person(id),
      affected = model.tasks.filter((t) =>
        mode === "projects"
          ? t.project === id
          : mode === "responsibles"
            ? t.responsible === id
            : mode === "tags"
              ? t.tagIds.includes(id)
              : t.executors.includes(id) ||
                t.responsible === id ||
                t.counterparties.includes(id),
      );
    deleteContext = { mode, id, revision: item.revision };
    const choices =
      mode === "projects"
        ? model.projects.filter((p) => p.id !== id && !p.archived)
        : mode === "tags"
          ? model.tags.filter((t) => t.id !== id && !t.archived)
          : model.contacts.filter(
              (c) =>
                c.id !== id &&
                !c.archived &&
                (!(
                  mode === "responsibles" ||
                  affected.some((t) => t.responsible === id)
                ) ||
                  c.responsible),
            );
    modal(
      mode === "responsibles" ? "Убрать из ответственных?" : "Удалить запись?",
      `<p style="font-size:14px;margin-top:0">${E(item.name)}</p><div class="info-box">${affected.length ? `Связанных задач: <strong>${affected.length}</strong>. ` : ""}Сами задачи сохранятся.${mode === "responsibles" ? " Карточка останется среди контрагентов." : ""}</div>${affected.length ? `<div class="field"><label for="replacement">${mode === "projects" ? "Куда перенести задачи" : "Заменить назначение на"}</label><select id="replacement">${options(choices, "", mode === "projects" ? "Без темы" : "Снять назначение")}</select></div>` : ""}`,
      `<button class="btn" data-action="manage">Отмена</button><button class="btn danger" data-action="confirm-directory-delete">${mode === "responsibles" ? "Убрать из списка" : "Удалить запись"}</button>`,
      true,
    );
  }
  const meetingDefaults = {
    orientation: "portrait",
    font: 12,
    lines: 3,
    noteLayout: "below",
    questions: "open",
    comments: "last",
    description: false,
    images: true,
    generalItems: true,
    people: true,
    dates: true,
    status: false,
    files: false,
    finalNotes: true,
    preset: "meeting",
  };
  let meeting = null,
    meetingTimer;
  const printImageUrls = new Map();
  function printTask(id) {
    const value = task(id);
    return value ? productUI.printItem(value) : null;
  }
  function imageMaterial(file) {
    return (
      /^image\//.test(file.type) ||
      /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)
    );
  }
  function ensurePrintImages() {
    if (!meeting?.images || meeting.loadingImages) return;
    const active = meeting,
      files = [
        ...new Map(
          active.order
            .filter((id) => active.selected.has(id))
            .flatMap((id) => printTask(id)?.attachments || [])
            .filter(imageMaterial)
            .map((f) => [f.id, f]),
        ).values(),
      ].filter((f) => !printImageUrls.has(f.id));
    if (!files.length) return;
    active.loadingImages = true;
    active.valid = false;
    void (async () => {
      for (const file of files) {
        let url = null;
        try {
          let blob = await attachmentBlob(file);
          if (!/^image\//.test(blob.type)) {
            const ext = file.name.split(".").at(-1).toLowerCase(),
              types = {
                jpg: "image/jpeg",
                jpeg: "image/jpeg",
                png: "image/png",
                gif: "image/gif",
                webp: "image/webp",
                bmp: "image/bmp",
                svg: "image/svg+xml",
              };
            blob = new Blob([blob], { type: types[ext] || "image/png" });
          }
          url = URL.createObjectURL(blob);
          const img = new Image();
          img.src = url;
          await img.decode();
          if (meeting !== active) {
            URL.revokeObjectURL(url);
            continue;
          }
          printImageUrls.set(file.id, url);
        } catch {
          if (url) URL.revokeObjectURL(url);
          if (meeting === active) printImageUrls.set(file.id, null);
        }
      }
      if (meeting === active) {
        active.loadingImages = false;
        renderMeetingPreview();
      }
    })();
  }
  const OUTPUT_COLUMNS = {
    title: "Задача",
    project: "Тема",
    counterparties: "Контрагенты",
    tags: "Теги",
    executor: "Исполнитель",
    responsible: "Ответственный",
    start: "Начало",
    end: "Дедлайн",
    status: "Статус",
    percent: "%",
    parent: "Родительская задача",
  };
  const defaultOutputColumns = [
    "title",
    "project",
    "executor",
    "responsible",
    "end",
    "status",
  ];
  const OUTPUT_PROFILES = "taskgantt_output_profiles_v2";
  function outputProfile(format) {
    let value =
      format === "meeting"
        ? { ...meetingDefaults }
        : {
            ...meetingDefaults,
            orientation: "landscape",
            font: 11,
            lines: 0,
            questions: "none",
            comments: "none",
            finalNotes: false,
            preset: "compact",
          };
    try {
      const saved = JSON.parse(localStorage.getItem(OUTPUT_PROFILES) || "{}")[
        format
      ];
      if (saved) value = { ...value, ...saved };
    } catch {}
    return {
      ...value,
      format,
      columns: [...(value.columns || defaultOutputColumns)],
    };
  }
  function outputTitle() {
    return meeting.format === "meeting"
      ? printTask(meeting.root)?.title || "Лист на встречу"
      : "Список задач";
  }
  function refreshOutputCandidates() {
    const candidates =
      meeting.sourceMode === "branch" && meeting.root
        ? [meeting.root, ...branchOrder(meeting.root).map((r) => r.id)]
        : model.tasks.map((t) => t.id);
    const query = cloneQuery(meeting.query);
    if (meeting.sourceMode === "branch") setTaskSelection(query, { all: true });
    meeting.order = candidates.filter((id) => {
      const value = printTask(id);
      if (!value) return false;
      if (
        query.scope === "agenda" &&
        ["preparation", "question", "note"].includes(value.kind)
      ) {
        if (!meeting.generalItems) return false;
        return queryMatches(value, { ...query, projects: [] });
      }
      return queryMatches(value, query);
    });
    meeting.selected = new Set(
      meeting.order.filter((id) => !meeting.excluded.has(id)),
    );
    meeting.showDone =
      meeting.query.showDone || meeting.query.status === "DONE";
  }
  function setMeetingRoot(id) {
    if (!printTask(id)) return;
    meeting.root = id;
    meeting.query.scope = printTask(id)?.kind === "task" ? "work" : "agenda";
    meeting.queryDraft.scope = meeting.query.scope;
    meeting.sourceMode = "branch";
    meeting.excluded = new Set();
    meeting.breaks = new Set();
    meeting.title = outputTitle();
    refreshOutputCandidates();
  }
  function openMeeting(id) {
    const format = id ? "meeting" : "list",
      query = cloneQuery(queryFromUi());
    if (id) {
      query.scope = printTask(id)?.kind === "task" ? "work" : "agenda";
      query.projects = [];
      query.text = "";
      query.from = "";
      query.to = "";
      query.due = "";
    }
    meeting = {
      ...outputProfile(format),
      root: id || null,
      sourceMode: id ? "branch" : "filtered",
      query,
      queryDraft: cloneQuery(query),
      excluded: new Set(),
      selected: new Set(),
      breaks: new Set(),
      order: [],
      date: "",
      participants: "",
      pages: 0,
      previewZoom: "page",
    };
    if (id && printTask(id)?.kind === "event") {
      meeting.description = true;
      meeting.files = true;
      meeting.images = true;
      meeting.generalItems = true;
      meeting.query = { ...blankQuery(), scope: "agenda", showDone: true };
      meeting.queryDraft = cloneQuery(meeting.query);
    }
    meeting.title = outputTitle();
    refreshOutputCandidates();
    renderMeetingControls();
    renderMeetingPreview();
  }
  function changeOutputFormat(format) {
    Object.assign(meeting, outputProfile(format));
    meeting.title = outputTitle();
    renderMeetingControls();
    renderMeetingPreview();
  }
  function outputSource(mode) {
    meeting.sourceMode = mode;
    meeting.excluded.clear();
    meeting.breaks.clear();
    if (mode === "branch" && !meeting.root) {
      const roots = model.tasks.filter((t) =>
        model.tasks.some((c) => c.parent === t.id),
      );
      meeting.root =
        roots.find((t) =>
          [t.id, ...descendants(t.id)].some((id) =>
            queryMatches(printTask(id), meeting.query),
          ),
        )?.id ||
        roots[0]?.id ||
        model.tasks[0]?.id ||
        null;
    }
    meeting.title = outputTitle();
    refreshOutputCandidates();
    renderMeetingControls();
    renderMeetingPreview();
  }
  function renderMeetingControls() {
    const roots = [...model.tasks].sort(
      (a, b) =>
        Number(model.tasks.some((t) => t.parent === b.id)) -
        Number(model.tasks.some((t) => t.parent === a.id)),
    );
    const columns = Object.entries(OUTPUT_COLUMNS)
      .map(
        ([id, label]) =>
          `<label class="meeting-option"><input type="checkbox" data-output-column="${id}" ${meeting.columns.includes(id) ? "checked" : ""} ${id === "title" ? "disabled" : ""}>${label}</label>`,
      )
      .join("");
    $("#meeting-root").innerHTML =
      `<section class="meeting-workspace" role="dialog" aria-modal="true" aria-label="Печать и экспорт"><header class="meeting-top"><div><h2>Печать и экспорт</h2><p>Выборка по темам, людям и периоду → формат вывода</p></div><div class="meeting-actions"><span class="meeting-count" id="meeting-count"></span><select id="meeting-zoom" aria-label="Масштаб предпросмотра" style="font-size:11px;padding:8px"><option value="page" ${meeting.previewZoom === "page" ? "selected" : ""}>Вся страница</option><option value="width" ${meeting.previewZoom === "width" ? "selected" : ""}>По ширине</option><option value="100" ${meeting.previewZoom === "100" ? "selected" : ""}>100%</option></select><button class="btn" data-action="output-csv">CSV</button><button class="btn" data-action="output-xlsx">XLSX</button><button class="btn primary" data-action="meeting-print">${icon("printer", true)}Печать / PDF</button><button class="btn" data-action="meeting-close" aria-label="Закрыть вывод">${icon("close", true)}</button></div></header><div class="meeting-layout"><aside class="meeting-settings"><div class="output-format-switch">${[
        ["list", "Обычный список"],
        ["meeting", "Для встречи"],
      ]
        .map(
          ([id, label]) =>
            `<button class="${meeting.format === id ? "active" : ""}" data-action="output-format" data-id="${id}">${label}</button>`,
        )
        .join("")}</div><div class="output-source-switch">${[
        ["filtered", "По фильтрам"],
        ["branch", "Ветка задачи"],
      ]
        .map(
          ([id, label]) =>
            `<button class="${meeting.sourceMode === id ? "active" : ""}" data-action="output-source" data-id="${id}">${label}</button>`,
        )
        .join("")}</div>${
        meeting.sourceMode === "branch" ? outputBranchPicker() : ""
      }${queryControls(meeting.queryDraft, "output")}<div class="output-summary" id="output-summary"></div><details ${meeting.format === "list" ? "open" : ""}><summary>${meeting.format === "list" ? "Столбцы списка" : "Содержимое листа"}</summary>${meeting.format === "list" ? `<div class="meeting-checks">${columns}</div>` : ""}<div class="twocol"><div class="field"><label>Вопросы</label>${meetingSelect(
        "questions",
        [
          ["open", "Открытые"],
          ["all", "Все"],
          ["none", "Не печатать"],
        ],
      )}</div><div class="field"><label>Комментарии</label>${meetingSelect(
        "comments",
        [
          ["last", "Последний"],
          ["all", "Все"],
          ["none", "Не печатать"],
        ],
      )}</div></div><div class="meeting-checks">${meetingCheckbox("description", "Описания")}${meetingCheckbox("files", "Названия файлов")}${meetingCheckbox("images", "Графики и изображения")}${meeting.query.scope === "agenda" ? meetingCheckbox("generalItems", "Общие вопросы, подготовка и материалы") : ""}${meeting.format === "meeting" ? meetingCheckbox("people", "Ответственные") + meetingCheckbox("dates", "Сроки / время") + meetingCheckbox("status", "Статусы") + meetingCheckbox("finalNotes", "Общие итоги") : ""}</div></details><details><summary>Лист и оформление</summary>${
        meeting.format === "meeting"
          ? `<div class="meeting-presets">${[
              ["compact", "Компактно"],
              ["meeting", "На встречу"],
              ["detailed", "Подробно"],
            ]
              .map(
                ([id, label]) =>
                  `<button data-action="meeting-preset" data-id="${id}" class="${meeting.preset === id ? "selected" : ""}">${label}</button>`,
              )
              .join("")}</div>`
          : ""
      }<div class="twocol"><div class="field"><label>Лист</label>${meetingSelect(
        "orientation",
        [
          ["portrait", "A4 · книжный"],
          ["landscape", "A4 · альбомный"],
        ],
      )}</div><div class="field"><label>Текст</label>${meetingSelect("font", [
        [11, "11 пт"],
        [12, "12 пт"],
        [14, "14 пт"],
      ])}</div></div>${
        meeting.format === "meeting"
          ? `<div class="twocol"><div class="field"><label>Заметки</label>${meetingSelect(
              "noteLayout",
              [
                ["below", "Под пунктом"],
                ["right", "Справа"],
              ],
            )}</div><div class="field"><label>Строк для записей</label>${meetingSelect(
              "lines",
              [
                [0, "Без строк"],
                [1, "1 строка"],
                [2, "2 строки"],
                [3, "3 строки"],
                [5, "5 строк"],
                [8, "8 строк"],
              ],
            )}</div></div>`
          : ""
      }</details><details><summary>Выбранные задачи</summary><div class="meeting-tree-toolbar"><span id="meeting-selection-count"></span><span><button class="textbtn" data-action="meeting-select-all">Все</button> · <button class="textbtn" data-action="meeting-select-none">Снять</button></span></div><div class="meeting-tree" id="meeting-tree"></div></details><details><summary>Заголовок ${meeting.format === "meeting" ? "и участники" : ""}</summary><div class="field"><label for="meeting-title">Заголовок листа</label><input id="meeting-title" data-sheet-setting="title" value="${E(meeting.title)}" maxlength="500"></div>${meeting.format === "meeting" ? `<div class="field"><label for="meeting-date">Дата встречи</label><input id="meeting-date" type="date" data-sheet-setting="date" value="${E(meeting.date)}"></div><div class="field"><label for="meeting-participants">Участники / место</label><input id="meeting-participants" data-sheet-setting="participants" value="${E(meeting.participants)}" maxlength="300"></div>` : ""}</details><button class="btn" data-action="meeting-remember" style="margin-top:17px">Запомнить оформление</button></aside><div class="meeting-preview" id="meeting-preview"><div id="meeting-pages"></div></div></div></section>`;
    renderMeetingTree();
    updateOutputSummary();
  }
  function updateOutputSummary() {
    if ($("#output-summary"))
      $("#output-summary").textContent =
        `Найдено: ${meeting.order.length} · Выбрано: ${meeting.selected.size}. ${querySummary(meeting.sourceMode === "branch" ? { ...meeting.query, taskAll: true, taskInclude: [], taskExclude: [] } : meeting.query)}${meeting.sourceMode === "branch" ? " · Ветка: " + printTask(meeting.root)?.title : ""}`;
  }
  function renderMeetingTree() {
    const levels = new Map(
      meeting.sourceMode === "branch"
        ? [
            [meeting.root, 0],
            ...branchOrder(meeting.root).map((r) => [r.id, r.level + 1]),
          ]
        : [],
    );
    $("#meeting-selection-count").textContent =
      `${meeting.selected.size} из ${meeting.order.length}`;
    $("#meeting-tree").innerHTML =
      meeting.order
        .map((id) => {
          const t = printTask(id),
            siblings = meeting.order.filter(
              (s) => printTask(s).parent === t.parent,
            ),
            index = siblings.indexOf(id);
          return `<div class="meeting-tree-row ${meeting.selected.has(id) ? "" : "off"}" style="margin-left:${Math.min(3, levels.get(id) || 0) * 8}px"><label class="meeting-tree-name"><input type="checkbox" data-meeting-task="${E(id)}" ${meeting.selected.has(id) ? "checked" : ""}><span>${E(t.title)}</span></label><div class="meeting-tree-tools"><button class="tinybtn" data-action="meeting-up" data-id="${E(id)}" ${index === 0 ? "disabled" : ""}>↑</button><button class="tinybtn" data-action="meeting-down" data-id="${E(id)}" ${index === siblings.length - 1 ? "disabled" : ""}>↓</button><button class="page-break-toggle ${meeting.breaks.has(id) ? "active" : ""}" data-action="meeting-break" data-id="${E(id)}">${meeting.breaks.has(id) ? "✓ " : ""}Новая страница</button></div></div>`;
        })
        .join("") ||
      '<p class="activity-empty">По выбранным условиям задач нет.</p>';
    updateOutputSummary();
  }
  function outputCell(t, key) {
    if (key === "title") return t.title;
    if (key === "project") return themeName(t.project || "none");
    if (key === "executor")
      return (
        t.executors
          .map((id) => person(id)?.name)
          .filter(Boolean)
          .join(", ") || "Не назначен"
      );
    if (key === "counterparties")
      return t.counterparties
        .map((id) => person(id)?.name)
        .filter(Boolean)
        .join(", ");
    if (key === "tags") return (t.tags || []).join(", ");
    if (key === "responsible")
      return person(t.responsible)?.name || "Не назначен";
    if (key === "status") return statuses[t.status];
    if (key === "percent") return t.percent + "%";
    if (key === "parent") return printTask(t.parent)?.title || "";
    if ((key === "start" || key === "end") && !t[key]) return "Без даты";
    if (key === "start" || key === "end")
      return new Date(t[key] + "T12:00:00").toLocaleDateString("ru-RU");
    return "";
  }
  function meetingBlocks() {
    if (meeting.format === "list")
      return meeting.order
        .filter((id) => meeting.selected.has(id))
        .map((id) => ({
          id,
          title: printTask(id).title,
          kind: "list",
          parts: meetingParts(printTask(id)),
          notes: false,
          breakBefore: meeting.breaks.has(id),
        }));
    const root =
        meeting.sourceMode === "branch" ? printTask(meeting.root) : null,
      blocks = [];
    if (root && meeting.selected.has(root.id)) {
      const parts = meetingParts(root);
      if (parts.length || meeting.order.length === 1)
        blocks.push({
          id: root.id,
          title: "К обсуждению",
          number: "",
          parts,
          notes: meeting.order.length === 1,
        });
    }
    const include = new Set(meeting.selected);
    for (const id of meeting.selected) {
      let p = printTask(id)?.parent;
      const seen = new Set([id]);
      while (p && p !== root?.id && !seen.has(p)) {
        seen.add(p);
        if (meeting.order.includes(p)) include.add(p);
        p = printTask(p)?.parent;
      }
    }
    const counters = new Map(),
      numbers = new Map();
    for (const id of meeting.order) {
      if (id === root?.id || !include.has(id)) continue;
      const t = printTask(id),
        context = !meeting.selected.has(id),
        group = numbers.has(t.parent) ? t.parent : "__top",
        n = (counters.get(group) || 0) + 1;
      counters.set(group, n);
      const number =
        (numbers.get(t.parent) ? numbers.get(t.parent) + "." : "") + n;
      numbers.set(id, number);
      const metadata = [];
      if (!context && meeting.people)
        metadata.push(
          "Контрагенты: " +
            (t.counterparties
              .map((id) => person(id)?.name)
              .filter(Boolean)
              .join(", ") || "не назначены") +
            " · Исполнители: " +
            (t.executors
              .map((id) => person(id)?.name)
              .filter(Boolean)
              .join(", ") || "не назначены") +
            " · Ответственный: " +
            (person(t.responsible)?.name || "не назначен"),
        );
      if (!context && meeting.dates)
        metadata.push(
          "Срок: " +
            outputCell(t, "end") +
            (t.kind === "event" && t.startTime
              ? " · " + t.startTime + (t.endTime ? "–" + t.endTime : "")
              : ""),
        );
      if (!context && meeting.status) metadata.push(statuses[t.status]);
      blocks.push({
        id,
        title: t.title,
        number,
        parts: context ? [] : meetingParts(t),
        notes: !context,
        context,
        metadata: metadata.join(" · "),
        path:
          t.parent && t.parent !== root?.id ? printTask(t.parent)?.title : "",
        breakBefore: meeting.breaks.has(id),
      });
    }
    if (meeting.finalNotes)
      blocks.push({
        id: "summary",
        title: "Итоги встречи / следующие действия",
        number: "",
        parts: [],
        notes: true,
        summary: true,
      });
    return blocks;
  }
  function listMeetingEntry(block, parts, continued) {
    const t = printTask(block.id),
      node = document.createElement("article");
    node.className = "meeting-entry ordinary-row";
    node.dataset.sheetTask = block.id;
    node.innerHTML = `<div class="sheet-table-cells">${meeting.columns.map((key) => `<div class="${key === "title" ? "list-task-title" : ""}">${E(outputCell(t, key))}${key === "title" && continued ? " · продолжение" : ""}${key === "title" && t.parent ? `<div class="list-task-parent">Внутри: ${E(printTask(t.parent)?.title || "")}</div>` : ""}</div>`).join("")}</div>${parts.length ? `<div class="sheet-materials">${parts.map((p) => `<div class="sheet-part ${p.type}">${p.label ? `<strong>${E(p.label)}</strong>` : ""}${p.image ? `<figure class="print-image"><img src="${E(p.image)}" alt="${E(p.text)}"><figcaption>${E(p.text)}</figcaption></figure>` : E(p.text)}</div>`).join("")}</div>` : ""}`;
    return node;
  }
  function meetingEntry(
    block,
    parts = block.parts,
    notes = block.notes,
    continued = false,
  ) {
    return block.kind === "list"
      ? listMeetingEntry(block, parts, continued)
      : meetingCardEntry(block, parts, notes, continued);
  }
  function meetingPage() {
    const page = document.createElement("section");
    page.className =
      "paper-page" +
      (meeting.orientation === "landscape" ? " landscape" : "") +
      (meeting.format === "list" ? " ordinary" : "");
    page.style.setProperty("--sheet-font", meeting.font + "pt");
    page.style.setProperty(
      "--sheet-columns",
      meeting.columns
        .map((key) => (key === "title" ? "minmax(0,3fr)" : "minmax(0,1.2fr)"))
        .join(" "),
    );
    page.innerHTML = `<header class="sheet-heading"><div class="sheet-eyebrow">${meeting.format === "list" ? "Список задач" : "Лист на встречу"}</div><h1>${E(meeting.title)}</h1><div class="sheet-filter-summary">${E(querySummary(meeting.query))}${meeting.sourceMode === "branch" ? " · Ветка: " + E(printTask(meeting.root)?.title || "") : ""}</div>${meeting.format === "meeting" ? `<div class="sheet-meeting-meta" style="margin-top:3mm"><span>Дата: ${meeting.date ? E(new Date(meeting.date + "T12:00:00").toLocaleDateString("ru-RU")) : "________________"}</span><span>${meeting.participants ? E(meeting.participants) : "Участники: __________________________"}</span></div>` : `<div class="sheet-table-head">${meeting.columns.map((key) => `<span>${OUTPUT_COLUMNS[key]}</span>`).join("")}</div>`}</header><div class="sheet-body"></div><footer class="sheet-footer"><span>${meeting.format === "meeting" ? "Решения и вопросы к встрече" : "Список задач · " + meeting.selected.size + " записей"}</span><span class="sheet-page-number"></span></footer>`;
    $("#meeting-pages").append(page);
    return page;
  }
  function renderMeetingPreview() {
    ensurePrintImages();
    if (!meeting || !$("#meeting-pages")) return;
    clearTimeout(meetingTimer);
    updateOutputSummary();
    if (!meeting.selected.size) {
      $("#meeting-pages").style.zoom = "1";
      $("#meeting-pages").innerHTML =
        '<div class="output-empty">' +
        (meeting.order.length
          ? "Задачи найдены, но ни одна не отмечена для вывода."
          : "По выбранным условиям задач нет. Измените темы, человека или период и нажмите «Применить».") +
        "</div>";
      meeting.pages = 0;
      meeting.valid = false;
      $("#meeting-count").textContent =
        `Найдено: ${meeting.order.length} · Выбрано: 0`;
    } else paginateOutput();
    for (const action of ["meeting-print", "output-csv", "output-xlsx"])
      $('#meeting-root [data-action="' + action + '"]').disabled =
        !meeting.valid || queryPending("output");
  }
  function rememberMeeting() {
    let profiles = {};
    try {
      profiles = JSON.parse(localStorage.getItem(OUTPUT_PROFILES) || "{}");
    } catch {}
    profiles[meeting.format] = {
      ...Object.fromEntries(
        Object.keys(meetingDefaults).map((key) => [key, meeting[key]]),
      ),
      columns: [...meeting.columns],
    };
    try {
      localStorage.setItem(OUTPUT_PROFILES, JSON.stringify(profiles));
      toast("Оформление этого шаблона сохранено");
    } catch {
      toast("Не удалось сохранить настройки");
    }
  }
  function exportOutput(type) {
    if (!meeting?.valid || queryPending("output")) return;
    const extras = [
      ...(meeting.description ? [["description", "Описание"]] : []),
      ...(meeting.questions !== "none" ? [["question", "Вопросы"]] : []),
      ...(meeting.comments !== "none" ? [["comment", "Комментарии"]] : []),
      ...(meeting.files ? [["files", "Вложения"]] : []),
    ];
    const headers = [
      ...meeting.columns.map((key) => OUTPUT_COLUMNS[key]),
      ...extras.map((pair) => pair[1]),
    ];
    const rows = meeting.order
      .filter((id) => meeting.selected.has(id))
      .map((id) => {
        const t = printTask(id),
          parts = meetingParts(t);
        return [
          ...meeting.columns.map((key) => outputCell(t, key)),
          ...extras.map(([type]) =>
            parts
              .filter((p) => p.type === type)
              .map((p) => (p.label ? p.label + ": " : "") + p.text)
              .join("\n"),
          ),
        ];
      });
    let blob;
    if (type === "csv") {
      const cell = (value) => {
        let text = String(value);
        if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
      };
      blob = new Blob(
        [
          "\ufeff" +
            [headers, ...rows]
              .map((row) => row.map(cell).join(";"))
              .join("\r\n"),
        ],
        { type: "text/csv;charset=utf-8" },
      );
    } else {
      const workbook = XLSX.utils.book_new(),
        sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      sheet["!cols"] = [
        ...meeting.columns.map((key) => ({
          wch: key === "title" ? 55 : 25,
        })),
        ...extras.map(() => ({ wch: 60 })),
      ];
      XLSX.utils.book_append_sheet(workbook, sheet, "Задачи");
      blob = new Blob(
        [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
        {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      );
    }
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "tasks-" + TODAY + "." + type;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function meetingControl(event) {
    if (
      !meeting ||
      !event.target.closest("#meeting-root") ||
      event.target.closest("[data-query-scope]")
    )
      return;
    const target = event.target,
      key = target.dataset.sheetSetting;
    if (target.id === "meeting-zoom") {
      meeting.previewZoom = target.value;
      fitMeetingPreview();
      return;
    }
    if (target.id === "meeting-source") {
      if (!target.value) {
        target.value = meeting.root;
        return;
      }
      setMeetingRoot(target.value);
      renderMeetingControls();
      renderMeetingPreview();
      return;
    }
    if (key === "generalItems") {
      meeting.generalItems = target.checked;
      meeting.excluded.clear();
      refreshOutputCandidates();
      renderMeetingTree();
      renderMeetingPreview();
      return;
    }
    if (target.dataset.meetingTask) {
      const id = target.dataset.meetingTask;
      if (target.checked) {
        meeting.selected.add(id);
        meeting.excluded.delete(id);
      } else {
        meeting.selected.delete(id);
        meeting.excluded.add(id);
      }
      renderMeetingTree();
      renderMeetingPreview();
      return;
    }
    if (target.dataset.outputColumn) {
      const id = target.dataset.outputColumn;
      meeting.columns = Object.keys(OUTPUT_COLUMNS).filter(
        (key) =>
          key === "title" ||
          (key === id ? target.checked : meeting.columns.includes(key)),
      );
      renderMeetingPreview();
      return;
    }
    if (key) {
      meeting[key] =
        target.type === "checkbox"
          ? target.checked
          : ["font", "lines"].includes(key)
            ? Number(target.value)
            : target.value;
      meeting.preset = "custom";
      $("#meeting-root .meeting-presets .selected")?.classList.remove(
        "selected",
      );
      clearTimeout(meetingTimer);
      meetingTimer = setTimeout(renderMeetingPreview, 100);
    }
  }
  function branchOrder(rootId) {
    const result = [],
      seen = new Set([rootId]);
    function visit(parent, level) {
      for (const t of model.tasks.filter((t) => t.parent === parent))
        if (!seen.has(t.id)) {
          seen.add(t.id);
          result.push({ id: t.id, level });
          visit(t.id, level + 1);
        }
    }
    visit(rootId, 0);
    return result;
  }
  function closeMeeting() {
    for (const url of printImageUrls.values())
      if (url) URL.revokeObjectURL(url);
    printImageUrls.clear();
    const url = new URL(location.href);
    url.searchParams.delete("output");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    document.body.classList.remove("meeting-print");
    clearTimeout(meetingTimer);
    meeting = null;
    $("#meeting-root").innerHTML = "";
  }
  function meetingCheckbox(key, label) {
    return `<label class="meeting-option"><input type="checkbox" data-sheet-setting="${key}" ${meeting[key] ? "checked" : ""}>${label}</label>`;
  }
  function meetingSelect(key, items) {
    return `<select data-sheet-setting="${key}" aria-label="${E(key === "questions" ? "Печатать вопросы" : key === "comments" ? "Печатать комментарии" : key === "lines" ? "Строк для заметок" : key === "font" ? "Размер текста" : key === "orientation" ? "Ориентация листа" : "Расположение заметок")}">${items.map(([value, label]) => `<option value="${value}" ${String(meeting[key]) === String(value) ? "selected" : ""}>${label}</option>`).join("")}</select>`;
  }
  function moveMeetingItem(id, direction) {
    const t = printTask(id),
      siblings = meeting.order.filter(
        (s) =>
          printTask(s).parent === t.parent &&
          (meeting.showDone || printTask(s).status !== "DONE"),
      ),
      next = siblings[siblings.indexOf(id) + direction];
    if (!next) return;
    const group = descendants(id),
      target = descendants(next),
      block = meeting.order.filter((s) => group.has(s));
    meeting.order = meeting.order.filter((s) => !group.has(s));
    const at =
      direction < 0
        ? meeting.order.indexOf(next)
        : Math.max(
            ...meeting.order.map((s, index) => (target.has(s) ? index : -1)),
          ) + 1;
    meeting.order.splice(at, 0, ...block);
    renderMeetingTree();
    renderMeetingPreview();
  }
  function applyMeetingPreset(name) {
    const preset =
      name === "compact"
        ? {
            font: 11,
            lines: 1,
            description: false,
            comments: "none",
            questions: "open",
            finalNotes: false,
            noteLayout: "below",
          }
        : name === "detailed"
          ? {
              font: 12,
              lines: 5,
              description: true,
              comments: "all",
              questions: "all",
              finalNotes: true,
              noteLayout: "below",
            }
          : meetingDefaults;
    Object.assign(meeting, preset, { preset: name });
    renderMeetingControls();
    renderMeetingPreview();
  }
  function meetingParts(t) {
    const parts = [];
    if (meeting.description && t.description)
      parts.push({ type: "description", text: t.description });
    if (t.outcome)
      parts.push({
        type: "comment",
        label: "Итоги / договорённости",
        text: t.outcome,
      });
    const questions = t.comments.filter(
      (c) =>
        c.kind === "question" &&
        (meeting.questions === "all" ||
          (meeting.questions === "open" && !c.resolved)),
    );
    for (const c of questions)
      parts.push({
        type: "question",
        label: c.resolved ? "Вопрос · решён" : "Вопрос к обсуждению",
        text: c.text,
      });
    const comments = t.comments.filter((c) => c.kind !== "question");
    for (const c of meeting.comments === "all"
      ? comments
      : meeting.comments === "last"
        ? comments.slice(-1)
        : [])
      parts.push({ type: "comment", label: "Комментарий", text: c.text });
    if (meeting.images)
      for (const file of t.attachments.filter(imageMaterial)) {
        const url = printImageUrls.get(file.id);
        if (url)
          parts.push({
            type: "image",
            label: "Материал",
            text: file.name,
            image: url,
          });
        else if (printImageUrls.has(file.id))
          parts.push({
            type: "files",
            label: "Изображение недоступно",
            text: file.name,
          });
      }
    if (meeting.files && t.attachments.length)
      parts.push({
        type: "files",
        label: "Материалы",
        text: t.attachments.map((f) => f.name).join(" · "),
      });
    return parts;
  }
  function writeLines(lines, label = "Решение / ответственный / срок") {
    return lines
      ? `<div class="sheet-writing"><div class="sheet-write-title">${E(label)}</div>${'<div class="sheet-write-line"></div>'.repeat(lines)}</div>`
      : "";
  }
  function meetingCardEntry(
    block,
    parts = block.parts,
    notes = block.notes,
    continued = false,
  ) {
    const node = document.createElement("article");
    node.className = "meeting-entry" + (block.context ? " sheet-context" : "");
    node.dataset.sheetTask = block.id;
    const title = continued
      ? block.title.slice(0, 120) + " · продолжение"
      : block.title;
    node.innerHTML = `${block.path ? `<div class="sheet-path">${E(block.path)}</div>` : ""}<h2>${block.number ? `<span class="sheet-check"></span><span class="sheet-item-number">${E(block.number)}.</span>` : ""}<span>${E(title)}</span></h2>${block.metadata ? `<div class="sheet-item-meta">${E(block.metadata)}</div>` : ""}<div class="sheet-entry-grid ${meeting.noteLayout === "right" && !block.summary ? "notes-right" : ""}"><div class="sheet-materials">${parts.map((p) => `<div class="sheet-part ${p.type}">${p.label ? `<strong>${E(p.label)}</strong>` : ""}${p.image ? `<figure class="print-image"><img src="${E(p.image)}" alt="${E(p.text)}"><figcaption>${E(p.text)}</figcaption></figure>` : E(p.text)}</div>`).join("")}</div>${notes ? writeLines(block.summary ? 3 : meeting.lines, block.summary ? "Решения, договорённости и следующие шаги" : "Решение / ответственный / срок") : ""}</div>`;
    return node;
  }
  function shortMeetingParts(parts) {
    const out = [];
    for (const part of parts) {
      if (part.text.length <= 420) {
        out.push(part);
        continue;
      }
      const tokens = part.text.match(/\S+\s*|\s+/g) || [part.text];
      let chunk = "",
        continuation = false;
      for (const token of tokens) {
        const chars = Array.from(token);
        for (let offset = 0; offset < chars.length; offset += 420) {
          const piece = chars.slice(offset, offset + 420).join("");
          if (chunk.length + piece.length > 420 && chunk) {
            out.push({
              ...part,
              label:
                continuation && part.label
                  ? part.label + " · продолжение"
                  : part.label,
              text: chunk,
            });
            continuation = true;
            chunk = "";
          }
          chunk += piece;
        }
      }
      if (chunk)
        out.push({
          ...part,
          label:
            continuation && part.label
              ? part.label + " · продолжение"
              : part.label,
          text: chunk,
        });
    }
    return out;
  }
  function paginateOutput() {
    if (!meeting || !$("#meeting-pages")) return;
    clearTimeout(meetingTimer);
    const pages = $("#meeting-pages");
    pages.style.zoom = "1";
    pages.innerHTML = "";
    let page = meetingPage(),
      body = page.querySelector(".sheet-body"),
      error = "";
    const fits = () =>
      body.clientHeight > 60 && body.scrollHeight <= body.clientHeight + 1;
    const next = () => {
      page = meetingPage();
      body = page.querySelector(".sheet-body");
    };
    const append = (node) => {
      body.append(node);
      return fits();
    };
    for (const block of meetingBlocks()) {
      if (block.breakBefore && body.children.length) next();
      let node = meetingEntry(block);
      if (append(node)) continue;
      node.remove();
      if (body.children.length) next();
      node = meetingEntry(block);
      if (append(node)) continue;
      node.remove();
      // Long items continue with their title repeated; ordinary items stay together.
      const parts = shortMeetingParts(block.parts);
      let current = [],
        continued = false;
      for (const part of parts) {
        node = meetingEntry(block, [...current, part], false, continued);
        if (append(node)) {
          node.remove();
          current.push(part);
          continue;
        }
        node.remove();
        if (current.length) {
          body.append(meetingEntry(block, current, false, continued));
          next();
          continued = true;
          current = [];
        }
        node = meetingEntry(block, [part], false, continued);
        if (!append(node)) {
          node.remove();
          error =
            "Заголовок занимает слишком много места. Сократите заголовок листа или выберите меньший размер текста.";
          break;
        }
        node.remove();
        current.push(part);
      }
      if (error) break;
      node = meetingEntry(block, current, block.notes, continued);
      if (!append(node)) {
        node.remove();
        if (current.length)
          body.append(meetingEntry(block, current, false, continued));
        if (body.children.length) next();
        node = meetingEntry(block, [], block.notes, true);
        if (!append(node)) {
          node.remove();
          error =
            "Уменьшите число строк для заметок или выберите книжную ориентацию.";
          break;
        }
      }
    }
    const all = [...pages.querySelectorAll(".paper-page")];
    for (let i = 0; i < all.length; i++)
      all[i].querySelector(".sheet-page-number").textContent =
        `${i + 1} / ${all.length}`;
    meeting.pages = all.length;
    meeting.valid = !error && !meeting.loadingImages;
    $("#meeting-count").textContent =
      `Страниц: ${all.length} · Выбрано пунктов: ${meeting.selected.size}`;
    $('#meeting-root [data-action="meeting-print"]').disabled =
      !!error || !!meeting.loadingImages;
    if (error)
      pages.insertAdjacentHTML(
        "afterbegin",
        `<p class="meeting-preview-error" role="alert">${E(error)}</p>`,
      );
    fitMeetingPreview();
  }
  function fitMeetingPreview() {
    const paper = $("#meeting-pages .paper-page"),
      pane = $("#meeting-preview");
    if (!paper || !pane) return;
    const width = Math.max(0.2, (pane.clientWidth - 48) / paper.offsetWidth);
    const height = Math.max(0.2, (pane.clientHeight - 48) / paper.offsetHeight);
    $("#meeting-pages").style.zoom = String(
      meeting.previewZoom === "100"
        ? 1
        : meeting.previewZoom === "width"
          ? Math.min(1, width)
          : Math.min(1, width, height),
    );
  }
  function printMeeting() {
    if (queryPending("output")) {
      toast("Примените фильтры перед выводом");
      return;
    }
    renderMeetingPreview();
    if (!meeting?.valid) return;
    $("#print-output").innerHTML = $("#meeting-pages").innerHTML;
    let style = $("#meeting-page-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "meeting-page-style";
      document.head.append(style);
    }
    style.textContent = `@page {size:A4 ${meeting.orientation};margin:0;}`;
    document.body.classList.add("meeting-print");
    window.print();
  }
  function popup(t, button) {
    const r = button.getBoundingClientRect();
    $("#popup-root").innerHTML =
      `<div class="popup" style="top:${Math.min(r.bottom + 3, innerHeight - 180)}px;left:${Math.min(r.left - 165, innerWidth - 210)}px"><button data-action="edit-task" data-id="${E(t.id)}">Открыть карточку</button><button data-action="add-child" data-id="${E(t.id)}">Добавить подзадачу</button><button data-action="meeting-open" data-id="${E(t.id)}">Печать / экспорт</button><button class="danger" data-action="delete-task" data-id="${E(t.id)}">Удалить задачу</button></div>`;
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      if (!event.target.closest(".popup")) $("#popup-root").innerHTML = "";
      return;
    }
    const a = button.dataset.action,
      id = button.dataset.id;
    $("#popup-root").innerHTML = "";
    switch (a) {
      case "tasks-all":
        setTaskSelection(queryDraft("main"), { all: true });
        refreshTaskPicker();
        taskPickerPending();
        break;
      case "tasks-none":
        setTaskSelection(queryDraft("main"), { all: false });
        refreshTaskPicker();
        taskPickerPending();
        break;
      case "task-picker-toggle":
        ui.taskPickerCollapsed.has(id)
          ? ui.taskPickerCollapsed.delete(id)
          : ui.taskPickerCollapsed.add(id);
        refreshTaskPicker();
        break;
      case "only-task-branch":
        setTaskSelection(queryDraft("main"), { all: false, include: [id] });
        queryDraft("main").text = "";
        ui.expand = true;
        ui.collapsed.clear();
        if (task(id)) ui.closedProjects.delete(task(id).project || "");
        applyQuery("main");
        break;
      case "output-branch-select":
        setMeetingRoot(id);
        renderMeetingControls();
        renderMeetingPreview();
        break;
      case "query-apply":
        applyQuery(button.dataset.scope);
        break;
      case "query-reset":
        resetQuery(button.dataset.scope);
        break;
      case "query-period":
        quickPeriod(button.dataset.scope, id);
        break;
      case "query-all-themes": {
        const q = queryDraft(button.dataset.scope);
        q.projects = [];
        if (button.dataset.scope === "main") {
          setTaskSelection(q, { all: true });
          refreshTaskPicker();
        }
        button
          .closest("[data-query-scope]")
          .querySelectorAll("[data-query-theme]")
          .forEach((box) => (box.checked = false));
        button
          .closest("[data-query-scope]")
          .querySelector(".theme-summary-label").textContent = "Все темы";
        $("#query-feedback-" + button.dataset.scope).textContent =
          "Выбраны все темы — нажмите «Применить»";
        markQueryButtons(button.dataset.scope);
        break;
      }
      case "query-themes-done":
        button.closest(".query-theme-picker").open = false;
        break;
      case "output-format":
        changeOutputFormat(id);
        break;
      case "output-source":
        outputSource(id);
        break;
      case "output-csv":
        exportOutput("csv");
        break;
      case "output-xlsx":
        exportOutput("xlsx");
        break;
      case "meeting-open":
        openMeeting(id);
        break;
      case "meeting-close":
        closeMeeting();
        break;
      case "meeting-preset":
        applyMeetingPreset(id);
        break;
      case "meeting-print":
        printMeeting();
        break;
      case "meeting-remember":
        rememberMeeting();
        break;
      case "meeting-select-all":
        meeting.excluded.clear();
        meeting.selected = new Set(meeting.order);
        renderMeetingTree();
        renderMeetingPreview();
        break;
      case "meeting-select-none":
        meeting.selected.clear();
        meeting.excluded = new Set(meeting.order);
        renderMeetingTree();
        renderMeetingPreview();
        break;
      case "meeting-up":
        moveMeetingItem(id, -1);
        break;
      case "meeting-down":
        moveMeetingItem(id, 1);
        break;
      case "meeting-break":
        meeting.breaks.has(id)
          ? meeting.breaks.delete(id)
          : meeting.breaks.add(id);
        renderMeetingTree();
        renderMeetingPreview();
        break;
      case "project":
        setTaskSelection(ui, { all: true });
        ui.projects = id === "all" ? [] : [id];
        ui.filterDraft = null;
        ui.project = id;
        render();
        break;
      case "view":
        ui.searchEverywhere = false;
        $("#search-everywhere").checked = false;
        if (["events", "calendar"].includes(id))
          setTaskSelection(ui, { all: true });
        ui.filterDraft = null;
        if (id === "deadlines") {
          ui.dateMode = "deadline";
          if (!ui.from && !ui.to) {
            ui.from = TODAY;
            ui.to = addDays(TODAY, 6);
          }
          ui.filterDraft = null;
        }
        ui.view = id;
        render();
        break;
      case "clear-filter":
        ui[id] = "";
        render();
        break;
      case "reset-filters":
        setTaskSelection(ui, { all: true });
        ui.projects = [];
        ui.project = "all";
        ui.from = ui.to = "";
        ui.dateMode = ui.view === "deadlines" ? "deadline" : "overlap";
        ui.filterDraft = null;
        ui.q = "";
        $("#search").value = "";
        ui.responsible = ui.executor = ui.status = ui.due = "";
        render();
        break;
      case "all-with-filters":
        setTaskSelection(ui, { all: true });
        ui.projects = [];
        ui.filterDraft = null;
        ui.project = "all";
        render();
        break;
      case "toggle-task":
        ui.collapsed.has(id) ? ui.collapsed.delete(id) : ui.collapsed.add(id);
        renderContent();
        break;
      case "toggle-project":
        ui.closedProjects.has(id)
          ? ui.closedProjects.delete(id)
          : ui.closedProjects.add(id);
        renderContent();
        break;
      case "create-task":
        openTask();
        break;
      case "create-event":
        openTask(null, null, null, "event");
        break;
      case "add-to-project":
        openTask(null, null, id);
        break;
      case "edit-task":
        openTask(id);
        break;
      case "add-child":
        openTask(null, id);
        break;
      case "close-drawer":
        closeDrawer();
        break;
      case "delete-task":
        deleteTask(id);
        break;
      case "confirm-task-delete":
        void confirmTaskDelete(id);
        break;
      case "task-menu":
        popup(task(id), button);
        break;
      case "manage":
        manage();
        break;
      case "manage-tab":
        manage(id);
        break;
      case "new-project":
        directoryEdit(null, true);
        break;
      case "directory-add":
        directoryEdit();
        break;
      case "directory-edit":
        directoryEdit(id);
        break;
      case "directory-save":
        saveDirectory();
        break;
      case "directory-hide":
        void hideDirectory(
          id,
          Number(button.dataset.revision),
          button.dataset.archived === "true",
        );
        break;
      case "directory-delete":
        directoryDelete(id);
        break;
      case "confirm-directory-delete":
        confirmDirectoryDelete();
        break;
      case "close-modal":
        closeModal();
        break;
      case "quick-note":
        ui.quick = ui.quick === id ? null : id;
        renderContent();
        document
          .querySelector(
            `.note-composer[data-scope="row"][data-task="${CSS.escape(id)}"] .note-text`,
          )
          ?.focus();
        break;
      case "post-note":
        postNote(button.closest(".note-composer"));
        break;
      case "add-comment":
        postNote($("#comment-text")?.closest(".note-composer"));
        break;
      case "resolve-note":
        void resolveNote(
          id,
          button.dataset.note,
          Number(button.dataset.revision),
          button.dataset.resolved === "true",
        );
        break;
      case "office-sheet":
        if (officeView) {
          officeView.sheet = Number(id);
          officeView.row = officeView.col = 0;
          renderWorkbook();
        }
        break;
      case "office-row":
        if (officeView) {
          officeView.row = Math.max(0, officeView.row + Number(id));
          renderWorkbook();
        }
        break;
      case "office-col":
        if (officeView) {
          officeView.col = Math.max(0, officeView.col + Number(id));
          renderWorkbook();
        }
        break;
      case "preview-file":
        void previewFile(id, button.dataset.file);
        break;
      case "download-file":
        void previewFile(id, button.dataset.file, true);
        break;
      case "remove-file":
        askRemoveFile(id, button.dataset.file);
        break;
      case "confirm-remove-file":
        void removeFile(id, button.dataset.file);
        break;
      case "retry-file":
        void retryFile(id, button.dataset.file);
        break;
      case "discard-drawer":
        closeModal();
        closeDrawer(true);
        break;
      case "reload-card": {
        const id = ui.drawer.id;
        modal(
          "Загрузить актуальную карточку?",
          '<p class="activity-empty">Несохранённые поля будут заменены данными из базы.</p>',
          `<button class="btn" data-action="close-modal">Отмена</button><button class="btn primary" data-action="confirm-reload-card" data-id="${E(id)}">Загрузить</button>`,
          true,
        );
        break;
      }
      case "confirm-reload-card":
        void (async () => {
          try {
            acceptModel(await getWorkspace(), true);
            closeModal();
            closeDrawer(true);
            openTask(id);
            render();
          } catch (e) {
            toast(e.message);
          }
        })();
        break;
      case "reload-workspace":
        void reloadWorkspace(true);
        break;
      case "unassigned-projects":
        setTaskSelection(ui, { all: true });
        ui.projects = ["none"];
        ui.project = "none";
        ui.filterDraft = null;
        render();
        break;
      case "gantt-previous":
        ui.ganttOffset -= 21;
        renderContent();
        break;
      case "gantt-next":
        ui.ganttOffset += 21;
        renderContent();
        break;
      case "gantt-today":
        ui.ganttOffset = 0;
        renderContent();
        break;
    }
  });
  document.addEventListener("input", (event) => {
    if (event.target.closest("#meeting-root")) meetingControl(event);
  });
  document.addEventListener("change", (event) => {
    if (
      event.target.closest("#meeting-root") &&
      event.target.tagName !== "INPUT"
    )
      meetingControl(event);
  });
  window.addEventListener("afterprint", () =>
    document.body.classList.remove("meeting-print"),
  );
  window.addEventListener("resize", () => {
    if (meeting) fitMeetingPreview();
  });
  document.addEventListener("input", (event) => {
    const composer = event.target.closest(".note-composer");
    if (composer)
      ui.noteDrafts[`${composer.dataset.scope}:${composer.dataset.task}`] = {
        kind: composer.querySelector(".note-kind").value,
        text: composer.querySelector(".note-text").value,
      };
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-upload-task]")) {
      void uploadFiles(event.target);
      return;
    }
    const composer = event.target.closest(".note-composer");
    if (composer)
      ui.noteDrafts[`${composer.dataset.scope}:${composer.dataset.task}`] = {
        kind: composer.querySelector(".note-kind").value,
        text: composer.querySelector(".note-text").value,
      };
    if (event.target.id === "task-kind") updateEventFields();
    const id = event.target.id,
      value = event.target.value;
    if (id === "search-everywhere") {
      ui.searchEverywhere = event.target.checked;
      setTaskSelection(ui, { all: true });
      ui.filterDraft = null;
      render();
    }
    if (id === "show-done") {
      ui.done = event.target.checked;
      if (ui.filterDraft) ui.filterDraft.showDone = ui.done;
      render();
    }
    if (id === "expand-all") {
      ui.expand = event.target.checked;
      ui.collapsed.clear();
      render();
    }
    if (id === "manager-archived") {
      ui.managerArchived = event.target.checked;
      renderDirectory();
    }
    if (id === "task-parent") {
      const parent = task(value);
      $("#task-project").disabled = !!parent;
      if (parent) $("#task-project").value = parent.project;
    }
    if (id === "task-project") {
      const selected = ui.drawer.id ? descendants(ui.drawer.id) : new Set();
      $("#task-parent").innerHTML =
        '<option value="">Самостоятельная задача</option>' +
        model.tasks
          .filter(
            (t) =>
              t.kind === "task" && t.project === value && !selected.has(t.id),
          )
          .map((t) => `<option value="${E(t.id)}">${E(t.title)}</option>`)
          .join("");
    }
    if (id === "existing-contact") {
      $("#directory-name").disabled = !!value;
    }
  });
  $("#search").addEventListener("input", (event) => {
    ui.q = event.target.value;
    if (ui.filterDraft) ui.filterDraft.text = ui.q;
    renderContent();
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id === "task-form") {
      event.preventDefault();
      saveTask(event.target);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      meeting &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "p"
    ) {
      event.preventDefault();
      printMeeting();
      return;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing &&
      event.target.matches(".note-text")
    ) {
      event.preventDefault();
      postNote(event.target.closest(".note-composer"));
      return;
    }
    if (event.key === "Escape") {
      if (meeting) {
        closeMeeting();
        return;
      }
      if ($("#modal-root").children.length) closeModal();
      else closeDrawer();
      $("#popup-root").innerHTML = "";
    }
    if (
      event.key === "/" &&
      !meeting &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
    ) {
      event.preventDefault();
      $("#search").focus();
    }
    if (event.key === "Tab") {
      const container =
        $("#meeting-root .meeting-workspace") ||
        $("#modal-root .modal") ||
        $("#drawer-root .drawer");
      if (container) {
        const inputs = [
          ...container.querySelectorAll("button,input,select,textarea"),
        ].filter((e) => !e.disabled && e.offsetParent !== null);
        const first = inputs[0],
          last = inputs.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (drawerDirty() || requests || ui.uploads) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("focus", () => {
    if (!requests && !ui.uploads) void reloadWorkspace();
  });
  productUI = window.createProductUI({
    model: () => model,
    ui: () => ui,
    E,
    icon,
    uid,
    options,
    statuses,
    descendants,
    path: taskPath,
    dirty: drawerDirty,
    closeDrawer,
    signature: taskFormSignature,
    saveTask,
    openTask,
    today: () => TODAY,
    attachmentList,
    notesHtml,
    noteComposer,
    activitySummary,
    manage,
    modal,
    closeModal,
    errorIn,
    busy: busyButton,
    mutate,
    checkedFetch,
    render,
    reload: () => reloadWorkspace(true),
    toast,
    matches,
    gantt,
    row: renderTaskRow,
  });
  const initial = new URL(location.href);
  initialLocation();
  $("#profile-name").textContent = model.session.name;
  $("#current-date").textContent = new Date().toLocaleDateString("ru-RU", {
    timeZone: model.timeZone,
    day: "numeric",
    month: "long",
  });
  render();
  syncStatus("Данные загружены");
  if (
    initial.searchParams.get("task") &&
    task(initial.searchParams.get("task"))
  )
    openTask(initial.searchParams.get("task"));
  if (initial.searchParams.get("new"))
    openTask(
      null,
      null,
      null,
      initial.searchParams.get("new") === "event" ? "event" : "task",
    );
  if (
    ["projects", "contacts", "responsibles"].includes(
      initial.searchParams.get("manage"),
    )
  )
    manage(initial.searchParams.get("manage"));
  if (initial.searchParams.get("output")) {
    openMeeting();
    if (initial.searchParams.get("output") === "meeting")
      changeOutputFormat("meeting");
  }
})().catch((error) => {
  const root = document.querySelector("#sync-status");
  if (root)
    root.textContent =
      error.status === 401
        ? "Войдите в приложение повторно"
        : "Не удалось загрузить данные: " + error.message;
  const holder = document.querySelector("#task-content");
  if (holder) {
    holder.replaceChildren();
    const p = document.createElement("p");
    p.className = "form-error";
    p.textContent = error.message;
    const retry = document.createElement("button");
    retry.className = "btn";
    retry.textContent = error.status === 401 ? "Войти" : "Повторить";
    retry.addEventListener("click", () =>
      error.status === 401
        ? location.assign(
            "/login?next=" +
              encodeURIComponent(location.pathname + location.search),
          )
        : location.reload(),
    );
    holder.append(p, retry);
  }
});
