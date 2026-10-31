import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  taskCreateSchema,
  taskUpdateSchema,
  normalizeTags,
} from "../lib/validators";
import { internalPath } from "../lib/navigation";
import { buildTree } from "../lib/taskTree";
import {
  parseFilters,
  filtersWhere,
  matchesTags,
  matchesAssignments,
  scopeWhere,
} from "../lib/taskQuery";
import { calendarDays, dateOnly } from "../lib/dates";
import { csvCell } from "../lib/export";
import { validateRelations } from "../lib/taskRelations";
const admin = {
  id: "admin",
  role: "ADMIN" as const,
  name: "Admin",
  email: "admin@example.test",
};
const draft = {
  title: " Task ",
  startDate: "2026-10-20",
  endDate: "2026-10-31",
};
test("dates reject impossible dates and reversed ranges", () => {
  assert.equal(dateOnly("2026-02-30"), null);
  assert.equal(
    taskCreateSchema.safeParse({ ...draft, endDate: "2026-10-19" }).success,
    false,
  );
  assert.equal(
    taskUpdateSchema.safeParse({ endDate: "invalid" }).success,
    false,
  );
  assert.equal(taskCreateSchema.parse(draft).title, "Task");
});
test("single-field patches retain optional fields without clearing assignments", () => {
  assert.deepEqual(taskUpdateSchema.parse({ percentComplete: 25 }), {
    percentComplete: 25,
  });
});
test("only internal return URLs are accepted", () => {
  for (const value of [
    "javascript:alert(1)",
    "//example.test",
    "/\\example.test",
    "/%2fexample.test",
    "/%5cexample.test",
  ])
    assert.equal(internalPath(value), "/tasks");
  assert.equal(internalPath("/tasks?tin=foo"), "/tasks?tin=foo");
});
test("canonical and legacy filters normalize to the same contract", () => {
  assert.deepEqual(
    parseFilters({ st: "PAUSED", ex: "ABC", tin: "One,two", done: "1" }),
    parseFilters({
      status: "PAUSED",
      executorName: "ABC",
      tagsPick: "One,two",
      showDone: "1",
    }),
  );
  assert.match(
    JSON.stringify(filtersWhere({ dueTo: "2026-10-31" })),
    /2026-11-01/,
  );
});
test("tags use exact normalized tokens and support exclusion and AND", () => {
  assert.equal(matchesTags("foobar", { tin: "foo" }), false);
  assert.equal(matchesTags("Foo, bar", { tin: "foo" }), true);
  assert.equal(matchesTags("foo,bar", { tex: "bar" }), false);
  assert.equal(matchesTags("foo", { tin: "foo,bar", tagMode: "AND" }), false);
  assert.equal(normalizeTags(" Foo, foo, BAR , "), "Foo,BAR");
  assert.equal(
    matchesAssignments({ executorName: "  ABC  Ltd " }, { ex: "abc ltd" }),
    true,
  );
});
test("admin sees legacy tasks regardless of owner", () => {
  assert.deepEqual(scopeWhere(admin), {});
  assert.notDeepEqual(scopeWhere(null), {});
});
test("corrupt legacy parent cycles do not hide nodes or recurse forever", () => {
  const tree = buildTree([
    { id: "a", title: "A", parentTaskId: "b", sortOrder: 0 },
    { id: "b", title: "B", parentTaskId: "a", sortOrder: 0 },
  ]);
  assert.equal(tree.length, 2);
});
test("calendar date differences are stable across DST", () => {
  assert.equal(calendarDays("2026-03-26", "2026-03-29"), 3);
  assert.equal(calendarDays("2026-10-23", "2026-10-26"), 3);
});
test("CSV protects formulas and preserves quotes and line breaks", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
});
test("real SQLite migrations, import visibility, relations and attachments", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "task-gantt-test-"));
  process.env.DATABASE_URL = "file:" + path.join(dir, "test.db");
  let prisma: import("@prisma/client").PrismaClient | undefined;
  try {
    const init = () =>
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/init-db.ts"],
        { cwd: process.cwd(), env: process.env, stdio: "pipe" },
      );
    init();
    init();
    ({ prisma } = await import("../lib/db"));
    await prisma.user.create({
      data: {
        id: "admin",
        name: "Admin",
        email: admin.email,
        passwordHash: "synthetic",
        role: "ADMIN",
      },
    });
    const parent = await prisma.task.create({
      data: {
        title: "Parent",
        startDate: new Date(draft.startDate),
        endDate: new Date(draft.endDate),
        tags: "foo",
        ownerId: null,
      },
    });
    const child = await prisma.task.create({
      data: {
        title: "Child",
        startDate: new Date(draft.startDate),
        endDate: new Date(draft.endDate),
        parentTaskId: parent.id,
        tags: "foobar",
      },
    });
    await assert.rejects(
      prisma.$transaction((db) => validateRelations(db, parent.id, child.id)),
      /цикл/,
    );
    await assert.rejects(
      prisma.$transaction((db) =>
        validateRelations(db, parent.id, null, "missing"),
      ),
      /не найден/,
    );
    const { queryTasks } = await import("../lib/tasks");
    const rows = await queryTasks(admin, { tin: "foo" });
    assert.deepEqual(
      rows.map((t) => t.id),
      [parent.id],
    );
    assert(!JSON.stringify(rows).includes("passwordHash"));
    const { dictionaryItems } = await import("../lib/dictionaries");
    const dictionary = await dictionaryItems(admin, "tags");
    assert(
      dictionary.some(
        (t) => t.value === "foo" && t.count === 1 && t.lastUsedAt,
      ),
    );
    const { mergeDictionary } = await import("../lib/dictionaryMerge");
    assert.equal(
      await mergeDictionary(admin, "tags", "FOO", "merged", false),
      1,
    );
    assert.equal(
      (await prisma.task.findUniqueOrThrow({ where: { id: parent.id } })).tags,
      "merged",
    );
    const file = await prisma.attachment.create({
      data: {
        taskId: child.id,
        name: "тест.txt",
        type: "text/plain",
        size: 3,
        data: new Uint8Array([1, 2, 3]),
      },
    });
    assert.equal(
      (await prisma.attachment.findUniqueOrThrow({ where: { id: file.id } }))
        .data.length,
      3,
    );
    await prisma.task.delete({ where: { id: parent.id } });
    assert.equal(
      (await prisma.task.findUniqueOrThrow({ where: { id: child.id } }))
        .parentTaskId,
      null,
    );
    await prisma.task.delete({ where: { id: child.id } });
    assert.equal(await prisma.attachment.count(), 0);
  } finally {
    await prisma?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
