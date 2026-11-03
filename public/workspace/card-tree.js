/* Context tree and output selection for work tasks and activity agendas. */
window.createCardTree = function (ctx) {
  "use strict";
  const $ = (s) => document.querySelector(s),
    $$ = (s) => [...document.querySelectorAll(s)],
    E = ctx.E,
    M = window.WorkspaceMentions,
    model = ctx.model,
    ui = ctx.ui;
  const item = (id) => model().tasks.find((t) => t.id === id),
    person = (id) => model().contacts.find((c) => c.id === id),
    project = (id) => model().projects.find((p) => p.id === id);
  let rootId = null,
    selected = new Set(),
    group = "manual",
    search = "",
    who = "";
  const people = (t) => [
    ...new Set([
      ...(t.counterparties || []),
      ...t.executors,
      ...(t.responsible ? [t.responsible] : []),
    ]),
  ];
  function findRoot(t) {
    if (!t) return null;
    let id = t.activityId || t.id,
      current = item(id) || t;
    const seen = new Set();
    while (current?.sourceParent && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = item(current.sourceParent);
      if (!parent || parent.kind !== current.kind) break;
      current = parent;
      id = current.id;
    }
    return id;
  }
  function members() {
    const root = item(rootId) || ui().drawer?.data;
    if (!root) return [];
    const byParent = new Map();
    for (const t of model().tasks) {
      const p = t.parent;
      if (p) {
        const list = byParent.get(p) || [];
        list.push(t);
        byParent.set(p, list);
      }
    }
    const result = [],
      seen = new Set(),
      stack = [root];
    while (stack.length) {
      const t = stack.pop();
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      result.push(t);
      for (const c of (byParent.get(t.id) || []).slice().reverse())
        stack.push(c);
    }
    return result;
  }
  function branch(id) {
    const all = members(),
      out = [],
      seen = new Set(),
      stack = [id];
    while (stack.length) {
      const next = stack.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      for (const t of all.filter((t) => t.parent === next).reverse())
        stack.push(t.id);
    }
    return out;
  }
  function groupTitle(t, mode = group) {
    if (mode === "topics")
      return (
        project(t.project)?.name ||
        (t.kind === "event"
          ? t.topics
              .map((id) => project(id)?.name)
              .filter(Boolean)
              .join(", ")
          : "") ||
        "Общие вопросы"
      );
    const ids =
      mode === "counterparty"
        ? t.counterparties
        : mode === "executor"
          ? t.executors
          : mode === "responsible"
            ? [t.responsible].filter(Boolean)
            : [];
    return (
      ids
        .map((id) => person(id)?.name)
        .filter(Boolean)
        .sort()
        .join(", ") || "Не назначен"
    );
  }
  function matches(t) {
    const text = M.plain(
      `${t.title} ${t.description} ${t.outcome || ""}`,
    ).toLocaleLowerCase("ru");
    return (
      search
        .toLocaleLowerCase("ru")
        .split(/\s+/)
        .filter(Boolean)
        .every((w) => text.includes(w)) &&
      (!who || people(t).includes(who) || (t.participants || []).includes(who))
    );
  }
  function actionMenu(t) {
    return `<details class="node-menu"><summary aria-label="Действия пункта: ${E(t.title)}">⋯</summary><div><button type="button" data-tree="open" data-id="${E(t.id)}">Редактировать</button>${t.linkedTaskId ? `<button type="button" data-tree="working" data-id="${E(t.linkedTaskId)}">Открыть рабочую задачу ↗</button>` : ""}<button type="button" data-tree="child" data-id="${E(t.id)}" data-kind="${t.kind === "task" ? "task" : "preparation"}">Добавить подзадачу</button>${t.kind !== "task" ? `<button type="button" data-tree="child" data-id="${E(t.id)}" data-kind="question">Добавить вопрос</button>` : ""}<button type="button" data-tree="child" data-id="${E(t.id)}" data-kind="event">Создать мероприятие</button><button type="button" data-tree="move" data-id="${E(t.id)}">Переместить</button><button type="button" data-tree="up" data-id="${E(t.id)}">Выше ↑</button><button type="button" data-tree="down" data-id="${E(t.id)}">Ниже ↓</button><button type="button" data-tree="print-one" data-id="${E(t.id)}">Вывести этот пункт</button><button type="button" data-tree="print-branch" data-id="${E(t.id)}">Вывести ветку</button><button type="button" class="danger" data-action="delete-task" data-id="${E(t.id)}">${t.kind === "reference" ? "Убрать из мероприятия" : "Удалить этот пункт"}</button></div></details>`;
  }
  function row(t, level) {
    const ids = branch(t.id),
      all = ids.every((id) => selected.has(id)),
      some = ids.some((id) => selected.has(id));
    return `<div class="card-tree-row ${ui().drawer?.data.id === t.id ? "current" : ""}" style="--tree-depth:${Math.min(level, 8)}" data-tree-row="${E(t.id)}"><input type="checkbox" data-tree-choice="${E(t.id)}" aria-label="Выбрать пункт: ${E(t.title)}" ${all ? "checked" : ""} data-partial="${some && !all}"><button type="button" class="tree-title" data-tree="open" data-id="${E(t.id)}"><strong>${E(t.title)}</strong><small>${E(ctx.labels[t.kind])}${t.responsible ? " · " + E(person(t.responsible)?.name || "") : ""}</small></button>${actionMenu(t)}</div>`;
  }
  function render() {
    const node = $("#card-tree-items");
    if (!node) return;
    const all = members();
    selected = new Set(
      [...selected].filter((id) => all.some((t) => t.id === id)),
    );
    let visible = all.filter(matches);
    if (group === "manual") {
      const included = new Set(visible.map((t) => t.id));
      for (const t of visible) {
        let p = t.parent,
          seen = new Set();
        while (p && !seen.has(p)) {
          seen.add(p);
          if (all.some((t) => t.id === p)) included.add(p);
          p = item(p)?.parent;
        }
      }
      visible = all.filter((t) => included.has(t.id));
      node.innerHTML = visible
        .map((t) => {
          let level = 0,
            p = t.parent,
            seen = new Set();
          while (p && p !== rootId && !seen.has(p)) {
            seen.add(p);
            level++;
            p = item(p)?.parent;
          }
          return row(t, t.id === rootId ? 0 : level + 1);
        })
        .join("");
    } else {
      const groups = new Map();
      for (const t of visible) {
        const key = groupTitle(t),
          rows = groups.get(key) || [];
        rows.push(t);
        groups.set(key, rows);
      }
      node.innerHTML = [...groups]
        .map(
          ([name, rows]) =>
            `<section class="card-tree-group"><header><label><input type="checkbox" data-tree-group="${E(name)}" ${rows.every((t) => selected.has(t.id)) ? "checked" : ""}>${E(name)} <small>${rows.length}</small></label></header>${rows.map((t) => row(t, 0)).join("")}</section>`,
        )
        .join("");
    }
    if (!visible.length)
      node.innerHTML =
        '<p class="activity-empty">По этим условиям пунктов нет.</p>';
    for (const e of node.querySelectorAll('[data-partial="true"]'))
      e.indeterminate = true;
    $("#card-selection-count").textContent = "Выбрано: " + selected.size;
    $("#card-print-selected").disabled = !selected.size;
  }
  function attach(data) {
    const root = findRoot(data);
    if (rootId !== root) {
      rootId = root;
      selected.clear();
      group = "manual";
      search = "";
      who = "";
    }
    const drawer = $("#drawer-root .drawer"),
      form = $("#task-form");
    drawer.classList.add("wide-card");
    const grid = document.createElement("div");
    grid.className = "card-layout";
    const nav = document.createElement("aside");
    nav.className = "card-navigation";
    nav.setAttribute("aria-label", "Дерево карточек");
    nav.innerHTML = `<div class="card-nav-heading"><strong>${E(item(rootId)?.title || data.title || "Новая запись")}</strong><button type="button" class="textbtn" data-tree="size">Свернуть дерево</button></div><input id="card-tree-search" aria-label="Поиск в дереве карточки" placeholder="Найти вопрос или подзадачу…" value="${E(search)}"><div class="card-nav-options"><label>Группировать<select id="card-tree-group"><option value="manual">По иерархии / вручную</option><option value="topics">По темам</option><option value="counterparty">По контрагентам</option><option value="executor">По исполнителям</option><option value="responsible">По ответственным</option></select></label><label>Участник<select id="card-tree-person">${ctx.options(model().contacts, who, "Все участники")}</select></label></div><div class="tree-selection-tools"><button type="button" class="textbtn" data-tree="select-visible">Выбрать найденное</button><button type="button" class="textbtn" data-tree="select-none">Снять всё</button></div><div id="card-tree-items"></div><div class="card-tree-footer"><span id="card-selection-count"></span><button id="card-print-selected" type="button" class="btn primary" data-tree="print-selected">Вывести выбранное</button></div>`;
    form.before(grid);
    grid.append(nav, form);
    $("#card-tree-group").value = group;
    render();
    const title = $("#drawer-root .drawer-head h2");
    if (data.kind === "reference")
      title.insertAdjacentHTML(
        "afterend",
        '<p class="card-context-caption">Пункт повестки · ' +
          E(item(data.activityId)?.title || "Мероприятие") +
          "</p>",
      );
  }
  async function navigate(id) {
    await ctx.navigate(id);
  }
  async function createFrom(id, kind) {
    if (ui().drawer?.data.id !== id) {
      await navigate(id);
      if (ui().drawer?.data.id !== id) return;
    }
    await ctx.addFromCard(kind);
  }
  async function reorder(id, direction) {
    try {
      const t = item(id);
      await ctx.mutate("moveItem", { id, revision: t.revision, direction });
      if (ui().drawer?.id) {
        const current = item(ui().drawer.id);
        if (current) {
          ui().drawer.data.revision = current.revision;
          const base = JSON.parse(ui().drawer.baseline);
          base.revision = current.revision;
          ui().drawer.baseline = JSON.stringify(base);
        }
      }
      render();
      ctx.renderChildren();
    } catch (e) {
      ctx.toast(e.message);
    }
  }
  function move(id) {
    const t = item(id),
      agenda = !["task", "event"].includes(t.kind),
      blocked = new Set(branch(id));
    const options = () =>
      model().tasks.filter(
        (p) =>
          !blocked.has(p.id) &&
          (t.kind === "task"
            ? p.kind === "task" &&
              p.project === ($("#move-project")?.value || t.project)
            : t.kind === "event"
              ? p.kind === "event"
              : p.activityId === ($("#move-event")?.value || t.activityId) &&
                !["task", "event"].includes(p.kind)),
      );
    ctx.modal(
      "Переместить: " + t.title,
      `${
        t.kind === "task"
          ? `<div class="field"><label for="move-project">Тема</label><select id="move-project">${ctx.options(model().projects, t.project, "Без темы")}</select></div>`
          : agenda
            ? `<div class="field"><label for="move-event">Мероприятие</label><select id="move-event">${ctx.options(
                model()
                  .tasks.filter((x) => x.kind === "event")
                  .map((x) => ({ id: x.id, name: x.title })),
                t.activityId,
              )}</select></div>`
            : ""
      }<div class="field"><label for="move-parent">Родитель</label><select id="move-parent">${ctx.options(
        options().map((p) => ({ id: p.id, name: p.title })),
        t.sourceParent,
        "В корень",
      )}</select></div><div id="move-error"></div>`,
      `<button class="btn" data-action="close-modal">Отмена</button><button class="btn primary" data-tree="move-apply" data-id="${E(id)}">Переместить</button>`,
    );
    ui().moveContext = { id, revision: t.revision };
  }
  async function applyMove(id, button) {
    ctx.busy(button, true);
    try {
      const t = item(id),
        data = {
          ...t,
          revision: ui().moveContext.revision,
          parent: $("#move-parent").value || null,
          project: $("#move-project")?.value || t.project,
          activityId: $("#move-event")?.value || t.activityId,
          topics: t.manualTopics || [],
          comments: [],
        };
      await ctx.mutate("saveTask", data);
      ctx.closeModal();
      if (ui().drawer?.data.id === id) {
        ctx.closeDrawer(true);
        ctx.openCard(id);
      } else {
        render();
        ctx.renderChildren();
      }
      ctx.render();
      ctx.toast("Запись перемещена");
    } catch (error) {
      ctx.errorIn("#move-error", error);
    } finally {
      ctx.busy(button, false);
    }
  }
  async function output(ids) {
    if (ctx.dirty()) {
      const current = ui().drawer.data.id;
      if (!(await ctx.saveTask($("#task-form")))) return;
      ctx.openCard(current);
    }
    ctx.printSelection(rootId, ids, group, groupTitle);
  }
  document.addEventListener(
    "toggle",
    (event) => {
      const menu = event.target;
      if (!menu.matches?.(".node-menu") || !menu.open) return;
      for (const other of $$(".node-menu[open]"))
        if (other !== menu) other.open = false;
      const rect = menu.querySelector("summary").getBoundingClientRect(),
        panel = menu.querySelector("div");
      panel.style.left =
        Math.max(8, Math.min(rect.right - 240, innerWidth - 248)) + "px";
      panel.style.top =
        Math.max(
          8,
          Math.min(rect.bottom + 4, innerHeight - panel.offsetHeight - 8),
        ) + "px";
    },
    true,
  );
  document.addEventListener("input", (e) => {
    if (e.target.id === "card-tree-search") {
      search = e.target.value;
      render();
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "card-tree-group") {
      group = t.value;
      render();
    }
    if (t.id === "card-tree-person") {
      who = t.value;
      render();
    }
    if (t.dataset.treeChoice) {
      for (const id of branch(t.dataset.treeChoice))
        t.checked ? selected.add(id) : selected.delete(id);
      render();
    }
    if (t.dataset.treeGroup) {
      for (const row of members()
        .filter(matches)
        .filter((x) => groupTitle(x) === t.dataset.treeGroup))
        t.checked ? selected.add(row.id) : selected.delete(row.id);
      render();
    }
    if (["move-project", "move-event"].includes(t.id)) {
      const record = item(ui().moveContext.id),
        blocked = new Set(branch(record.id));
      $("#move-parent").innerHTML = ctx.options(
        model()
          .tasks.filter(
            (p) =>
              !blocked.has(p.id) &&
              (record.kind === "task"
                ? p.kind === "task" &&
                  p.project === ($("#move-project")?.value || "")
                : p.activityId ===
                    ($("#move-event")?.value || record.activityId) &&
                  !["task", "event"].includes(p.kind)),
          )
          .map((x) => ({ id: x.id, name: x.title })),
        "",
        "В корень",
      );
    }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tree]");
    if (!b) {
      if (!e.target.closest(".node-menu"))
        for (const menu of $$(".node-menu[open]")) menu.open = false;
      return;
    }
    for (const menu of $$(".node-menu[open]")) menu.open = false;
    const a = b.dataset.tree,
      id = b.dataset.id;
    if (a === "open" || a === "working") void navigate(id);
    if (a === "child") void createFrom(id, b.dataset.kind);
    if (a === "up" || a === "down") void reorder(id, a === "up" ? -1 : 1);
    if (a === "size") {
      $("#drawer-root .drawer").classList.toggle("hide-tree");
      b.textContent = $("#drawer-root .drawer").classList.contains("hide-tree")
        ? "Показать дерево"
        : "Свернуть дерево";
    }
    if (a === "move") move(id);
    if (a === "move-apply") void applyMove(id, b);
    if (a === "select-none") {
      selected.clear();
      render();
    }
    if (a === "select-visible") {
      for (const t of members().filter(matches)) selected.add(t.id);
      render();
    }
    if (a === "print-selected") void output([...selected]);
    if (a === "print-one") void output([id]);
    if (a === "print-branch") void output(branch(id));
  });
  return {
    attach,
    render,
    actionMenu,
    groupTitle,
    selected: () => [...selected],
  };
};
