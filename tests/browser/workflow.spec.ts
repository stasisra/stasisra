import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
const email = "browser-admin@example.test";
const password = "synthetic-browser-password";
async function login(page: import("@playwright/test").Page, next = "/tasks") {
  await page.goto("/login?next=" + encodeURIComponent(next));
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/(tasks|dashboard)/);
}
test("login rejects executable return URLs and registration stays closed", async ({
  page,
}) => {
  expect((await page.request.get("/api/tasks/export.csv")).status()).toBe(401);
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
});
test("administrator workflow, validation, attachments, filters and exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const api = page.request;
  const create = async (title: string, extra: Record<string, unknown> = {}) => {
    const res = await api.post("/api/tasks", {
      data: {
        title,
        startDate: "2026-10-20",
        endDate: "2026-10-31",
        executorName: "Внешний исполнитель",
        responsibleName: "Администратор",
        ...extra,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).id as string;
  };
  const parent = await create("Проверка интерфейса", { tags: "foo" });
  const child = await create("Подзадача", {
    parentTaskId: parent,
    tags: "foobar",
  });
  expect(
    (
      await api.patch(`/api/tasks/${parent}`, { data: { parentTaskId: child } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await api.patch(`/api/tasks/${parent}`, {
        data: { endDate: "2026-01-01" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await api.post("/api/tasks", {
        data: {
          title: "Bad dates",
          startDate: "2026-02-30",
          endDate: "2026-03-01",
        },
      })
    ).status(),
  ).toBe(400);
  for (const type of ["tags", "executors", "responsibles"])
    expect((await api.get("/api/dictionaries?type=" + type)).status()).toBe(
      200,
    );
  await page.goto(`/tasks/${parent}`);
  expect(await page.content()).not.toContain("passwordHash");
  // Rejected save must allow a second attempt without reloading.
  const dates = page.locator("input[type=date]");
  await dates.nth(1).fill("2026-01-01");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText("Дата окончания раньше даты начала", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сохранить", exact: true }),
  ).toBeEnabled();
  await dates.nth(1).fill("2026-11-02");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Сохранить", exact: true }),
  ).toBeEnabled();
  await page
    .getByPlaceholder("Например: пауза, потому что ждем подрядчика...")
    .fill("Комментарий проверки");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(
    page.getByText("Комментарий проверки", { exact: true }),
  ).toBeVisible();
  const uploaded = await api.post(`/api/tasks/${parent}/attachments`, {
    multipart: {
      file: {
        name: "проверка.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("test attachment"),
      },
    },
  });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const file = await uploaded.json();
  expect((await api.get(`/api/attachments/${file.id}`)).status()).toBe(200);
  expect((await api.get(`/api/tasks/${parent}/attachments`)).status()).toBe(
    200,
  );
  for (const ext of ["csv", "xlsx", "pdf"]) {
    const res = await api.get(`/api/tasks/export.${ext}?tin=foo`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.body();
    if (ext === "csv") {
      expect(body.toString()).toContain("Проверка интерфейса");
      expect(body.toString()).not.toContain("Подзадача");
    }
    if (ext === "xlsx") {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(body as never);
      expect(wb.worksheets[0].rowCount).toBe(2);
    }
    if (ext === "pdf") expect(body.subarray(0, 4).toString()).toBe("%PDF");
  }
  await page.goto("/tasks?tin=foo");
  await expect(
    page.getByRole("link", { name: "Проверка интерфейса", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Подзадача", exact: true }),
  ).toHaveCount(0);
  await page.goto("/tasks?exp=0");
  await expect(page).toHaveURL(/exp=0/);
  await page.goto("/gantt?dueTo=2000-01-01");
  await expect(
    page.getByText("Нет задач по фильтрам.", { exact: true }),
  ).toBeVisible();
  for (const url of [
    "/dashboard",
    "/dashboard/focus/print",
    "/settings/names",
    "/dashboard/dictionaries",
  ]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(200);
  }
  const future = await create("Дальний срок", {
    startDate: "2050-01-01",
    endDate: "2050-01-02",
  });
  await page.goto("/gantt");
  await expect(
    page.getByRole("link", { name: "Дальний срок", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Открыть задачу: Дальний срок", { exact: true }),
  ).toHaveCount(0);
  await api.delete(`/api/tasks/${future}`);
  const deletion = await api.post(`/api/tasks/${parent}`, {
    form: { _method: "DELETE", return: "/tasks" },
    maxRedirects: 0,
  });
  expect(deletion.status()).toBe(303);
  expect((await api.get(`/api/attachments/${file.id}`)).status()).toBe(404);
  expect((await api.delete(`/api/tasks/${child}`)).status()).toBe(200);
  expect(errors).toEqual([]);
});
