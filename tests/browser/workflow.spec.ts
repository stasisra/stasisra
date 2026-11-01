import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { createRequire } from "node:module";
const JSZip = createRequire(process.cwd() + "/package.json")("jszip");
const email = "browser-admin@example.test",
  password = "synthetic-browser-password";
async function login(page: Page, next = "/tasks") {
  await page.goto("/login?next=" + encodeURIComponent(next));
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/(tasks|dashboard)/);
  await expect(page.locator("#sync-status")).toContainText(
    /Данные (загружены|обновлены)/,
  );
}
async function snapshot(api: APIRequestContext) {
  const r = await api.get("/api/next");
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
async function action(
  api: APIRequestContext,
  action: string,
  data: Record<string, unknown>,
) {
  const r = await api.post("/api/next", { data: { action, data } });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
async function create(
  api: APIRequestContext,
  extra: Record<string, unknown> = {},
) {
  const id = randomUUID();
  await action(api, "createTask", {
    id,
    title: "Проверка " + id,
    description: "Подробное описание",
    project: "",
    parent: null,
    executors: [],
    responsible: "",
    start: "2026-11-01",
    end: "2026-11-10",
    percent: 0,
    status: "PLANNED",
    kind: "task",
    ...extra,
  });
  return id;
}
async function current(api: APIRequestContext, id: string) {
  return (await snapshot(api)).tasks.find((t: any) => t.id === id);
}
async function open(page: Page, id: string) {
  await page.goto("/tasks?task=" + id);
  await expect(page.locator("#task-title")).toBeVisible();
}
async function closeCard(page: Page) {
  await page
    .getByRole("button", { name: "Закрыть карточку", exact: true })
    .click();
  await expect(page.locator("#task-form")).toHaveCount(0);
}

test("login, closed registration, CSRF and safe snapshot", async ({ page }) => {
  expect((await page.request.get("/api/next")).status()).toBe(401);
  await login(page, "javascript:window.__auditInjected=1");
  expect(await page.evaluate(() => "__auditInjected" in window)).toBe(false);
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Other",
          email: "other@example.test",
          password: "password",
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/next", {
        headers: { Origin: "https://untrusted.example" },
        data: { action: "deleteTask", data: { id: "any", revision: 0 } },
      })
    ).status(),
  ).toBe(403);
  const data = await snapshot(page.request);
  expect(JSON.stringify(data)).not.toContain("passwordHash");
  expect(
    data.contacts
      .filter((c: any) => c.responsible)
      .map((c: any) => c.name)
      .sort(),
  ).toEqual(
    ["Аркадий", "Меликантова", "Наташа архитектор", "Патрик", "Юрай"].sort(),
  );
  expect(
    data.contacts.some((c: any) => /козуб|Наташа дизайнер/i.test(c.name)),
  ).toBe(false);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("new task persists multiple people, draft questions and files; validation can be retried", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const before = await snapshot(page.request),
    sp = before.projects.find((p: any) => p.name === "SP"),
    names = ["Патрик", "Юрай"];
  await page.locator('.head-actions [data-action="create-task"]').click();
  const title = "Сохранение через интерфейс " + randomUUID();
  await page.locator("#task-title").fill(title);
  await page
    .locator("#task-description")
    .fill("Полное описание\nВторая строка, которую нужно напечатать.");
  await page.locator("#task-project").selectOption(sp.id);
  for (const name of names)
    await page
      .locator(
        '#task-form input[name="executors"][value="' +
          before.contacts.find((c: any) => c.name === name).id +
          '"]',
      )
      .check();
  await page
    .locator("#task-responsible")
    .selectOption(before.contacts.find((c: any) => c.name === "Патрик").id);
  await page.locator("#task-start").fill("2026-11-01");
  await page.locator("#task-end").fill("2026-11-10");
  await page.locator("#drawer-root .note-kind").selectOption("question");
  await page
    .locator("#comment-text")
    .fill("Вопрос к встрече — согласовать цену?");
  await page.locator("#comment-text").press("Enter");
  await expect(page.locator("#comment-list")).toContainText("согласовать цену");
  await page.locator('#drawer-root input[type="file"]').setInputFiles({
    name: "план.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Файл задачи"),
  });
  await expect(page.locator("#drawer-files")).toContainText("план.txt");
  await page.locator("#task-end").fill("2026-01-01");
  await page.locator('[form="task-form"]').click();
  await expect(page.locator("#task-error")).toContainText(
    "Дата окончания раньше даты начала",
  );
  await expect(page.locator('[form="task-form"]')).toBeEnabled();
  await page.locator("#task-end").fill("2026-11-10");
  await page.locator('[form="task-form"]').click();
  await expect(page.locator("#sync-status")).toContainText(
    /Сохранено|Файл сохранён/,
  );
  await expect(page.locator("#task-form")).toHaveCount(0);
  const saved = (await snapshot(page.request)).tasks.find(
    (t: any) => t.title === title,
  );
  expect(saved.executors).toHaveLength(2);
  expect(saved.comments).toHaveLength(1);
  expect(saved.attachments).toHaveLength(1);
  await open(page, saved.id);
  await expect(page.locator("#task-description")).toHaveValue(
    "Полное описание\nВторая строка, которую нужно напечатать.",
  );
  await page.locator('#drawer-files [data-action="preview-file"]').click();
  await expect(page.locator(".file-text")).toHaveText("Файл задачи");
  const downloaded = page.waitForEvent("download");
  await page.locator('#modal-root [data-action="download-file"]').click();
  const download = await downloaded;
  expect((await fs.readFile((await download.path())!)).toString()).toBe(
    "Файл задачи",
  );
  await page.locator('#modal-root [data-action="close-modal"]').first().click();
  await closeCard(page);
  await page
    .locator('[data-action="quick-note"][data-id="' + saved.id + '"]')
    .last()
    .click();
  const quick = page.locator(
    '.note-composer[data-scope="row"][data-task="' + saved.id + '"]',
  );
  await quick.locator("textarea").fill("Быстрый комментарий");
  await quick.locator("textarea").press("Enter");
  await expect(page.locator("#task-content")).toContainText(
    "Быстрый комментарий",
  );
  expect((await current(page.request, saved.id)).comments).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("two tabs cannot overwrite a newer edit and retain the rejected draft", async ({
  page,
  context,
}) => {
  await login(page);
  const id = await create(page.request, { title: "Конфликт вкладок" });
  await open(page, id);
  const other = await context.newPage();
  await open(other, id);
  await page.locator("#task-title").fill("Изменено первым окном");
  await page.locator('[form="task-form"]').click();
  await expect
    .poll(async () => (await current(page.request, id)).title)
    .toBe("Изменено первым окном");
  await other.locator("#task-title").fill("Мой черновик второго окна");
  await other.locator('[form="task-form"]').click();
  await expect(other.locator("#task-error")).toContainText(
    "изменена в другом окне",
  );
  await expect(other.locator("#task-title")).toHaveValue(
    "Мой черновик второго окна",
  );
  expect((await current(page.request, id)).title).toBe("Изменено первым окном");
  await other.locator('[data-action="reload-card"]').click();
  await other.locator('[data-action="confirm-reload-card"]').click();
  await expect(other.locator("#task-title")).toHaveValue(
    "Изменено первым окном",
  );
  await other.close();
});

