import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
const filter = createRequire(path.resolve("package.json"))(
  "./public/workspace/task-filter.js",
);
const rows = [
  { id: "root", parent: null },
  { id: "plan", parent: "root" },
  { id: "request", parent: "plan" },
  { id: "approve", parent: "plan" },
  { id: "submit", parent: "root" },
  { id: "other", parent: null },
  { id: "other-child", parent: "other" },
];
const ids = (value: Set<string>) => [...value].sort();
test("tree multiselection supports parents, individual exceptions and deeper inclusion", () => {
  const index = filter.createIndex(rows);
  let q = { all: false, include: ["root", "other"], exclude: [] };
  assert.deepEqual(
    ids(filter.resolve(index, q).selected),
    rows.map((t) => t.id).sort(),
  );
  q = filter.toggle(index, q, "plan", false);
  assert.deepEqual(ids(filter.resolve(index, q).selected), [
    "other",
    "other-child",
    "root",
    "submit",
  ]);
  q = filter.toggle(index, q, "request", true);
  assert.deepEqual(ids(filter.resolve(index, q).selected), [
    "other",
    "other-child",
    "request",
    "root",
    "submit",
  ]);
  const partial = filter.resolve(index, q).stats.get("root");
  assert.deepEqual(partial, { total: 5, selected: 3 });
  q = filter.toggle(index, q, "plan", true);
  assert.deepEqual(
    ids(filter.resolve(index, q).selected),
    rows.map((t) => t.id).sort(),
  );
  assert.deepEqual(q.exclude, []);
});
test("all, none, deleted tasks and newly created descendants retain explicit selection semantics", () => {
  const index = filter.createIndex(rows);
  assert.equal(filter.resolve(index, { all: true }).selected.size, 7);
  assert.equal(filter.resolve(index, { all: false }).selected.size, 0);
  assert.equal(
    filter.resolve(index, { all: false, include: ["deleted"] }).selected.size,
    0,
  );
  const q = { all: false, include: ["plan"], exclude: ["approve"] };
  const extended = filter.createIndex([...rows, { id: "new", parent: "plan" }]);
  assert.deepEqual(ids(filter.resolve(extended, q).selected), [
    "new",
    "plan",
    "request",
  ]);
  let all = filter.toggle(index, { all: true }, "plan", false);
  all = filter.toggle(index, all, "request", true);
  assert.deepEqual(all, { all: true, include: ["request"], exclude: ["plan"] });
  assert.equal(filter.resolve(index, all).selected.has("request"), true);
  assert.equal(filter.resolve(index, all).selected.has("approve"), false);
});
test("deep nesting and invalid historical cycles do not overflow or hide records", () => {
  const deep = Array.from({ length: 5000 }, (_, i) => ({
    id: "n" + i,
    parent: i ? "n" + (i - 1) : null,
  }));
  const index = filter.createIndex(deep),
    result = filter.resolve(index, {
      all: false,
      include: ["n0"],
      exclude: ["n2500"],
    });
  assert.equal(result.selected.size, 2500);
  assert.deepEqual(result.stats.get("n0"), { total: 5000, selected: 2500 });
  assert.equal(filter.descendants(index, "n0").size, 5000);
  const cycle = filter.createIndex([
    { id: "a", parent: "b" },
    { id: "b", parent: "a" },
    { id: "tail", parent: "a" },
  ]);
  assert.equal(filter.resolve(cycle, { all: true }).selected.size, 3);
  assert.equal(
    filter.toggle(cycle, { all: false }, "a", true).include.length,
    1,
  );
});
