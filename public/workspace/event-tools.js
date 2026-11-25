window.createEventTools = function (ctx) {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const E = ctx.E,
    M = window.WorkspaceMentions;
  const types = {
    meeting: "Встреча",
    trip: "Поездка",
    call: "Звонок",
    other: "Другое",
  };
  const tasks = () => ctx.model().tasks;
  const item = (id) => tasks().find((t) => t.id === id);
  const project = (id) => ctx.model().projects.find((p) => p.id === id);
  const open = (id, label) =>
    `<button type="button" class="textbtn" data-product="open" data-id="${E(id)}">${E(label)}</button>`;
  let index, outcome;

  function members(event) {
    if (index?.tasks !== tasks()) {
      index = { tasks: tasks(), byEvent: new Map(), groups: new Map() };
      for (const t of index.tasks) {
        const owner = t.activityId || (t.kind === "event" && t.sourceParent);
        if (!owner) continue;
        if (!index.byEvent.has(owner)) index.byEvent.set(owner, []);
        index.byEvent.get(owner).push(t);
      }
    }
    if (index.groups.has(event.id)) return index.groups.get(event.id);
    const result = [],
      visited = new Set(),
      queue = [event];
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i];
      if (visited.has(t.id)) continue;
      visited.add(t.id);
      result.push(t);
      if (t.kind === "event") queue.push(...(index.byEvent.get(t.id) || []));
    }
    index.groups.set(event.id, result);
    return result;
  }

  function questions(event, expanded) {
    const result = [],
      seen = new Set();
    for (const t of members(event)) {
      if (t.kind === "question")
        result.push({
          label: t.title,
          text: t.description,
          id: t.id,
          resolved: t.status === "DONE",
        });
      for (const note of t.comments) {
        if (note.kind !== "question" || seen.has(note.id)) continue;
        seen.add(note.id);
        result.push({
          label: t.title,
          text: note.text,
          id: t.id,
          resolved: note.resolved,
        });
      }
    }
    if (!result.length)
      return '<p class="muted event-questions">Вопросов пока нет</p>';
    const first = result[0];
    const excerpt = (
      first.label + (first.text ? " — " + M.plain(first.text) : "")
    )
      .replace(/\s+/g, " ")
      .trim();
    return `<details class="event-questions" data-event-questions="${E(event.id)}" ${expanded ? "open" : ""}><summary>Вопросы (${result.length}) · ${E(excerpt.slice(0, 110))}${excerpt.length > 110 ? "…" : ""}</summary><ul>${result
      .map(
        (q) =>
          `<li>${open(q.id, q.label)} ${q.resolved ? '<span class="muted">Решён</span>' : ""}${q.text ? `<div>${M.html(q.text, E)}</div>` : ""}</li>`,
      )
      .join("")}</ul></details>`;
  }

  function relatedRecords(t) {
    const links = (ids) => ids.map((id) => open(id, ctx.path(id))).join("");
    const published = t.outcomeTaskIds || [];
    const linked =
      t.kind === "event"
        ? (t.linkedTaskIds || []).filter((id) => !published.includes(id))
        : [];
    const received = t.eventOutcomes || [];
    return `${published.length ? `<div class="outcome-target-summary"><strong>Итог добавлен в задачи</strong>${links(published)}</div>` : ""}
      ${linked.length ? `<div class="outcome-target-summary"><strong>Связанные задачи</strong>${links(linked)}</div>` : ""}
      ${
        received.length
          ? `<section class="activity-section"><div class="activity-heading">Итоги мероприятий</div>${received
              .map(
                (o) =>
                  `<article class="outcome-receipt"><div class="outcome-target-summary"><strong>${o.eventId ? open(o.eventId, o.eventTitle) : E(o.eventTitle)}</strong>${o.sourceId && o.sourceId !== o.eventId ? open(o.sourceId, o.sourceTitle) : ""}</div><div class="agenda-outcome">${M.html(o.text, E)}</div></article>`,
              )
              .join("")}</section>`
          : ""
      }`;
  }

  async function chooseOutcome() {
    const drawer = ctx.ui().drawer;
    if (!drawer || drawer.saving) return;
    const form = $("#task-form");
    if (!M.plain(ctx.captureTask(form).outcome).trim()) {
      ctx.toast("Введите итог мероприятия или пункта повестки");
      $("#item-outcome").focus();
      return;
    }
    if ((!drawer.id || ctx.dirty()) && !(await ctx.saveTask(form))) return;
    const source = item(drawer.data.id);
    if (!source || source.revision !== drawer.data.revision) {
      ctx.errorIn(
        "#task-error",
        Object.assign(
          new Error(
            "Итог изменился в другом окне. Загрузите актуальную карточку.",
          ),
          { status: 409 },
        ),
      );
      return;
    }
    const event = source.kind === "event" ? source : item(source.activityId);
    const suggested = new Set(event?.linkedTaskIds || []);
    for (const id of [...suggested]) {
      let parent = item(id)?.sourceParent;
      while (parent && !suggested.has(parent)) {
        suggested.add(parent);
        parent = item(parent)?.sourceParent;
      }
    }
    const topics = (event?.topics || []).filter((id) => !project(id)?.archived),
      defaultProject = topics.length === 1 ? topics[0] : "";
    outcome = {
      source,
      suggested,
      checked: new Set(),
      taskId: ctx.uid(),
      parent: null,
    };
    ctx.modal(
      "Добавить итог в задачи",
      `<div class="field"><label for="outcome-mode">Куда добавить</label><select id="outcome-mode"><option value="existing">В существующие задачи</option><option value="new">В новую задачу</option></select></div>
       <div id="outcome-new" hidden><div class="field"><label for="outcome-title">Название новой задачи</label><input id="outcome-title" maxlength="1000"></div>
       <div class="field"><label for="outcome-project">Рабочая тема</label><select id="outcome-project">${ctx.options(
         ctx.model().projects.filter((p) => !p.archived),
         defaultProject,
         "Без темы",
       )}</select></div>
       <div class="outcome-target-summary"><strong id="outcome-path">В корень темы</strong><button type="button" class="textbtn" data-outcome="root">Выбрать корень темы</button></div></div>
       <div class="field"><label for="outcome-search">Поиск по всему дереву задач</label><input id="outcome-search" placeholder="Название, тема или путь"></div>
       <div id="outcome-choices"></div><p id="outcome-count" role="status"></p><div id="outcome-error"></div>`,
      '<button class="btn" data-action="close-modal">Отмена</button><button type="button" class="btn primary" data-outcome="apply">Добавить итог</button>',
    );
    renderOutcomeChoices();
    $("#outcome-search").focus();
  }

  function renderOutcomeChoices() {
    const node = $("#outcome-choices");
    if (!node) return;
    const create = $("#outcome-mode").value === "new",
      words = $("#outcome-search")
        .value.trim()
        .toLocaleLowerCase("ru")
        .split(/\s+/)
        .filter(Boolean);
    const matches = tasks().filter(
      (t) =>
        t.kind === "task" &&
        (!create || !project(t.project)?.archived) &&
        words.every((word) =>
          ctx.path(t.id).toLocaleLowerCase("ru").includes(word),
        ),
    );
    const row = (t) => {
      const path = E(ctx.path(t.id));
      if (create)
        return `<button type="button" class="branch-result" data-outcome="branch" data-id="${E(t.id)}" aria-pressed="${t.id === outcome.parent}"><strong>${E(t.title)}</strong><small>${path}</small></button>`;
      return `<label class="link-choice"><input type="checkbox" data-outcome-task="${E(t.id)}" ${outcome.checked.has(t.id) ? "checked" : ""}><span><strong>${E(t.title)}</strong><small>${path}${outcome.source.outcomeTaskIds.includes(t.id) ? " · итог добавлен" : ""}</small></span></label>`;
    };
    const related = matches.filter((t) => outcome.suggested.has(t.id)),
      rest = matches.filter((t) => !outcome.suggested.has(t.id));
    const list = (label, rows) =>
      rows.length
        ? `<h3>${label}</h3>${rows.slice(0, 100).map(row).join("")}${rows.length > 100 ? '<p class="muted">Уточните поиск, чтобы увидеть остальные варианты.</p>' : ""}`
        : "";
    node.innerHTML =
      list("Связанные задачи и ветки", related) + list("Другие задачи", rest) ||
      '<p class="muted">Подходящих задач нет.</p>';
    $("#outcome-count").textContent = create
      ? ""
      : "Выбрано задач: " + outcome.checked.size;
  }

  function selectOutcomeBranch(id) {
    const branch = item(id);
    outcome.parent = branch?.id || null;
    if (branch) $("#outcome-project").value = branch.project;
    $("#outcome-path").textContent = branch ? ctx.path(id) : "В корень темы";
    renderOutcomeChoices();
  }

  async function applyOutcome(button) {
    if (button.disabled) return;
    const mode = $("#outcome-mode").value;
    const destination =
      mode === "new"
        ? {
            task: {
              id: outcome.taskId,
              title: $("#outcome-title").value.trim(),
              project: $("#outcome-project").value,
              parent: outcome.parent,
            },
          }
        : { taskIds: [...outcome.checked] };
    if (
      mode === "new" ? !destination.task.title : !destination.taskIds.length
    ) {
      ctx.errorIn(
        "#outcome-error",
        new Error(
          mode === "new"
            ? "Введите название задачи"
            : "Выберите хотя бы одну задачу",
        ),
      );
      return;
    }
    ctx.busy(button, true);
    const body = button.closest(".modal").querySelector(".modal-body");
    body.inert = true;
    try {
      await ctx.mutate("addOutcomeToTasks", {
        mode,
        sourceId: outcome.source.id,
        revision: outcome.source.revision,
        ...destination,
      });
      ctx.closeModal();
      ctx.render();
      ctx.toast(
        mode === "new"
          ? "Задача создана, итог добавлен"
          : "Итог добавлен в выбранные задачи",
      );
    } catch (error) {
      ctx.errorIn("#outcome-error", error);
    } finally {
      body.inert = false;
      ctx.busy(button, false);
    }
  }

  const compact = (date) => date.replace(/[-:]/g, "");
  function calendarDates(event) {
    const start = event.start || event.end,
      end = event.end || start;
    if (!start || end < start)
      throw new Error("Укажите корректные даты мероприятия");
    const shift = (time, minutes) =>
      new Date(Date.parse(time + "Z") + minutes * 60000)
        .toISOString()
        .slice(0, 16);
    if (!event.startTime && !event.endTime)
      return (
        compact(start) + "/" + compact(shift(end + "T00:00", 1440).slice(0, 10))
      );
    let from = start + "T" + (event.startTime || "00:00"),
      to = end + "T" + (event.endTime || event.startTime);
    if (!event.startTime && start === end) from = shift(to, -60);
    if (!event.endTime && start === end) to = shift(from, 60);
    if (to <= from) throw new Error("Время окончания должно быть позже начала");
    return compact(from) + "00/" + compact(to) + "00";
  }
  function calendar(draft) {
    try {
      if (!draft.title) throw new Error("Введите название мероприятия");
      const url = new URL("https://calendar.google.com/calendar/render");
      url.search = new URLSearchParams({
        action: "TEMPLATE",
        text: draft.title,
        dates: calendarDates(draft),
        ctz: draft.timeZone || ctx.model().timeZone,
        location: draft.location,
        details: M.plain(draft.description),
      });
      window.open(url.href, "_blank", "noopener,noreferrer");
    } catch (error) {
      ctx.toast(error.message);
    }
  }

  document.addEventListener("input", (event) => {
    if (event.target.id === "outcome-search") renderOutcomeChoices();
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "outcome-mode") {
      $("#outcome-new").hidden = target.value !== "new";
      renderOutcomeChoices();
    }
    if (target.id === "outcome-project") selectOutcomeBranch(null);
    if (target.dataset.outcomeTask) {
      if (target.checked) outcome.checked.add(target.dataset.outcomeTask);
      else outcome.checked.delete(target.dataset.outcomeTask);
      $("#outcome-count").textContent =
        "Выбрано задач: " + outcome.checked.size;
    }
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-outcome]");
    if (button?.dataset.outcome === "root") selectOutcomeBranch(null);
    if (button?.dataset.outcome === "branch")
      selectOutcomeBranch(button.dataset.id);
    if (button?.dataset.outcome === "apply") void applyOutcome(button);
  });

  return { types, members, questions, relatedRecords, chooseOutcome, calendar };
};