test("projects, people and inclusive dates select the same rows for list, meeting, CSV, XLSX and PDF", async ({
  page,
}) => {
  await login(page);
  const data = await snapshot(page.request),
    sp = data.projects.find((p: any) => p.name === "SP"),
    web = data.projects.find((p: any) => p.name === "web"),
    patrick = data.contacts.find((c: any) => c.name === "Патрик"),
    juraj = data.contacts.find((c: any) => c.name === "Юрай");
  const root = await create(page.request, {
    title: "Встречи 1–10 ноября",
    project: sp.id,
    responsible: patrick.id,
    executors: [patrick.id],
    start: "2026-11-01",
    end: "2026-11-10",
  });
  const child = await create(page.request, {
    title: "Детали встречи " + randomUUID(),
    description: "Полное описание для печати\nВторая строка",
    parent: root,
    executors: [patrick.id],
    responsible: patrick.id,
    start: "2026-11-02",
    end: "2026-11-03",
  });
  await create(page.request, {
    title: "Другая тема того же человека",
    project: web.id,
    responsible: patrick.id,
    executors: [patrick.id],
    start: "2026-11-03",
    end: "2026-11-03",
  });
  await create(page.request, {
    title: "Не тот исполнитель",
    project: sp.id,
    responsible: juraj.id,
    executors: [juraj.id],
    start: "2026-11-03",
    end: "2026-11-03",
  });
  await action(page.request, "addNote", {
    id: randomUUID(),
    taskId: child,
    kind: "question",
    text: "Вопрос для листа",
  });
  await page.goto(
    "/tasks?projects=" +
      sp.id +
      "&executor=" +
      patrick.id +
      "&responsible=" +
      patrick.id +
      "&from=2026-11-03&to=2026-11-03&dateMode=deadline",
  );
  const title = (await current(page.request, child)).title;
  await expect(
    page.locator('#task-content [data-action="edit-task"]'),
  ).toHaveCount(1);
  await expect(page.locator("#task-content")).toContainText(title);
  await expect(page.locator("#task-content")).not.toContainText(
    "Не тот исполнитель",
  );
  await page.locator('.head-actions [data-action="meeting-open"]').click();
  await expect(page.locator("#meeting-pages")).toContainText(title);
  await expect(page.locator("#meeting-pages")).not.toContainText(
    "Полное описание для печати",
  );
  await page.locator('[data-sheet-setting="description"]').check();
  await expect(page.locator("#meeting-pages")).toContainText(
    "Полное описание для печати",
  );
  const csvEvent = page.waitForEvent("download");
  await page.locator('[data-action="output-csv"]').click();
  const csv = await fs.readFile((await (await csvEvent).path())!, "utf8");
  expect(csv).toContain(title);
  expect(csv).toContain("Полное описание для печати");
  expect(csv).not.toContain("Не тот исполнитель");
  const xlsxEvent = page.waitForEvent("download");
  await page.locator('[data-action="output-xlsx"]').click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await xlsxEvent).path())!);
  expect(wb.worksheets[0].rowCount).toBe(2);
  await page
    .locator('[data-action="output-format"][data-id="meeting"]')
    .click();
  await expect(page.locator("#meeting-pages")).toContainText(
    "Вопрос для листа",
  );
  await page
    .locator("#meeting-root summary")
    .filter({ hasText: "Содержимое листа" })
    .click();
  await page.locator('[data-sheet-setting="description"]').check();
  await expect(page.locator("#meeting-pages")).toContainText(
    "Полное описание для печати",
  );
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.locator('[data-action="meeting-print"]').click();
  await expect(page.locator("#print-output")).toContainText(title);
  await expect(page.locator("#print-output")).toContainText("Вторая строка");
  await page.screenshot({
    path: test.info().outputPath("meeting.png"),
    fullPage: true,
  });
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({
    format: "A4",
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.length).toBeGreaterThan(10000);
  await fs.writeFile(test.info().outputPath("meeting.pdf"), pdf);
  await page.emulateMedia({ media: "screen" });
  await page.locator('[data-action="meeting-close"]').click();
  // Topic selections use OR, person filters still use AND.
  await page.locator('#filters [aria-label="Выбрать темы"]').click();
  await page.locator('#filters [data-query-theme="' + web.id + '"]').check();
  await page.locator('#filters [data-action="query-themes-done"]').click();
  await page.locator('.query-buttons [data-action="query-apply"]').click();
  await expect(
    page.locator('#task-content [data-action="edit-task"]'),
  ).toHaveCount(2);
  await page.locator("#nav-deadlines").click();
  await expect(page.locator("#filter-date-mode")).toHaveValue("deadline");
  await expect(page.locator("#task-content")).toContainText(title);
});

