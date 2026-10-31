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
  const r = await api.get("/api/workspace");
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
async function action(
  api: APIRequestContext,
  action: string,
  data: Record<string, unknown>,
) {
  const r = await api.post("/api/workspace", { data: { action, data } });
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
  expect((await page.request.get("/api/workspace")).status()).toBe(401);
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
      await page.request.post("/api/workspace", {
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
  await page.locator('#filters [data-action="query-apply"]').click();
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
    const r = await page.request.post("/api/tasks/" + id + "/attachments", {
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
  await page.route("**/api/tasks/*/attachments", (route) => {
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
    "/api/attachments/" + matches[0].attachments[0].id,
  );
  expect((await file.body()).toString()).toBe("Сохранить после сбоя");
});
