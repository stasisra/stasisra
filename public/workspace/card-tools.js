/* Editors, references and contact cards shared by all workspace contexts. */
window.createCardTools = function (ctx) {
  "use strict";
  const $ = (s) => document.querySelector(s),
    $$ = (s) => [...document.querySelectorAll(s)],
    E = ctx.E,
    M = window.WorkspaceMentions;
  const model = ctx.model,
    ui = ctx.ui,
    item = (id) => model().tasks.find((t) => t.id === id),
    person = (id) => model().contacts.find((c) => c.id === id),
    topic = (id) => model().projects.find((p) => p.id === id);
  let picker = null,
    fullField = null,
    promptOpen = false,
    decision = null,
    decisionResolve = null;
  const acknowledged = new Map();
  const modalFrames = [];
  function holdModal() {
    if (fullField) expand();
    const root = $("#modal-root");
    if (!root.querySelector("#directory-description,#contact-company")) return;
    const nodes = [...root.childNodes];
    modalFrames.push({
      nodes,
      context: { ...ctx.directoryContext() },
      manager: ui().manager,
    });
    for (const node of nodes) node.remove();
  }
  function restoreModal() {
    if (!modalFrames.length) return false;
    const frame = modalFrames.pop(),
      root = $("#modal-root");
    root.replaceChildren(...frame.nodes);
    ctx.restoreDirectoryContext(frame.context);
    ui().manager = frame.manager;
    return true;
  }
  const fields = [
    ["company", "Компания"],
    ["position", "Должность"],
    ["phones", "Телефоны"],
    ["emails", "Email"],
    ["addresses", "Адреса"],
    ["website", "Сайт / ссылки"],
    ["notes", "Примечания"],
  ];
  function currentTopics() {
    if ($("#modal-root #directory-description")) {
      const d = ctx.directoryContext();
      return d?.id
        ? [d.id]
        : ui().projects?.filter((id) => id !== "none") || [];
    }
    const d = ui().drawer?.data;
    if (!d) return ui().projects?.filter((id) => id !== "none") || [];
    if (d.kind === "task")
      return [$("#task-project")?.value || d.project].filter(Boolean);
    const event = d.kind === "event" ? d : item(d.activityId);
    return [
      ...new Set([
        ...(event?.topics || []),
        ...$$('#task-form input[name="topics"]:checked').map((n) => n.value),
      ]),
    ];
  }
  function richValue(editor) {
    return M.serialize(editor);
  }
  function syncEditor(editor) {
    const hidden = $('[data-rich-for="' + editor.id + '"]');
    if (hidden) hidden.value = richValue(editor);
  }
  function setEditor(editor, raw) {
    if (editor?.hasAttribute("data-rich-editor")) {
      editor.innerHTML = M.html(raw, E);
      syncEditor(editor);
    } else if (editor) {
      editor.value = raw;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  function editorRaw(editor) {
    return editor?.hasAttribute("data-rich-editor")
      ? richValue(editor)
      : editor?.value || "";
  }
  function attachEditors(container = document) {
    for (const textarea of [...container.querySelectorAll("textarea")]) {
      if (
        textarea.dataset.editorReady ||
        textarea.hidden ||
        textarea.classList.contains("note-text")
      )
        continue;
      textarea.dataset.editorReady = "1";
      const field = textarea.closest(".field");
      if (!field) continue;
      field.classList.add("large-description");
      const toolbar = document.createElement("div");
      toolbar.className = "editor-toolbar";
      toolbar.innerHTML =
        '<span>@ — выбрать связанную запись</span><button type="button" class="textbtn" data-card="expand-editor">Развернуть редактор</button>';
      field.insertBefore(toolbar, textarea);
      if (
        ["task-description", "directory-description", "item-outcome"].includes(
          textarea.id,
        )
      ) {
        const id = textarea.id,
          editor = document.createElement("div");
        editor.id = id;
        editor.className = "rich-description";
        editor.contentEditable = "true";
        editor.dataset.richEditor = "1";
        editor.setAttribute("role", "textbox");
        editor.setAttribute("aria-multiline", "true");
        editor.setAttribute(
          "aria-label",
          textarea.closest(".field").querySelector("label")?.textContent ||
            "Описание",
        );
        editor.innerHTML = M.html(textarea.value, E);
        textarea.id = id + "-source";
        textarea.dataset.richFor = id;
        textarea.hidden = true;
        textarea.before(editor);
      } else textarea.rows = 10;
    }
  }
  function expand(field) {
    if (fullField) {
      fullField.classList.remove("editor-full");
      fullField.querySelector('[data-card="expand-editor"]').textContent =
        "Развернуть редактор";
      $("#editor-shade")?.remove();
      fullField = null;
      return;
    }
    fullField = field;
    field.classList.add("editor-full");
    field.querySelector('[data-card="expand-editor"]').textContent =
      "Вернуться в карточку";
    const shade = document.createElement("div");
    shade.id = "editor-shade";
    field.parentElement.append(shade);
    field.querySelector("[data-rich-editor],textarea:not([hidden])")?.focus();
  }
  function profileView(id) {
    if (fullField) expand();
    const c = person(id);
    if (!c) return ctx.toast("Контакт удалён");
    holdModal();
    const related = model().tasks.filter(
      (t) =>
        t.counterparties.includes(id) ||
        t.executors.includes(id) ||
        t.responsible === id,
    );
    ctx.modal(
      c.name,
      `<p>${E(c.type)}${c.company ? " · " + E(c.company) : ""}</p><dl class="contact-profile">${
        fields
          .filter(([key]) => c[key])
          .map(
            ([key, label]) => `<dt>${label}</dt><dd>${M.html(c[key], E)}</dd>`,
          )
          .join("") || "<p>Контактные данные пока не заполнены.</p>"
      }</dl><h3>Темы</h3><div class="tag-chips">${(c.topics || []).map((p) => `<span class="tag-chip">${E(topic(p)?.name || "Тема удалена")}</span>`).join("") || "Темы пока не назначены"}</div><h3>Задачи и мероприятия</h3><div class="profile-related">${related.map((t) => `<button type="button" class="textbtn" data-card="profile-open-item" data-id="${E(t.id)}">${E(t.title)}</button>`).join("") || "Назначений пока нет"}</div>`,
      `<button class="btn" data-action="close-modal">Закрыть</button><button class="btn primary" data-card="profile-edit" data-id="${E(id)}">Редактировать</button>`,
    );
  }
  function profileEdit(c, mode) {
    ctx.modal(
      c ? "Контакт: " + c.name : "Новый контакт",
      `<div class="field"><label for="directory-name">Имя / название</label><input id="directory-name" maxlength="200" value="${E(c?.name || "")}"></div><div class="twocol"><div class="field"><label for="contact-type">Тип</label><select id="contact-type">${["Человек", "Организация", "Группа"].map((type) => `<option ${c?.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></div><label class="contact-role"><input type="checkbox" id="contact-responsible" ${c?.responsible || mode === "responsibles" ? "checked" : ""}>Доступен в ответственных</label></div><div class="profile-fields">${fields.map(([key, label]) => `<div class="field"><label for="contact-${key}">${label}</label>${["phones", "emails", "addresses", "notes"].includes(key) ? `<textarea id="contact-${key}" rows="${key === "notes" ? 5 : 2}">${E(c?.[key] || "")}</textarea>` : `<input id="contact-${key}" value="${E(c?.[key] || "")}">`}</div>`).join("")}</div><div class="field"><span class="field-label">Связанные темы — можно выбрать несколько</span><div class="multi">${
        model()
          .projects.filter(
            (p) => !p.archived || c?.manualTopics?.includes(p.id),
          )
          .map(
            (p) =>
              `<label><input type="checkbox" name="contact-topics" value="${E(p.id)}" ${(c?.manualTopics || (c ? [] : currentTopics())).includes(p.id) ? "checked" : ""}>${E(p.name)}</label>`,
          )
          .join("") || "<p>Сначала добавьте тему</p>"
      }</div></div><p class="muted">Темы существующих назначений также учитываются в поиске контактов.</p><div id="directory-error"></div>`,
      `<button class="btn" data-card="profile-edit-cancel">Отмена</button><button class="btn primary" data-action="directory-save">Сохранить</button>`,
    );
    $("#directory-name")?.focus();
  }
  function profileData() {
    const result = {};
    for (const [key] of fields) {
      const field = $("#contact-" + key);
      if (field) result[key] = field.value;
    }
    if ($("#contact-company"))
      result.topics = $$('input[name="contact-topics"]:checked').map(
        (n) => n.value,
      );
    return result;
  }
  function decorateDirectory() {
    if (
      !$("#directory-list") ||
      !["contacts", "responsibles"].includes(ui().manager)
    )
      return;
    if (!$("#contact-directory-search"))
      $("#directory-list").before(
        Object.assign(document.createElement("div"), {
          className: "directory-contact-filters",
          innerHTML: `<input id="contact-directory-search" placeholder="Имя, компания, телефон, email" aria-label="Поиск контактов"><select id="contact-directory-topic" aria-label="Тема контактов">${ctx.options(model().projects, "", "Все темы")}</select>`,
        }),
      );
    filterDirectory();
  }
  function filterDirectory() {
    const text = (
        $("#contact-directory-search")?.value || ""
      ).toLocaleLowerCase("ru"),
      p = $("#contact-directory-topic")?.value;
    for (const row of $$("#directory-list .dir-row")) {
      const id = row.querySelector('[data-action="directory-edit"]')?.dataset
          .id,
        c = person(id);
      if (c)
        row.hidden = !!(
          (p && !c.topics?.includes(p)) ||
          !`${c.name} ${fields.map(([k]) => c[k] || "").join(" ")}`
            .toLocaleLowerCase("ru")
            .includes(text)
        );
    }
  }
  function closePicker() {
    $("#mention-picker")?.remove();
    picker = null;
  }
  function showPicker(editor) {
    const rich = editor.hasAttribute("data-rich-editor");
    let query, start, range;
    if (rich) {
      const selection = getSelection();
      if (!selection?.rangeCount || !editor.contains(selection.anchorNode))
        return closePicker();
      range = selection.getRangeAt(0).cloneRange();
      if (range.startContainer.nodeType !== 3) return closePicker();
      const before = range.startContainer.textContent.slice(
          0,
          range.startOffset,
        ),
        m = before.match(/(?:^|\s)@([^@\r\n]{0,100})$/);
      if (!m) return closePicker();
      query = m[1];
      start = range.startOffset - query.length - 1;
    } else {
      const before = editor.value.slice(0, editor.selectionStart),
        m = before.match(/(?:^|\s)@([^@\r\n]{0,100})$/);
      if (!m) return closePicker();
      query = m[1];
      start = editor.selectionStart - query.length - 1;
    }
    const all = picker?.editor === editor && picker.all;
    picker = { editor, query, start, range, all, index: 0 };
    renderPicker();
  }
  function candidates() {
    const topics = currentTopics(),
      word = picker.query.toLocaleLowerCase("ru"),
      d = $("#modal-root #directory-description") ? null : ui().drawer?.data,
      event = d?.kind === "event" ? d : item(d?.activityId),
      people = new Set(event?.participants || []);
    const result = [];
    for (const c of model().contacts)
      if (
        !c.archived &&
        (picker.all ||
          !topics.length ||
          c.topics?.some((p) => topics.includes(p)) ||
          people.has(c.id)) &&
        `${c.name} ${c.company} ${c.phones} ${c.emails}`
          .toLocaleLowerCase("ru")
          .includes(word)
      )
        result.push({
          kind: "contact",
          id: c.id,
          label: c.name,
          detail: c.company || c.type,
        });
    for (const t of model().tasks)
      if (
        ["task", "event"].includes(t.kind) &&
        t.id !== d?.id &&
        (picker.all ||
          !topics.length ||
          (t.kind === "event" ? t.topics : [t.project]).some((p) =>
            topics.includes(p),
          )) &&
        M.plain(t.title).toLocaleLowerCase("ru").includes(word)
      )
        result.push({
          kind: "item",
          id: t.id,
          label: t.title,
          detail:
            t.kind === "event"
              ? "Мероприятие"
              : topic(t.project)?.name || "Задача",
        });
    return result.slice(0, 30);
  }
  function renderPicker() {
    if (!picker) return;
    $("#mention-picker")?.remove();
    const panel = document.createElement("div");
    panel.id = "mention-picker";
    panel.setAttribute("role", "listbox");
    picker.results = candidates();
    panel.innerHTML = `<div class="mention-picker-head"><span>${picker.all ? "Все записи" : "По текущим темам"}</span><button type="button" class="textbtn" data-card="mention-all">${picker.all ? "По темам" : "Все записи"}</button><button type="button" class="textbtn" data-card="mention-new">＋ Контакт</button></div>${picker.results.map((c, i) => `<button type="button" role="option" aria-selected="${i === picker.index}" class="mention-option ${i === picker.index ? "selected" : ""}" data-card="mention-choose" data-index="${i}"><strong>${E(c.label)}</strong><small>${E(c.detail)}</small></button>`).join("") || "<p>Совпадений нет. Можно выбрать все записи или добавить контакт.</p>"}`;
    document.body.append(panel);
    const r = picker.editor.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(r.left, innerWidth - 360)) + "px";
    panel.style.top =
      Math.max(
        8,
        Math.min(r.bottom + 4, innerHeight - panel.offsetHeight - 12),
      ) + "px";
  }
  function chooseMention(index) {
    const p = picker,
      c = p?.results[index];
    if (!c) return;
    const raw = M.token(c.kind, c.id, c.label);
    if (p.range) {
      const range = p.range;
      range.setStart(range.startContainer, p.start);
      range.deleteContents();
      const holder = document.createElement("span");
      holder.innerHTML = M.html(raw, E);
      const link = holder.firstChild;
      range.insertNode(link);
      const space = document.createTextNode(" ");
      link.after(space);
      range.setStart(space, 1);
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      syncEditor(p.editor);
    } else {
      p.editor.setRangeText(
        "@" + c.label,
        p.start,
        p.editor.selectionStart,
        "end",
      );
      p.editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    closePicker();
    p.editor.focus();
  }
  function contactBlocks(ids, selectedFields, replace = false) {
    const editor = $("#task-description");
    if (!editor) return;
    let raw = editorRaw(editor);
    for (const id of ids) {
      const c = person(id);
      if (!c) continue;
      const block = new RegExp(":::contact " + id + "\\n[\\s\\S]*?\\n:::", "g");
      if (block.test(raw) && !replace) continue;
      const lines = selectedFields
        .filter((key) => c[key])
        .map(
          (key) =>
            (fields.find((f) => f[0] === key)?.[1] || key) + ": " + c[key],
        );
      if (!lines.length) continue;
      const data =
        ":::contact " +
        id +
        "\nКонтактные данные: " +
        M.token("contact", id, c.name) +
        "\n" +
        lines.join("\n") +
        "\n:::";
      if (replace && raw.match(block)) raw = raw.replace(block, data);
      else raw += (raw ? "\n\n" : "") + data;
    }
    setEditor(editor, raw);
  }
  function askContactData(ids, replace = false) {
    ids = [...new Set(ids)].filter((id) => {
      const c = person(id);
      return c && fields.some(([k]) => c[k]);
    });
    if (!ids.length) return;
    promptOpen = true;
    ctx.modal(
      "Добавить контактные данные в описание?",
      `<p>${ids.map((id) => E(person(id).name)).join(", ")}</p><div class="contact-insert-fields">${fields.map(([key, label]) => `<label><input type="checkbox" data-contact-insert-field="${key}" ${["phones", "emails"].includes(key) ? "checked" : ""}>${label}</label>`).join("")}</div><p class="muted">В описание добавится отдельный блок. Сохраняется копия данных на этот момент.</p>`,
      `<button class="btn" data-card="contact-insert-skip">Только связать</button><button class="btn primary" data-card="contact-insert-apply" data-ids="${E(ids.join(","))}" data-replace="${replace}">Добавить данные</button>`,
    );
  }
  function beforeSaveContacts() {
    const d = ui().drawer;
    if (!d) return Promise.resolve(true);
    if (decision) return decision;
    const original = model().tasks.find((t) => t.id === d.id),
      old = new Set(
        [
          ...(original?.counterparties || []),
          ...(original?.executors || []),
          original?.responsible,
        ].filter(Boolean),
      );
    const selected = [
      ...new Set(
        [
          ...$$(
            '#task-form input[name="counterparties"]:checked,#task-form input[name="executors"]:checked',
          ).map((n) => n.value),
          $("#task-responsible")?.value,
        ].filter(Boolean),
      ),
    ];
    const known = acknowledged.get(d.data.id) || new Set();
    const ids = selected.filter(
      (id) =>
        !old.has(id) &&
        !known.has(id) &&
        !editorRaw($("#task-description")).includes(
          ":::contact " + id + "\n",
        ) &&
        fields.some(([key]) => person(id)?.[key]),
    );
    if (!ids.length) return Promise.resolve(true);
    decision = new Promise(
      (resolve) =>
        (decisionResolve = (value) => {
          if (value) {
            ids.forEach((id) => known.add(id));
            acknowledged.set(d.data.id, known);
          }
          decision = null;
          decisionResolve = null;
          resolve(value);
        }),
    );
    askContactData(ids);
    return decision;
  }
  function filterPeople() {
    const all = $("#people-all")?.checked,
      text = ($("#people-search")?.value || "").toLocaleLowerCase("ru"),
      topics = currentTopics();
    for (const label of $$(
      "#counterparties-choices label,#executors-choices label",
    )) {
      const input = label.querySelector("input"),
        c = person(input.value);
      label.hidden =
        !input.checked &&
        ((!all &&
          topics.length &&
          !c?.topics?.some((p) => topics.includes(p))) ||
          !`${c?.name} ${c?.company} ${c?.phones} ${c?.emails}`
            .toLocaleLowerCase("ru")
            .includes(text));
    }
  }
  function attachCard() {
    attachEditors($("#drawer-root"));
    const box = $("#counterparties-choices");
    if (box && !$("#people-search"))
      box.closest(".field").before(
        Object.assign(document.createElement("div"), {
          className: "people-picker-tools",
          innerHTML:
            '<label>Найти контакт<input id="people-search" placeholder="Имя, компания, телефон"></label><label><input id="people-all" type="checkbox" checked>Все контакты</label><button type="button" class="textbtn" data-card="insert-people">Вставить / обновить контактные данные</button>',
        }),
      );
    const topics = currentTopics();
    if (
      $("#people-all") &&
      topics.length &&
      model().contacts.some((c) => c.topics?.some((p) => topics.includes(p)))
    )
      $("#people-all").checked = false;
    filterPeople();
  }
  document.addEventListener("input", (event) => {
    const e = event.target;
    if (e.hasAttribute?.("data-rich-editor")) {
      syncEditor(e);
      showPicker(e);
    }
    if (e.id === "people-search") filterPeople();
    if (e.id === "contact-directory-search") filterDirectory();
    if (e.matches?.(".large-description textarea:not([hidden])")) {
      e.style.height = "auto";
      e.style.height = Math.min(600, Math.max(240, e.scrollHeight)) + "px";
    }
  });
  document.addEventListener("paste", (event) => {
    const editor = event.target.closest?.("[data-rich-editor]");
    if (editor) {
      event.preventDefault();
      document.execCommand(
        "insertText",
        false,
        event.clipboardData.getData("text/plain"),
      );
      syncEditor(editor);
    }
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (picker && event.target === picker.editor) {
        if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.key === "Escape") closePicker();
          else if (event.key === "Enter") chooseMention(picker.index);
          else {
            picker.index =
              (picker.index +
                (event.key === "ArrowDown" ? 1 : -1) +
                Math.max(1, picker.results.length)) %
              Math.max(1, picker.results.length);
            renderPicker();
          }
          return;
        }
      }
      if (event.key === "Escape" && promptOpen) {
        promptOpen = false;
        decisionResolve?.(false);
      }
      if (event.key === "Escape" && fullField) {
        event.preventDefault();
        event.stopImmediatePropagation();
        expand();
      }
      if (
        (event.key === "Enter" || event.key === " ") &&
        event.target.matches?.(".mention-link")
      ) {
        event.preventDefault();
        event.target.click();
      }
    },
    true,
  );
  document.addEventListener("mousedown", (event) => {
    if (event.target.closest("#mention-picker")) event.preventDefault();
  });
  document.addEventListener("click", (event) => {
    const mention = event.target.closest(".mention-link");
    if (mention) {
      if (mention.dataset.mentionKind === "contact")
        profileView(mention.dataset.mentionId);
      else if (mention.dataset.mentionKind === "item") {
        if ($("#modal-root #directory-description"))
          window.open(
            "/tasks?task=" + encodeURIComponent(mention.dataset.mentionId),
            "_blank",
            "noopener",
          );
        else ctx.navigate(mention.dataset.mentionId);
      } else ctx.editTopic(mention.dataset.mentionId);
      return;
    }
    const b = event.target.closest("[data-card]");
    if (event.target.closest('[data-action="close-modal"]') && promptOpen) {
      promptOpen = false;
      decisionResolve?.(false);
    }
    if (!b) {
      if (!event.target.closest("[data-rich-editor],.note-text")) closePicker();
      return;
    }
    const action = b.dataset.card,
      id = b.dataset.id;
    if (action === "expand-editor") expand(b.closest(".field"));
    if (action === "profile-edit-cancel") {
      if (!restoreModal()) ctx.manage(ui().manager);
    }
    if (action === "profile-view") profileView(id);
    if (action === "profile-edit") ctx.editContact(id);
    if (action === "profile-open-item") {
      const preserve = modalFrames.length > 0;
      ctx.closeModal();
      if (preserve)
        window.open(
          "/tasks?task=" + encodeURIComponent(id),
          "_blank",
          "noopener",
        );
      else void ctx.navigate(id);
    }
    if (action === "mention-all") {
      picker.all = !picker.all;
      picker.index = 0;
      renderPicker();
    }
    if (action === "mention-choose") chooseMention(Number(b.dataset.index));
    if (action === "mention-new") {
      closePicker();
      ctx.editContact();
    }
    if (action === "insert-people") {
      askContactData(
        [
          ...$$(
            '#task-form input[name="counterparties"]:checked,#task-form input[name="executors"]:checked',
          ).map((n) => n.value),
          $("#task-responsible")?.value,
        ].filter(Boolean),
        true,
      );
    }
    if (action === "contact-insert-skip") {
      promptOpen = false;
      ctx.closeModal();
      decisionResolve?.(true);
    }
    if (action === "contact-insert-apply") {
      contactBlocks(
        b.dataset.ids.split(","),
        $$("[data-contact-insert-field]:checked").map(
          (n) => n.dataset.contactInsertField,
        ),
        b.dataset.replace === "true",
      );
      promptOpen = false;
      ctx.closeModal();
      decisionResolve?.(true);
    }
  });
  document.addEventListener("change", (event) => {
    const e = event.target;
    if (["task-project", "people-all"].includes(e.id) || e.name === "topics")
      filterPeople();
    if (e.id === "contact-directory-topic") filterDirectory();
  });
  return {
    attachCard,
    attachEditors,
    profileEdit,
    profileView,
    profileData,
    decorateDirectory,
    setEditor,
    editorRaw,
    expand,
    askContactData,
    beforeSaveContacts,
    holdModal,
    restoreModal,
    filterPeople,
  };
};