test("local Word and Excel previews show persisted files without external requests", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const id = await create(page.request, { title: "Проверка Office" });
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Документ встречи — кириллица</w:t></w:r></w:p></w:body></w:document>',
  );
  const docx = await zip.generateAsync({ type: "nodebuffer" });
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Смета").addRows([
    ["Статья", "Сумма"],
    ["Проект", 1250],
  ]);
  wb.addWorksheet("Вопросы").addRows([["Что обсудить?"], ["Сроки"]]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  for (const [name, buffer, mime] of [
    [
      "встреча.docx",
      docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      "смета.xlsx",
      xlsx,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  ] as const) {
    const r = await page.request.post("/api/next/items/" + id + "/files", {
      multipart: {
        file: { name, buffer, mimeType: mime },
        uploadId: randomUUID(),
      },
    });
    expect(r.status(), await r.text()).toBe(201);
  }
  const external: string[] = [];
  page.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/))
      external.push(r.url());
  });
  await open(page, id);
  await page
    .locator('#drawer-files [data-action="preview-file"]')
    .filter({ hasText: "встреча.docx" })
    .click();
  await expect(page.locator("#office-body")).toContainText(
    "Документ встречи — кириллица",
  );
  await page.locator('#modal-root [data-action="close-modal"]').first().click();
  await page
    .locator('#drawer-files [data-action="preview-file"]')
    .filter({ hasText: "смета.xlsx" })
    .click();
  await expect(page.locator("#office-body")).toContainText("1250");
  await page.locator('[data-action="office-sheet"][data-id="1"]').click();
  await expect(page.locator("#office-body")).toContainText("Что обсудить?");
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("directory CRUD, hide, role assignment and replacement preserve a task", async ({
  page,
}) => {
  await login(page, "/tasks?manage=contacts");
  await page.locator('[data-action="directory-add"]').click();
  const name = "Контакт " + randomUUID();
  await page.locator("#directory-name").fill(name);
  await page.locator("#contact-responsible").check();
  await page.locator('[data-action="directory-save"]').click();
  await expect(page.locator("#directory-list")).toContainText(name);
  let data = await snapshot(page.request);
  const c = data.contacts.find((c: any) => c.name === name),
    replacement = data.contacts.find((c: any) => c.name === "Патрик");
  const id = await create(page.request, {
    title: "Задача заменяемого контакта",
    executors: [c.id],
    responsible: c.id,
  });
  await page
    .locator('[data-action="directory-hide"][data-id="' + c.id + '"]')
    .click();
  await expect(
    page
      .locator(
        '#directory-list [data-action="directory-edit"][data-id="' +
          c.id +
          '"]',
      )
      .first(),
  ).toHaveCount(0);
  await page.locator("#manager-archived").check();
  await page
    .locator('[data-action="directory-hide"][data-id="' + c.id + '"]')
    .click();
  await page
    .locator('[data-action="directory-delete"][data-id="' + c.id + '"]')
    .click();
  await page.locator("#replacement").selectOption(replacement.id);
  await page.locator('[data-action="confirm-directory-delete"]').click();
  await expect(page.locator("#directory-list")).not.toContainText(name);
  data = await snapshot(page.request);
  const kept = data.tasks.find((t: any) => t.id === id);
  expect(kept.executors).toEqual([replacement.id]);
  expect(kept.responsible).toBe(replacement.id);
});

