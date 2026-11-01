/* Product-specific cards, activities and import, sharing the workspace renderer. */
window.createProductUI = function (ctx) {
  "use strict";
  const $ = (s) => document.querySelector(s),
    $$ = (s) => [...document.querySelectorAll(s)],
    E = ctx.E,
    icon = ctx.icon;
  const model = () => ctx.model(),
    ui = () => ctx.ui(),
    item = (id) => model().tasks.find((t) => t.id === id),
    project = (id) => model().projects.find((p) => p.id === id),
    person = (id) => model().contacts.find((c) => c.id === id);
  const labels = {
    task: "Задача",
    event: "Мероприятие",
    preparation: "Подготовка",
    question: "Вопрос",
    note: "Заметка / материал",
    reference: "Вопрос по рабочей задаче",
  };
  let calendarOffset = 0,
    linkContext = null,
    importContext = null,
    promoteContext = null;
  const field = (label, id, html) =>
    `<div class="field"><label for="${id}">${label}</label>${html}</div>`;
  const choices = (name, ids, contacts = model().contacts) =>
    `<div class="multi" id="${name}-choices">${
      contacts
        .filter((c) => !c.archived || ids.includes(c.id))
        .map(
          (c) =>
            `<label><input type="checkbox" name="${name}" value="${E(c.id)}" ${ids.includes(c.id) ? "checked" : ""}>${E(c.name)}</label>`,
        )
        .join("") || '<span class="muted">Добавьте контакт в справочнике</span>'
    }</div>`;
  const names = (ids) =>
    ids
      .map((id) => person(id)?.name)
      .filter(Boolean)
      .join(", ");
  const byDate = (t) =>
    t.start && t.end && t.start !== t.end
      ? `${t.start} — ${t.end}`
      : t.start || t.end || "Дата не назначена";
  const kindBadge = (t) =>
    `<span class="badge">${labels[t.kind] || "Запись"}</span>`;
  function renderTags() {
    const data = ui().drawer?.data;
    if (!data || !$("#task-tags")) return;
    $("#task-tags").innerHTML = (data.tags || [])
      .map(
        (name, i) =>
          `<span class="tag-chip">${E(name)}<button type="button" data-product="remove-tag" data-index="${i}" aria-label="Убрать тег ${E(name)}">×</button></span>`,
      )
      .join("");
  }
  function addTag() {
    const input = $("#task-tag-input"),
      name = input?.value.normalize("NFC").trim().replace(/\s+/g, " ");
    if (!name) return;
    const data = ui().drawer.data;
    if (
      !data.tags.some(
        (t) => t.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"),
      )
    )
      data.tags.push(name);
    input.value = "";
    renderTags();
    input.focus();
  }
  function parentOptions(data) {
    const blocked = ctx.descendants(data.id),
      eligible = model().tasks.filter(
        (t) =>
          !blocked.has(t.id) &&
          (data.kind === "task"
            ? t.kind === "task" && t.project === data.project
            : data.kind === "event"
              ? t.kind === "event"
              : !["task", "event"].includes(t.kind) &&
                t.activityId === data.activityId),
      );
    return ctx.options(
      eligible.map((t) => ({ id: t.id, name: t.title })),
      data.sourceParent || data.parent || "",
      "Без родителя",
    );
  }
  function peopleFields(data) {
    return `<div class="field"><span class="field-label">Контрагенты / участники</span>${choices("counterparties", data.counterparties)}</div><div class="field"><span class="field-label" id="executor-label">Исполнители</span>${choices("executors", data.executors)}</div>${field(
      "Ответственный",
      "task-responsible",
      `<select id="task-responsible" name="responsible">${ctx.options(
        model().contacts.filter(
          (c) => (c.responsible && !c.archived) || c.id === data.responsible,
        ),
        data.responsible,
        "Не назначен",
      )}</select>`,
    )}<button type="button" class="textbtn" data-product="contacts">Добавить / изменить контакты</button>`;
  }
  function newData(id, parent, projectId, kind, extra) {
    const source = parent ? item(parent) : null,
      activityId =
        extra.activityId ||
        (source?.kind === "event" ? source.id : source?.activityId) ||
        null;
    return {
      id: ctx.uid(),
      kind,
      title: "",
      description: "",
      outcome: "",
      project:
        kind === "task"
          ? source?.kind === "task"
            ? source.project
            : projectId ||
              (ui().projects.length === 1 && ui().projects[0] !== "none"
                ? ui().projects[0]
                : "")
          : "",
      parent: source?.id || null,
      sourceParent:
        source?.kind === "event" && kind !== "event"
          ? null
          : source?.id || null,
      activityId: !["task", "event"].includes(kind) ? activityId : null,
      linkedTaskId: extra.linkedTaskId || null,
      originItemId: extra.originItemId || null,
      topics: [],
      manualTopics: extra.topics || [],
      counterparties: [],
      executors: [],
      responsible: "",
      tags: [],
      start: "",
      end: "",
      startTime: "",
      endTime: "",
      location: "",
      timeZone: model().timeZone,
      status: "PLANNED",
      percent: 0,
      revision: 0,
      comments: [],
      attachments: [],
    };
  }
  function openCard(
    id = null,
    parent = null,
    projectId = null,
    kind = "task",
    extra = {},
  ) {
    if (ui().drawer) {
      if (ctx.dirty()) return;
      ctx.closeDrawer(true);
    }
    const original = id ? item(id) : null;
    if (id && !original) return;
    const data = original
      ? structuredClone(original)
      : newData(id, parent, projectId, kind, extra);
    data.tags ||= [];
    data.counterparties ||= [];
    data.manualTopics ||= [];
    ui().drawer = { id, parent, project: projectId, kind: data.kind, data };
    const isEvent = data.kind === "event",
      work = data.kind === "task",
      agenda = !work && !isEvent;
    const scope = work
      ? field(
          "Тема / проект",
          "task-project",
          `<select id="task-project" name="project" ${data.sourceParent ? "disabled" : ""}>${ctx.options(
            model().projects.filter(
              (p) => !p.archived || p.id === data.project,
            ),
            data.project,
            "Без темы",
          )}</select>`,
        )
      : `<input id="task-project" type="hidden" value=""><p class="context-path">${isEvent ? "Мероприятие объединяет несколько тем" : `Мероприятие: ${E(item(data.activityId)?.title || "")}`}</p>`;
    const topics = isEvent
      ? `<div class="field"><span class="field-label">Связанные темы</span><div class="multi">${
          model()
            .projects.filter(
              (p) => !p.archived || data.manualTopics.includes(p.id),
            )
            .map(
              (p) =>
                `<label><input type="checkbox" name="topics" value="${E(p.id)}" ${data.manualTopics.includes(p.id) ? "checked" : ""}>${E(p.name)}</label>`,
            )
            .join("") ||
          '<span class="muted">Темы можно добавить в справочнике</span>'
        }</div><small>Темы связанных рабочих задач также учитываются автоматически.</small></div>`
      : "";
    const context = agenda
      ? `<button type="button" class="textbtn" data-product="open" data-id="${E(data.activityId)}">← Вернуться к мероприятию</button>`
      : "";
    const ref =
      data.kind === "reference"
        ? `<div class="info-box">${data.linkedTaskId ? `Рабочая задача: <button type="button" class="textbtn" data-product="open" data-id="${E(data.linkedTaskId)}">${E(data.workingTitle || item(data.linkedTaskId)?.title || data.title)} ↗</button><br>Здесь — вопросы и назначения на это мероприятие. Рабочая карточка сохраняет свои назначения.` : "Связанная рабочая задача удалена. Содержание обсуждения сохранено."}</div>`
        : "";
    $("#drawer-root").innerHTML =
      `<div class="backdrop" data-action="close-drawer"></div><section class="drawer" role="dialog" aria-modal="true" aria-label="${E(labels[data.kind])}"><div class="drawer-head"><div class="eyebrow"><span>${id ? "КАРТОЧКА" : "СОЗДАНИЕ"} · ${E(labels[data.kind])}</span><button class="tinybtn" data-action="close-drawer" aria-label="Закрыть карточку">${icon("close")}</button></div><h2>${E(id ? data.title : labels[data.kind])}</h2>${context}</div><form id="task-form" class="drawer-body"><div id="task-error"></div><input type="hidden" name="kind" value="${E(data.kind)}">${ref}${field("Название", "task-title", `<input id="task-title" name="title" maxlength="1000" required placeholder="Короткое название" value="${E(data.title)}">`)}${scope}${topics}${field(isEvent ? "Родительское мероприятие" : "Родительская запись", "task-parent", `<select id="task-parent" name="parent">${parentOptions(data)}</select>`)}${field(isEvent ? "Содержание и цель" : data.kind === "reference" ? "Что обсудить" : "Описание / проблематика", "task-description", `<textarea id="task-description" name="description" placeholder="Свободное описание">${E(data.description)}</textarea>`)}<div class="field"><span class="field-label">Теги</span><div class="tag-chips" id="task-tags"></div><div class="tag-add"><input id="task-tag-input" list="tag-suggestions" placeholder="Выбрать или создать тег" maxlength="200"><button class="btn" type="button" data-product="add-tag">Добавить тег</button></div><datalist id="tag-suggestions">${model()
        .tags.filter((t) => !t.archived)
        .map((t) => `<option value="${E(t.name)}"></option>`)
        .join(
          "",
        )}</datalist></div>${peopleFields(data)}<div class="twocol">${field(isEvent ? "Начало мероприятия" : "Начало", "task-start", `<input id="task-start" type="date" name="start" value="${E(data.start)}">`)}${field(isEvent ? "Окончание мероприятия" : "Дедлайн", "task-end", `<input id="task-end" type="date" name="end" value="${E(data.end)}">`)}</div>${isEvent ? `<div id="event-fields"><div class="twocol">${field("Время начала", "event-start-time", `<input id="event-start-time" type="time" name="startTime" value="${E(data.startTime)}">`)}${field("Время окончания", "event-end-time", `<input id="event-end-time" type="time" name="endTime" value="${E(data.endTime)}">`)}</div>${field("Место / ссылка", "event-location", `<input id="event-location" name="location" value="${E(data.location)}">`)}${field("Часовой пояс", "task-timezone", `<select id="task-timezone" name="timeZone">${[...new Set([data.timeZone, "Asia/Jerusalem", "Europe/Bratislava", "UTC"])].map((t) => `<option ${t === data.timeZone ? "selected" : ""}>${E(t)}</option>`).join("")}</select>`)}</div>` : ""}<div class="twocol">${field(
        "Статус",
        "task-status",
        `<select id="task-status" name="status">${Object.entries(ctx.statuses)
          .filter(([key]) => isEvent || key !== "CANCELLED")
          .map(
            ([id, name]) =>
              `<option value="${id}" ${id === data.status ? "selected" : ""}>${E(name)}</option>`,
          )
          .join("")}</select>`,
      )}${work ? field("Выполнение, %", "task-percent", `<input id="task-percent" name="percent" type="number" min="0" max="100" value="${data.percent}">`) : ""}</div>${isEvent || agenda ? field("Итоги / договорённости", "item-outcome", `<textarea id="item-outcome" name="outcome" placeholder="Что решили, какие следующие действия">${E(data.outcome)}</textarea>`) : ""}<section class="activity-section"><div class="activity-heading">${isEvent ? "Содержание, вопросы и подготовка" : "Подзадачи и мероприятия"}</div><div class="card-child-actions"><button class="btn" type="button" data-product="child" data-kind="${work ? "task" : "preparation"}">＋ Подзадача</button>${isEvent || agenda ? '<button class="btn" type="button" data-product="child" data-kind="question">＋ Вопрос</button><button class="btn" type="button" data-product="child" data-kind="note">＋ Заметка / материал</button>' : ""}<button class="btn" type="button" data-product="child" data-kind="event">＋ Мероприятие</button>${isEvent ? '<button class="btn" type="button" data-product="link-tasks">Добавить задачи из тем</button>' : ""}</div><small>${id ? "Новые записи можно добавлять прямо из карточки." : "При добавлении дочерней записи сначала сохранится эта карточка."}</small>${isEvent ? `<div class="agenda-filter"><input id="agenda-search" placeholder="Поиск по повестке" aria-label="Поиск по повестке"><select id="agenda-counterparty" aria-label="Контрагент в повестке">${ctx.options(model().contacts, "", "Все контрагенты")}</select></div>` : ""}<div id="card-children"></div></section><section class="activity-section"><div class="activity-heading">${icon("paperclip", true)} Файлы и графики</div><div id="drawer-files">${ctx.attachmentList(original || data)}</div><label class="upload-zone">${icon("plus", true)} Прикрепить файлы<input type="file" multiple data-upload-task="${E(data.id)}" aria-label="Прикрепить файлы" hidden></label><small>DOCX, Excel, PDF, изображения и текст — просмотр здесь. Оригиналы сохраняются.</small></section><section class="activity-section"><div class="activity-heading">Комментарии и вопросы</div><div id="comment-list">${ctx.notesHtml(original || data)}</div>${ctx.noteComposer(original || data, "drawer")}</section>${data.legacyTags ? `<details><summary>Исходные теги</summary><p>${E(data.legacyTags)}</p></details>` : ""}</form><div class="drawer-footer"><button class="btn primary" type="submit" form="task-form">Сохранить</button><button class="btn" data-action="close-drawer">Отмена</button>${id ? `<button class="btn" type="button" data-action="meeting-open" data-id="${E(id)}">Вывод</button>${agenda && data.kind !== "reference" ? '<button class="btn" type="button" data-product="promote">Добавить в тему</button>' : ""}<button class="btn danger" data-action="delete-task" data-id="${E(id)}">Удалить</button>` : ""}</div></section>`;
    renderTags();
    renderChildren();
    ui().drawer.baseline = ctx.signature();
    $("#task-title").focus();
    const url = new URL(location.href);
    url.searchParams.delete("new");
    if (id) url.searchParams.set("task", id);
    else url.searchParams.set("new", data.kind);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  function renderChildren() {
    if (!$("#card-children") || !ui().drawer) return;
    const data = ui().drawer.data,
      current = item(data.id) || data,
      isEvent = current.kind === "event",
      children = model().tasks.filter((t) =>
        isEvent
          ? t.activityId === current.id && !t.sourceParent
          : t.sourceParent === current.id ||
            (t.kind === "event" &&
              ((current.relatedEvents || []).includes(t.id) ||
                t.originItemId === current.id)),
      );
    const seen = new Set();
    const rows = children.filter((t) => !seen.has(t.id) && seen.add(t.id));
    $("#card-children").innerHTML = rows.length
      ? rows.map((t) => agendaRow(t, 0)).join("")
      : '<p class="activity-empty">Вложенных записей пока нет.</p>';
    if (isEvent) {
      const nested = model().tasks.filter(
        (t) =>
          t.kind === "event" &&
          t.sourceParent === current.id &&
          !seen.has(t.id),
      );
      $("#card-children").insertAdjacentHTML(
        "beforeend",
        nested.map((t) => agendaRow(t, 0)).join(""),
      );
    }
  }
  function agendaMatches(t, seen = new Set()) {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    const words = ($("#agenda-search")?.value || "")
        .toLocaleLowerCase("ru")
        .split(/\s+/)
        .filter(Boolean),
      who = $("#agenda-counterparty")?.value || "";
    const text =
      `${t.title} ${t.description} ${t.outcome || ""} ${extraSearch(t)} ${ctx.path(t.id)}`.toLocaleLowerCase(
        "ru",
      );
    const own =
      words.every((word) => text.includes(word)) &&
      (!who ||
        (t.kind === "event"
          ? t.rolePeople?.counterparty || []
          : t.counterparties
        ).includes(who));
    return (
      own ||
      model().tasks.some(
        (c) =>
          c.sourceParent === t.id &&
          c.activityId === t.activityId &&
          agendaMatches(c, seen),
      )
    );
  }
  function agendaRow(t, level = 0) {
    if (!agendaMatches(t)) return "";
    const linked = t.linkedTaskId ? item(t.linkedTaskId) : null,
      children = model().tasks.filter(
        (c) =>
          c.sourceParent === t.id &&
          c.activityId === t.activityId &&
          c.kind !== "event" &&
          agendaMatches(c),
      );
    const siblings = model().tasks.filter(
        (c) =>
          c.sourceParent === t.sourceParent &&
          c.activityId === t.activityId &&
          (t.kind === "event"
            ? c.kind === "event"
            : !["task", "event"].includes(c.kind)),
      ),
      index = siblings.findIndex((c) => c.id === t.id);
    return `<article class="agenda-row" data-agenda-item="${E(t.id)}" style="--agenda-level:${Math.min(4, level)}"><div class="agenda-row-title">${kindBadge(t)}<span class="agenda-order"><button type="button" class="tinybtn" data-product="move-item" data-id="${E(t.id)}" data-direction="-1" aria-label="Выше: ${E(t.title)}" ${index <= 0 ? "disabled" : ""}>↑</button><button type="button" class="tinybtn" data-product="move-item" data-id="${E(t.id)}" data-direction="1" aria-label="Ниже: ${E(t.title)}" ${index >= siblings.length - 1 ? "disabled" : ""}>↓</button></span><button class="task-title" type="button" data-product="open" data-id="${E(linked?.id || t.id)}">${E(linked?.title || t.title)}</button><span class="status ${t.status}">${E(ctx.statuses[t.status])}</span></div>${t.kind === "reference" ? `<button class="textbtn" type="button" data-product="open" data-id="${E(t.id)}">Вопросы и участники этой встречи</button>` : ""}${t.description ? `<p class="agenda-description">${E(t.description)}</p>` : ""}${t.outcome ? `<p class="agenda-outcome"><strong>Итоги:</strong> ${E(t.outcome)}</p>` : ""}<div class="agenda-people">${t.counterparties.length ? `Контрагенты: ${E(names(t.counterparties))} · ` : ""}${t.executors.length ? `Исполнители: ${E(names(t.executors))} · ` : ""}${t.responsible ? `Ответственный: ${E(names([t.responsible]))}` : ""}</div>${t.tags.length ? `<div class="tag-chips">${t.tags.map((tag) => `<span class="tag-chip">${E(tag)}</span>`).join("")}</div>` : ""}${ctx.activitySummary(t)}${children.map((c) => agendaRow(c, level + 1)).join("")}</article>`;
  }
  async function addFromCard(kind) {
    let sourceId = ui().drawer?.data.id;
    if (!sourceId) return;
    if (!ui().drawer.id || ctx.dirty()) {
      if (!(await ctx.saveTask($("#task-form")))) return;
    } else ctx.closeDrawer(true);
    const source = item(sourceId);
    if (!source) return;
    if (kind === "event") {
      const parent = source.kind === "event" ? source.id : source.activityId;
      ctx.openTask(null, parent || null, null, "event", {
        originItemId: source.id,
      });
    } else
      ctx.openTask(null, source.id, null, kind, {
        activityId: source.kind === "event" ? source.id : source.activityId,
      });
  }
  function refreshLookups() {
    if (!ui().drawer || !$("#task-form") || $("#task-form").inert) return;
    for (const name of ["counterparties", "executors"]) {
      const box = $("#" + name + "-choices");
      if (!box) continue;
      const ids = [...box.querySelectorAll("input:checked")].map(
        (i) => i.value,
      );
      box.outerHTML = choices(name, ids);
    }
    const responsible = $("#task-responsible");
    if (responsible) {
      const value = responsible.value;
      responsible.innerHTML = ctx.options(
        model().contacts.filter(
          (c) => (c.responsible && !c.archived) || c.id === value,
        ),
        value,
        "Не назначен",
      );
    }
    renderChildren();
  }
  function eventCard(t) {
    return `<article class="event-card" data-event="${E(t.id)}"><div class="agenda-row-title">${kindBadge(t)}<button class="task-title" data-product="open" data-id="${E(t.id)}">${E(t.title)}</button><span class="status ${t.status}">${E(ctx.statuses[t.status])}</span></div><p>${E(byDate(t))}${t.startTime ? " · " + E(t.startTime) : ""}${t.location ? " · " + E(t.location) : ""}</p><p class="agenda-description">${E(t.description)}</p><div class="tag-chips">${t.topics.map((id) => `<span class="tag-chip">${E(project(id)?.name || "")}</span>`).join("")}</div><p class="agenda-people">${E(names(t.participants || []))}</p><div class="card-child-actions"><button class="textbtn" data-product="open" data-id="${E(t.id)}">Открыть повестку</button><button class="textbtn" data-action="meeting-open" data-id="${E(t.id)}">Печать / PDF</button></div></article>`;
  }
  function renderView() {
    const view = ui().view;
    if (ui().searchEverywhere) {
      const results = model().tasks.filter(ctx.matches);
      $("#page-title").textContent = "Поиск по всем разделам";
      $("#breadcrumb").textContent = "Рабочее пространство / Поиск";
      $("#page-subtitle").textContent =
        "Рабочие задачи, мероприятия, вопросы и подготовка · активные условия показаны в фильтрах";
      $("#task-content").innerHTML =
        results
          .map(
            (t) =>
              `<article class="event-card"><div class="agenda-row-title">${kindBadge(t)}<button class="task-title" data-product="open" data-id="${E(t.id)}">${E(t.title)}</button></div><p>${E(ctx.path(t.id))}</p><p class="agenda-description">${E(t.description)}</p><p class="agenda-people">Контрагенты: ${E(names(t.counterparties))} · Исполнители: ${E(names(t.executors))}</p>${ctx.activitySummary(t)}</article>`,
          )
          .join("") ||
        '<div class="section empty">Совпадений нет. Измените поиск или условия.</div>';
      $("#result-count").textContent = "Найдено записей: " + results.length;
      return true;
    }
    if (!["events", "calendar"].includes(view)) return false;
    $("#page-title").textContent =
      view === "calendar" ? "Календарь мероприятий" : "Мероприятия";
    $("#breadcrumb").textContent = "Рабочее пространство / Мероприятия";
    $("#page-subtitle").textContent =
      "Встречи, поездки, вопросы, подготовка и итоги · рабочие задачи остаются в своих темах";
    const events = model().tasks.filter(
      (t) => t.kind === "event" && ctx.matches(t),
    );
    $("#result-count").textContent = "Мероприятий: " + events.length;
    let html = `<div class="events-view-switch"><button class="btn ${view === "events" ? "soft" : ""}" data-action="view" data-id="events">Список</button><button class="btn ${view === "calendar" ? "soft" : ""}" data-action="view" data-id="calendar">Календарь</button></div>`;
    if (view === "events")
      html += events.length
        ? events
            .slice()
            .sort((a, b) =>
              (a.start || a.end || "9999").localeCompare(
                b.start || b.end || "9999",
              ),
            )
            .map(eventCard)
            .join("")
        : '<div class="section empty"><h3>Мероприятий по этим условиям нет</h3><button class="btn primary" data-action="create-event">Создать мероприятие</button></div>';
    else {
      const now = new Date(ctx.today() + "T12:00:00Z"),
        start = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + calendarOffset, 1),
        ),
        year = start.getUTCFullYear(),
        month = start.getUTCMonth(),
        days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
        offset = (start.getUTCDay() + 6) % 7;
      html += `<div class="calendar-navigation"><button class="btn" data-product="month" data-delta="-1">←</button><strong>${E(start.toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }))}</strong><button class="btn" data-product="month" data-delta="1">→</button><button class="btn" data-product="month" data-delta="0">Сегодня</button></div><div class="event-calendar">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => `<div class="calendar-weekday">${d}</div>`).join("")}${'<div class="calendar-day blank"></div>'.repeat(offset)}${Array.from(
        { length: days },
        (_, i) => {
          const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
          return `<div class="calendar-day"><strong>${i + 1}</strong>${events
            .filter((t) => {
              const a = t.start || t.end,
                b = t.end || t.start;
              return a && a <= date && b >= date;
            })
            .map(
              (t) =>
                `<button data-product="open" data-id="${E(t.id)}">${E(t.startTime ? t.startTime + " " : "")}${E(t.title)}</button>`,
            )
            .join("")}</div>`;
        },
      ).join("")}</div>`;
      const undated = events.filter((t) => !t.start && !t.end);
      if (undated.length)
        html += "<h3>Дата не назначена</h3>" + undated.map(eventCard).join("");
    }
    $("#task-content").innerHTML = html;
    return true;
  }
  function linkTasks() {
    const data = ui().drawer?.data;
    if (!data) return;
    linkContext = {
      activityId: data.kind === "event" ? data.id : data.activityId,
      selected: new Set(),
      requestId: ctx.uid(),
    };
    ctx.modal(
      "Добавить задачи из тем",
      `<p class="activity-empty">Выберите рабочие задачи. Их тема и родитель сохранятся.</p><input id="link-search" placeholder="Название, тема или путь" aria-label="Найти задачу для мероприятия"><div id="link-choices"></div><label class="meeting-option"><input id="link-children" type="checkbox">Включить все подзадачи</label><label class="meeting-option"><input id="link-people" type="checkbox" checked>Взять участников из рабочих задач</label><div id="link-error"></div>`,
      '<button class="btn" data-action="close-modal">Отмена</button><button class="btn primary" data-product="link-apply">Добавить выбранные</button>',
    );
    renderLinkChoices();
  }
  function renderLinkChoices() {
    if (!linkContext || !$("#link-choices")) return;
    const words = ($("#link-search")?.value || "")
      .toLocaleLowerCase("ru")
      .split(/\s+/)
      .filter(Boolean);
    $("#link-choices").innerHTML =
      model()
        .tasks.filter(
          (t) =>
            t.kind === "task" &&
            words.every((w) =>
              `${t.title} ${ctx.path(t.id)}`
                .toLocaleLowerCase("ru")
                .includes(w),
            ),
        )
        .map(
          (t) =>
            `<label class="link-choice"><input type="checkbox" data-link-choice="${E(t.id)}" ${linkContext.selected.has(t.id) ? "checked" : ""}><span><strong>${E(t.title)}</strong><small>${E(ctx.path(t.id))}</small></span></label>`,
        )
        .join("") || "<p>Совпадений нет</p>";
  }
  async function applyLinks(button) {
    if (!linkContext?.selected.size) {
      ctx.errorIn("#link-error", new Error("Выберите хотя бы одну задачу"));
      return;
    }
    ctx.busy(button, true);
    try {
      await ctx.mutate("linkTasks", {
        activityId: linkContext.activityId,
        taskIds: [...linkContext.selected],
        requestId: linkContext.requestId,
        includeChildren: $("#link-children").checked,
        copyPeople: $("#link-people").checked,
      });
      ctx.closeModal();
      renderChildren();
      ctx.render();
      ctx.toast("Задачи добавлены в повестку");
    } catch (error) {
      ctx.errorIn("#link-error", error);
    } finally {
      ctx.busy(button, false);
    }
  }
  function promote() {
    promoteContext = {
      id: ui().drawer.id,
      revision: ui().drawer.data.revision,
    };
    ctx.modal(
      "Добавить в рабочую тему",
      `<p>Пункт и его собственные вложенные пункты станут рабочими задачами. В мероприятии сохранятся ссылки, материалы и обсуждение.</p>${field(
        "Тема",
        "promote-project",
        `<select id="promote-project">${ctx.options(
          model().projects.filter((p) => !p.archived),
          "",
          "Без темы",
        )}</select>`,
      )}${field("Родительская задача", "promote-parent", '<select id="promote-parent"><option value="">В корень темы</option></select>')}<div id="promote-error"></div>`,
      '<button class="btn" data-action="close-modal">Отмена</button><button class="btn primary" data-product="promote-apply">Добавить в тему</button>',
    );
  }
  async function applyPromote(button) {
    ctx.busy(button, true);
    try {
      await ctx.mutate("promoteItem", {
        ...promoteContext,
        project: $("#promote-project").value,
        parent: $("#promote-parent").value || null,
      });
      ctx.closeModal();
      ctx.closeDrawer(true);
      ctx.render();
      ctx.openTask(promoteContext.id);
    } catch (error) {
      ctx.errorIn("#promote-error", error);
    } finally {
      ctx.busy(button, false);
    }
  }
  function importDialog() {
    importContext = null;
    ctx.modal(
      "Импорт отобранных задач",
      `<p>Выберите изменённый tasks-review.xlsx и папку исходной выгрузки. На первом шаге появится предпросмотр.</p>${field("Excel с решениями", "import-workbook", '<input id="import-workbook" type="file" accept=".xlsx">')}${field("Папка экспорта с data.json и files", "import-folder", '<input id="import-folder" type="file" webkitdirectory multiple>')}<div id="import-status"></div><div id="import-error"></div>`,
      '<button class="btn" data-action="close-modal">Закрыть</button><button class="btn primary" data-product="import-preview">Предпросмотр</button>',
    );
  }
  async function previewImport(button) {
    ctx.busy(button, true);
    try {
      const workbook = $("#import-workbook").files[0],
        files = [...$("#import-folder").files],
        data = files.find((f) => f.name === "data.json");
      if (!workbook || !data)
        throw new Error("Выберите Excel и исходную папку экспорта");
      const form = new FormData();
      form.set("workbook", workbook);
      form.set("data", data);
      const response = await ctx.checkedFetch("/api/next/import/preview", {
          method: "POST",
          body: form,
        }),
        preview = await response.json();
      importContext = { preview, files, done: new Set() };
      $("#import-status").innerHTML =
        `<div class="info-box">Оставлено: <strong>${preview.kept}</strong> · Убрано: ${preview.removed}<br>Рабочих задач: ${preview.tasks} · Мероприятий: ${preview.events} · Собственных пунктов: ${preview.points} · Вложений: ${preview.files.length}</div>${(preview.warnings || []).map((w) => `<p class="activity-empty">${E(w)}</p>`).join("")}${preview.completed ? "<p>Этот отбор уже импортирован.</p>" : `<div class="import-items">${(preview.items || []).map((t) => `<p>№ ${t.number} · ${E(labels[t.kind])} · ${E(t.title)} ${t.project ? " · " + E(t.project) : ""}</p>`).join("")}</div><button class="btn primary" type="button" data-product="import-apply">Импортировать отобранное</button>`}`;
    } catch (error) {
      ctx.errorIn("#import-error", error);
    } finally {
      ctx.busy(button, false);
    }
  }
  async function applyImport(button) {
    if (!importContext) return;
    ctx.busy(button, true);
    try {
      const { preview, files, done } = importContext;
      for (const expected of preview.files) {
        if (done.has(expected.id)) continue;
        const file = files.find((f) =>
          f.webkitRelativePath.endsWith("/" + expected.relative),
        );
        if (!file) throw new Error("В папке отсутствует файл " + expected.name);
        const form = new FormData();
        form.set("id", expected.id);
        form.set("file", file);
        await ctx.checkedFetch("/api/next/import/" + preview.token + "/files", {
          method: "POST",
          body: form,
        });
        done.add(expected.id);
        button.textContent = `Загружено файлов: ${done.size} / ${preview.files.length}`;
      }
      const response = await ctx.checkedFetch(
          "/api/next/import/" + preview.token + "/apply",
          { method: "POST" },
        ),
        result = await response.json();
      await ctx.reload();
      $("#import-status").innerHTML =
        `<div class="info-box">Импорт завершён. Сохранено исходных записей: ${result.kept}, вложений: ${result.files}. Исходная выгрузка сохранена.</div>`;
      button.remove();
    } catch (error) {
      ctx.errorIn("#import-error", error);
    } finally {
      ctx.busy(button, false);
    }
  }
  function beforeQuery(t, q) {
    const scope = q.scope || "work";
    return scope === "agenda" || scope === "all"
      ? true
      : scope === "events"
        ? t.kind === "event"
        : t.kind === "task";
  }
  function extraSearch(t) {
    const included = [t];
    if (t.kind === "event") {
      const events = new Set([t.id]);
      let added = true;
      while (added) {
        added = false;
        for (const e of model().tasks)
          if (
            e.kind === "event" &&
            events.has(e.sourceParent) &&
            !events.has(e.id)
          ) {
            events.add(e.id);
            added = true;
          }
      }
      included.push(
        ...model().tasks.filter(
          (i) => events.has(i.activityId) || events.has(i.id),
        ),
      );
    }
    return included
      .map(
        (value) =>
          `${value.title} ${value.description} ${value.outcome || ""} ${(value.tags || []).join(" ")} ${names([...(value.counterparties || []), ...value.executors, ...(value.responsible ? [value.responsible] : [])])} ${(value.attachments || []).map((f) => f.name).join(" ")} ${value.workingTitle || ""} ${value.comments.map((n) => n.text).join(" ")}`,
      )
      .join(" ");
  }
  function renderGrouped(rows) {
    const mode = ui().groupBy || "topics";
    if (
      mode === "topics" ||
      ["events", "calendar", "deadlines"].includes(ui().view)
    )
      return false;
    const groups = new Map();
    for (const t of rows) {
      let keys;
      if (mode === "responsible") keys = [t.responsible || ""];
      else if (mode === "executor")
        keys = t.executors.length ? t.executors : [""];
      else if (mode === "counterparty")
        keys = t.counterparties.length ? t.counterparties : [""];
      else if (mode === "event")
        keys = t.relatedEvents?.length ? t.relatedEvents : [""];
      else if (mode === "status") keys = [t.status];
      else if (mode === "deadline") keys = [t.end || ""];
      else keys = [""];
      for (const key of keys) {
        const group = groups.get(key) || [];
        group.push(t);
        groups.set(key, group);
      }
    }
    $("#task-content").innerHTML =
      [...groups]
        .map(
          ([key, tasks]) =>
            `<section class="section"><div class="section-head"><h2>${E(mode === "status" ? ctx.statuses[key] : mode === "deadline" ? key || "Без срока" : mode === "event" ? item(key)?.title || "Без мероприятия" : person(key)?.name || "Не назначен")}</h2><span class="count">${tasks.length}</span></div>${ui().view === "gantt" ? ctx.gantt(tasks) : `<div class="table-head"><span>Задача</span><span>Исполнитель</span><span>Ответственный</span><span>Срок</span><span>Готовность</span><span>Статус</span><span></span></div>${tasks.map((t) => ctx.row(t, 0, true, true)).join("")}`}</section>`,
        )
        .join("") ||
      '<div class="section empty">Задач по этим условиям нет</div>';
    return true;
  }
  function afterFilters() {
    const node = $(".query-view-options");
    if (node && !$("#group-by"))
      node.insertAdjacentHTML(
        "beforeend",
        `<label class="group-control">Группировать <select id="group-by">${[
          ["topics", "По темам"],
          ["responsible", "По ответственному"],
          ["executor", "По исполнителю"],
          ["counterparty", "По контрагенту"],
          ["status", "По статусу"],
          ["event", "По мероприятию"],
          ["deadline", "По дедлайну"],
        ]
          .map(
            ([id, name]) =>
              `<option value="${id}" ${ui().groupBy === id ? "selected" : ""}>${name}</option>`,
          )
          .join("")}</select></label>`,
      );
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-product]");
    if (!button) return;
    const action = button.dataset.product,
      id = button.dataset.id;
    if (action === "add-tag") addTag();
    if (action === "remove-tag") {
      ui().drawer.data.tags.splice(Number(button.dataset.index), 1);
      renderTags();
    }
    if (action === "open") ctx.openTask(id);
    if (action === "child") void addFromCard(button.dataset.kind);
    if (action === "contacts") ctx.manage("contacts");
    if (action === "link-tasks") linkTasks();
    if (action === "link-apply") void applyLinks(button);
    if (action === "promote") promote();
    if (action === "promote-apply") void applyPromote(button);
    if (action === "move-item") {
      const current = item(id);
      ctx.busy(button, true);
      void ctx
        .mutate("moveItem", {
          id,
          revision: current.revision,
          direction: Number(button.dataset.direction),
        })
        .then(() => renderChildren())
        .catch((error) => ctx.toast(error.message))
        .finally(() => ctx.busy(button, false));
    }
    if (action === "import") importDialog();
    if (action === "import-preview") void previewImport(button);
    if (action === "import-apply") void applyImport(button);
    if (action === "month") {
      calendarOffset =
        button.dataset.delta === "0"
          ? 0
          : calendarOffset + Number(button.dataset.delta);
      ctx.render();
    }
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.target.id === "task-tag-input" && event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        addTag();
      }
    },
    true,
  );
  document.addEventListener("input", (event) => {
    if (event.target.id === "link-search") renderLinkChoices();
    if (event.target.id === "agenda-search") renderChildren();
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "agenda-counterparty") renderChildren();
    if (event.target.dataset.linkChoice) {
      event.target.checked
        ? linkContext.selected.add(event.target.dataset.linkChoice)
        : linkContext.selected.delete(event.target.dataset.linkChoice);
    }
    if (event.target.id === "promote-project")
      $("#promote-parent").innerHTML = ctx.options(
        model()
          .tasks.filter(
            (t) => t.kind === "task" && t.project === event.target.value,
          )
          .map((t) => ({ id: t.id, name: t.title })),
        "",
        "В корень темы",
      );
    if (event.target.id === "group-by") {
      ui().groupBy = event.target.value;
      ctx.render();
    }
  });
  function printItem(t) {
    const linked =
      t.kind === "reference" && t.linkedTaskId ? item(t.linkedTaskId) : null;
    if (!linked) return t;
    const attachments = [
      ...new Map(
        [...linked.attachments, ...t.attachments].map((f) => [f.id, f]),
      ).values(),
    ];
    const comments = [
      ...new Map(
        [...linked.comments, ...t.comments].map((n) => [n.id, n]),
      ).values(),
    ].sort((a, b) => a.createdAt - b.createdAt);
    return {
      ...t,
      start: t.start || linked.start,
      end: t.end || linked.end,
      description: [
        linked.description,
        t.description && t.description !== linked.description
          ? "Вопросы к обсуждению:\n" + t.description
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      attachments,
      comments,
    };
  }
  return {
    printItem,
    openCard,
    renderChildren,
    refreshLookups,
    renderView,
    beforeQuery,
    extraSearch,
    renderGrouped,
    afterFilters,
    renderTags,
    addFromCard,
    labels,
  };
};