test("event validation, legacy redirects and Gantt render the working workspace", async ({
  page,
}) => {
  await login(page);
  await page.locator('.head-actions [data-action="create-event"]').click();
  await page.locator("#task-title").fill("Мероприятие со временем");
  await page.locator("#task-start").fill("2026-11-05");
  await page.locator("#task-end").fill("2026-11-05");
  await page.locator("#event-start-time").fill("15:00");
  await page.locator("#event-end-time").fill("14:00");
  await page.locator('[form="task-form"]').click();
  await expect(page.locator("#task-error")).toContainText(
    "Время окончания раньше времени начала",
  );
  await page.locator("#event-end-time").fill("16:00");
  await page.locator("#event-location").fill("Офис");
  await page.locator("#task-timezone").selectOption("Europe/Bratislava");
  await page.locator('[form="task-form"]').click();
  await expect(page.locator("#task-form")).toHaveCount(0);
  const saved = (await snapshot(page.request)).tasks.find(
    (t: any) => t.title === "Мероприятие со временем",
  );
  expect(saved.startTime).toBe("15:00");
  expect(saved.timeZone).toBe("Europe/Bratislava");
  for (const url of [
    "/dashboard",
    "/dashboard/focus/print",
    "/settings/names",
    "/dashboard/dictionaries",
    "/gantt",
  ]) {
    const r = await page.goto(url);
    expect(r?.status(), url).toBe(200);
    await expect(page.locator("#sync-status")).toContainText(
      /Данные (загружены|обновлены)/,
    );
  }
  await expect(page.locator(".gantt-row")).not.toHaveCount(0);
});

test("a failed file upload retains the saved task and retries without duplicating it", async ({
  page,
}) => {
  await login(page);
  await page.locator('.head-actions [data-action="create-task"]').click();
  const title = "Повтор загрузки " + randomUUID();
  await page.locator("#task-title").fill(title);
  await page.locator('#drawer-root input[type="file"]').setInputFiles({
    name: "повтор.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Сохранить после сбоя"),
  });
  await expect(page.locator("#drawer-files")).toContainText("повтор.txt");
  let fail = true;
  await page.route("**/api/next/items/*/files", (route) => {
    if (fail && route.request().method() === "POST") {
      fail = false;
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Сбой загрузки для проверки" }),
      });
    }
    return route.continue();
  });
  await page.locator('[form="task-form"]').click();
  await expect(page.locator("#task-error")).toContainText(
    "Сбой загрузки для проверки",
  );
  await expect(page.locator("#task-title")).toHaveValue(title);
  let matches = (await snapshot(page.request)).tasks.filter(
    (t: any) => t.title === title,
  );
  expect(matches).toHaveLength(1);
  expect(matches[0].attachments).toHaveLength(0);
  await page.locator('[form="task-form"]').click();
  await expect(page.locator("#task-form")).toHaveCount(0);
  matches = (await snapshot(page.request)).tasks.filter(
    (t: any) => t.title === title,
  );
  expect(matches).toHaveLength(1);
  expect(matches[0].attachments).toHaveLength(1);
  const file = await page.request.get(
    "/api/next/files/" + matches[0].attachments[0].id,
  );
  expect((await file.body()).toString()).toBe("Сохранить после сбоя");
});

test("topic task tree selects several branches, excludes children and combines with people, dates and exports", async ({
  page,
}) => {
  await login(page);
  const data = await snapshot(page.request),
    sp = data.projects.find((p: any) => p.name === "SP"),
    web = data.projects.find((p: any) => p.name === "web"),
    patrick = data.contacts.find((c: any) => c.name === "Патрик"),
    suffix = randomUUID();
  const root = await create(page.request, {
    title: "Разрешение на вырубку деревьев",
    project: sp.id,
  });
  const plan = await create(page.request, {
    title: "Проект компенсационной посадки",
    parent: root,
    responsible: patrick.id,
    end: "2026-11-05",
  });
  const leaf = await create(page.request, {
    title: "Получить требования",
    parent: plan,
    responsible: patrick.id,
    end: "2026-11-03",
  });
  const skip = await create(page.request, {
    title: "Согласовать проект",
    parent: plan,
    responsible: patrick.id,
    end: "2026-11-03",
  });
  const second = await create(page.request, {
    title: "Подключение электричества",
    project: sp.id,
  });
  const secondLeaf = await create(page.request, {
    title: "Получить технические условия",
    parent: second,
  });
  const outside = await create(page.request, {
    title: "Другая работа SP " + suffix,
    project: sp.id,
    responsible: patrick.id,
    end: "2026-11-03",
  });
  const otherTopic = await create(page.request, {
    title: "Работа web " + suffix,
    project: web.id,
    responsible: patrick.id,
    end: "2026-11-03",
  });
  await page.goto("/tasks?projects=" + sp.id);
  await page.getByLabel("Выбрать задачи темы", { exact: true }).click();
  await expect(
    page.locator('[data-task-option="' + otherTopic + '"]'),
  ).toHaveCount(0);
  await page.locator('[data-action="tasks-none"]').click();
  await page.getByLabel("Найти задачу в дереве", { exact: true }).fill("выруб");
  await expect(page.locator('[data-task-option="' + plan + '"]')).toBeVisible();
  await page.locator('[data-task-choice="' + root + '"]').check();
  await page.locator('[data-task-choice="' + skip + '"]').uncheck();
  await page.locator(".task-options").evaluate((node) => (node.scrollTop = 0));
  await page.screenshot({
    path: test.info().outputPath("task-tree-picker.png"),
    fullPage: true,
  });
  await page
    .getByLabel("Найти задачу в дереве", { exact: true })
    .fill("электричества");
  await page.locator('[data-task-choice="' + second + '"]').check();
  await page.locator('.task-picker-footer [data-action="query-apply"]').click();
  const visible = async () =>
    page
      .locator("#task-content .task-row")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.task).sort(),
      );
  expect(await visible()).toEqual(
    [root, plan, leaf, second, secondLeaf].sort(),
  );
  await page.locator("#responsible-filter").selectOption(patrick.id);
  await page.locator("#filter-date-mode").selectOption("deadline");
  await page.locator("#filter-from").fill("2026-11-03");
  await page.locator("#filter-to").fill("2026-11-03");
  await page.locator('.query-buttons [data-action="query-apply"]').click();
  expect(await visible()).toEqual([leaf]);
  await expect(page.locator("#task-content")).toContainText(
    "SP › Разрешение на вырубку деревьев",
  );
  await page.reload();
  await expect(page.locator("#sync-status")).toContainText("Данные загружены");
  expect(await visible()).toEqual([leaf]);
  await page.locator('.head-actions [data-action="meeting-open"]').click();
  await expect(page.locator("#meeting-pages")).toContainText(
    "Получить требования",
  );
  await expect(page.locator("#meeting-pages")).not.toContainText(
    "Согласовать проект",
  );
  const exported = page.waitForEvent("download");
  await page.locator('[data-action="output-csv"]').click();
  const csv = await fs.readFile((await (await exported).path())!, "utf8");
  expect(csv).toContain("Получить требования");
  expect(csv).not.toContain("Другая работа SP " + suffix);
  await page.locator('[data-action="meeting-close"]').click();
  await page.getByLabel("Выбрать задачи темы", { exact: true }).click();
  await page.locator('[data-action="tasks-all"]').click();
  await page.locator('.task-picker-footer [data-action="query-apply"]').click();
  await expect(
    page.locator(
      '#task-content [data-action="edit-task"][data-id="' + outside + '"]',
    ),
  ).toBeVisible();
  await page
    .locator('.sidebar [data-action="project"][data-id="' + web.id + '"]')
    .click();
  await page.getByLabel("Выбрать задачи темы", { exact: true }).click();
  await expect(page.locator('[data-task-option="' + root + '"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('[data-task-option="' + otherTopic + '"]'),
  ).toBeVisible();
});

test("search opens a whole branch and tree exceptions survive reload including default-all mode", async ({
  page,
}) => {
  await login(page);
  const projectId = randomUUID();
  await action(page.request, "saveDirectory", {
    id: projectId,
    mode: "projects",
    name: "Дерево " + projectId,
  });
  const root = await create(page.request, {
    title: "Разрешение на вырубку " + projectId,
    project: projectId,
  });
  const plan = await create(page.request, {
    title: "Компенсационная посадка",
    parent: root,
  });
  const leaf = await create(page.request, {
    title: "Заказать проект у дендролога",
    parent: plan,
  });
  await page.goto("/tasks?projects=" + projectId);
  await page.locator("#search").fill("Разрешение на вырубку " + projectId);
  await expect(page.locator("#task-content .task-row")).toHaveCount(1);
  await page
    .locator(
      '#task-content [data-action="only-task-branch"][data-id="' + root + '"]',
    )
    .click();
  await expect(page.locator("#search")).toHaveValue("");
  await expect(page.locator("#task-content .task-row")).toHaveCount(3);
  await page.getByLabel("Выбрать задачи темы", { exact: true }).click();
  await page.locator('[data-action="tasks-all"]').click();
  await page.locator('[data-task-choice="' + plan + '"]').uncheck();
  await page.locator('[data-task-choice="' + leaf + '"]').check();
  await page.locator('.task-picker-footer [data-action="query-apply"]').click();
  const visible = async () =>
    page
      .locator("#task-content .task-row")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.task).sort(),
      );
  expect(await visible()).toEqual([root, leaf].sort());
  await page.reload();
  await expect(page.locator("#sync-status")).toContainText("Данные загружены");
  expect(await visible()).toEqual([root, leaf].sort());
  await page.screenshot({
    path: test.info().outputPath("tree-filter.png"),
    fullPage: true,
  });
});

test("a card creates an event across topics with independent questions, preparation, calendar and complete print material", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const data = await snapshot(page.request),
    sp = data.projects.find((p: any) => p.name === "SP"),
    vnz = data.projects.find((p: any) => p.name === "ВНЖ"),
    patrick = data.contacts.find((c: any) => c.name === "Патрик"),
    juraj = data.contacts.find((c: any) => c.name === "Юрай");
  const root = await create(page.request, {
    title: "Рабочий проект " + randomUUID(),
    description: "Полное описание рабочего проекта",
    project: sp.id,
    executors: [patrick.id],
    responsible: patrick.id,
  });
  const residence = await create(page.request, {
    title: "Документы ВНЖ " + randomUUID(),
    description: "Пакет документов ВНЖ",
    project: vnz.id,
  });
  await open(page, root);
  await page
    .locator("#task-description")
    .fill("Полное описание рабочего проекта с уточнением");
  await page
    .locator('#drawer-root [data-product="child"][data-kind="event"]')
    .click();
  await expect(page.locator('#task-form input[name="kind"]')).toHaveValue(
    "event",
  );
  const title = "Встречи 1–11 " + randomUUID();
  await page.locator("#task-title").fill(title);
  await page.locator("#task-start").fill("2026-11-01");
  await page.locator("#task-end").fill("2026-11-11");
  await page.locator("#task-description").fill("Повестка и материалы");
  await page.locator('[form="task-form"]').click();
  await expect(page.locator("#task-form")).toHaveCount(0);
  let model = await snapshot(page.request),
    event = model.tasks.find((t: any) => t.title === title);
  expect(model.tasks.find((t: any) => t.id === root).description).toContain(
    "с уточнением",
  );
  expect(
    model.tasks
      .filter((t: any) => t.kind === "reference" && t.activityId === event.id)
      .map((t: any) => t.linkedTaskId),
  ).toEqual([root]);
  await open(page, event.id);
  await page.locator('[data-product="link-tasks"]').click();
  await page.locator('[data-link-choice="' + residence + '"]').check();
  await page.locator('[data-product="link-apply"]').click();
  await expect(page.locator("#card-children")).toContainText("Документы ВНЖ");
  await page
    .locator('#drawer-root [data-product="child"][data-kind="question"]')
    .click();
  await page.locator("#task-title").fill("Общий вопрос о расходах");
  await page
    .locator('input[name="counterparties"][value="' + juraj.id + '"]')
    .check();
  await page
    .locator('input[name="executors"][value="' + patrick.id + '"]')
    .check();
  await page.locator("#task-tag-input").fill("важно обсудить");
  await page.locator("#task-tag-input").press("Enter");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page
    .locator('#drawer-root input[type="file"]')
    .setInputFiles({ name: "график.png", mimeType: "image/png", buffer: png });
  await page.locator('[form="task-form"]').click();
  await expect(page.locator("#task-form")).toHaveCount(0);
  model = await snapshot(page.request);
  const question = model.tasks.find(
    (t: any) => t.title === "Общий вопрос о расходах",
  );
  expect(question.kind).toBe("question");
  expect(question.project).toBe("");
  expect(question.counterparties).toEqual([juraj.id]);
  expect(question.executors).toEqual([patrick.id]);
  expect(question.tags).toEqual(["важно обсудить"]);
  await open(page, event.id);
  await page
    .locator('#drawer-root [data-product="child"][data-kind="preparation"]')
    .click();
  await page.locator("#task-title").fill("Купить билеты для поездки");
  await page.locator("#task-end").fill("2026-11-03");
  await page.locator('[form="task-form"]').click();
  await expect(page.locator("#task-form")).toHaveCount(0);
  model = await snapshot(page.request);
  expect(model.tasks.find((t: any) => t.id === event.id).topics.sort()).toEqual(
    [sp.id, vnz.id].sort(),
  );
  const prep = model.tasks.find(
    (t: any) => t.title === "Купить билеты для поездки",
  );
  await page.goto("/gantt");
  await expect(page.locator("#sync-status")).toContainText("Данные загружены");
  await expect(page.locator("#task-content")).not.toContainText(
    "Купить билеты для поездки",
  );
  await expect(page.locator("#task-content")).not.toContainText(title);
  await page.goto("/activities");
  await expect(page.locator('[data-event="' + event.id + '"]')).toBeVisible();
  await page.locator('.events-view-switch [data-id="calendar"]').click();
  await expect(
    page.locator('.event-calendar [data-id="' + event.id + '"]'),
  ).not.toHaveCount(0);
  await open(page, event.id);
  await page
    .locator(
      '#card-children [data-agenda-item="' +
        prep.id +
        '"] [data-product="move-item"][data-direction="-1"]',
    )
    .click();
  await expect
    .poll(async () => {
      const records = (await snapshot(page.request)).tasks.filter(
        (t: any) => t.activityId === event.id,
      );
      return (
        records.findIndex((t: any) => t.id === prep.id) <
        records.findIndex((t: any) => t.id === question.id)
      );
    })
    .toBe(true);
  await page.locator("#agenda-counterparty").selectOption(juraj.id);
  await expect(page.locator("#card-children")).toContainText(
    "Общий вопрос о расходах",
  );
  await expect(page.locator("#card-children")).not.toContainText(
    "Купить билеты для поездки",
  );
  await page.locator("#agenda-counterparty").selectOption("");
  await page.locator('#drawer-root [data-action="meeting-open"]').click();
  await expect(page.locator("#meeting-pages")).toContainText(
    "Общий вопрос о расходах",
  );
  await expect(page.locator("#meeting-pages")).toContainText(
    "Полное описание рабочего проекта с уточнением",
  );
  await expect(page.locator("#meeting-pages")).toContainText(
    "Купить билеты для поездки",
  );
  await expect(page.locator("#meeting-pages")).toContainText("Юрай");
  await expect(page.locator("#meeting-pages .print-image img")).not.toHaveCount(
    0,
  );
  await expect(page.locator('[data-action="meeting-print"]')).toBeEnabled();
  await page.screenshot({
    path: test.info().outputPath("cross-topic-event-print.png"),
    fullPage: true,
  });
  await page.locator('[data-action="meeting-close"]').click();
  await closeCard(page);
  await page.locator("#search-everywhere").check();
  await page.locator("#search").fill("Общий вопрос о расходах");
  await expect(page.locator("#task-content")).toContainText(
    "Общий вопрос о расходах",
  );
  expect(
    (await snapshot(page.request)).tasks.find((t: any) => t.id === prep.id)
      .kind,
  ).toBe("preparation");
  expect(errors).toEqual([]);
});

test("free tags filter and edit safely; a preparation card promotes to a topic while retaining the event link", async ({
  page,
}) => {
  await login(page);
  const data = await snapshot(page.request),
    sp = data.projects.find((p: any) => p.name === "SP");
  const eventId = await create(page.request, {
    kind: "event",
    title: "Мероприятие для переноса " + randomUUID(),
  });
  const prepId = await create(page.request, {
    kind: "preparation",
    activityId: eventId,
    title: "Подготовить самостоятельную работу",
    tags: ["новая свободная метка"],
  });
  await open(page, prepId);
  await page.locator('[data-product="promote"]').click();
  await page.locator("#promote-project").selectOption(sp.id);
  await page.locator('[data-product="promote-apply"]').click();
  await expect(page.locator('#task-form input[name="kind"]')).toHaveValue(
    "task",
  );
  let model = await snapshot(page.request);
  expect(model.tasks.find((t: any) => t.id === prepId).project).toBe(sp.id);
  expect(
    model.tasks.some(
      (t: any) =>
        t.kind === "reference" &&
        t.activityId === eventId &&
        t.linkedTaskId === prepId,
    ),
  ).toBe(true);
  await closeCard(page);
  await page.goto("/tasks?projects=" + sp.id);
  await page.locator(".tag-filter-details > summary").click();
  model = await snapshot(page.request);
  const tag = model.tags.find((t: any) => t.name === "новая свободная метка");
  await page
    .locator('[data-query-tag="includeTags"][value="' + tag.id + '"]')
    .check();
  await page.locator('.query-buttons [data-action="query-apply"]').click();
  await expect(page.locator("#task-content .task-row")).toHaveCount(1);
  await expect(page.locator("#task-content")).toContainText(
    "Подготовить самостоятельную работу",
  );
});

test("reviewed Excel previews before importing only retained tasks with original attachment bytes", async ({
  page,
}) => {
  const os = await import("node:os"),
    path = await import("node:path");
  const Database = createRequire(process.cwd() + "/package.json")(
    "better-sqlite3",
  );
  const { exportReview } = createRequire(process.cwd() + "/package.json")(
    "./scripts/export-review.cjs",
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-review-"));
  const source = path.join(root, "source"),
    out = path.join(root, "export");
  await fs.mkdir(path.join(source, "prisma"), { recursive: true });
  await fs.writeFile(
    path.join(source, "package.json"),
    JSON.stringify({ name: "task-gantt-app" }),
  );
  await fs.symlink(
    path.resolve("node_modules"),
    path.join(source, "node_modules"),
    "dir",
  );
  await fs.writeFile(path.join(source, ".env"), 'DATABASE_URL="file:./dev.db"');
  const db = new Database(path.join(source, "prisma/dev.db"));
  const prefix = randomUUID(),
    parent = prefix + "-parent",
    child = prefix + "-child";
  try {
    for (const name of (await fs.readdir("prisma/migrations")).sort()) {
      const sql = path.join("prisma/migrations", name, "migration.sql");
      try {
        db.exec(await fs.readFile(sql, "utf8"));
      } catch (e) {
        if (!["ENOENT", "ENOTDIR"].includes((e as any).code)) throw e;
      }
    }
    db.prepare(
      "INSERT INTO User(id,name,email,passwordHash,role) VALUES(?,?,?,?,?)",
    ).run(prefix, "Автор", "fixture@test.local", "synthetic", "ADMIN");
    for (const [id, title, p] of [
      [parent, "Убрать родителя", null],
      [child, "Сохранить выбранную задачу", parent],
    ])
      db.prepare(
        "INSERT INTO Task(id,title,description,parentTaskId,startDate,endDate,updatedAt) VALUES(?,?,?,?,?,?,?)",
      ).run(id, title, "Полное исходное описание", p, 1, 2, 1);
    db.prepare(
      "INSERT INTO Attachment(id,taskId,name,type,size,data) VALUES(?,?,?,?,?,?)",
    ).run(
      prefix + "-file",
      child,
      "материал.txt",
      "text/plain",
      8,
      Buffer.from("material"),
    );
    await exportReview({ source, output: out });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(out, "tasks-review.xlsx"));
    const sheet = workbook.getWorksheet("Отбор задач")!;
    sheet.eachRow((row, i) => {
      if (i > 1 && row.getCell(23).value === parent)
        row.getCell(2).value = "Удалить";
    });
    const edited = path.join(root, "reviewed.xlsx");
    await workbook.xlsx.writeFile(edited);
    await login(page);
    const before = (await snapshot(page.request)).tasks.length;
    await page.locator('[data-product="import"]').click();
    await page.locator("#import-workbook").setInputFiles(edited);
    await page.locator("#import-folder").setInputFiles(out);
    await page.locator('[data-product="import-preview"]').click();
    await expect(page.locator("#import-status")).toContainText("Оставлено: 1");
    expect((await snapshot(page.request)).tasks.length).toBe(before);
    await page.locator('[data-product="import-apply"]').click();
    await expect(page.locator("#import-status")).toContainText(
      "Импорт завершён",
    );
    const model = await snapshot(page.request),
      kept = model.tasks.find((t: any) => t.id === child);
    expect(model.tasks.some((t: any) => t.id === parent)).toBe(false);
    expect(kept.parent).toBe(null);
    expect(kept.description).toBe("Полное исходное описание");
    expect(
      await (
        await page.request.get("/api/next/files/" + kept.attachments[0].id)
      ).body(),
    ).toEqual(Buffer.from("material"));
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
