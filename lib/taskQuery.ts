import type { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";
import { dateOnly, todayYmd, utcDate, DAY_MS } from "./dates";
export const isAdmin = (s: SessionUser | null | undefined): boolean =>
  s?.role === "ADMIN";
export function userIdFromSession(session: SessionUser): string;
export function userIdFromSession(session: null | undefined): null;
export function userIdFromSession(
  session: SessionUser | null | undefined,
): string | null;
export function userIdFromSession(session: SessionUser | null | undefined) {
  return session?.id ?? null;
}
export function scopeWhere(
  session: SessionUser | null | undefined,
): Prisma.TaskWhereInput {
  return isAdmin(session) ? {} : { id: "__NO_ACCESS__" };
}
export type Params =
  URLSearchParams | Record<string, string | string[] | undefined>;
export function toParams(input: Params = {}): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined) out.set(key, v);
  }
  return out;
}
export function parseFilters(input: Params = {}) {
  const p = toParams(input);
  const get = (...keys: string[]) =>
    keys.map((k) => p.get(k)?.trim()).find(Boolean) || "";
  const csv = (v: string) =>
    v
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  const status = get("st", "status").toUpperCase();
  return {
    q: get("q"),
    description: get("description"),
    status: ["PLANNED", "IN_PROGRESS", "PAUSED", "DONE"].includes(status)
      ? status
      : "",
    executorName: get("ex", "executorName", "executor"),
    responsibleName: get("resp", "responsibleName", "responsible"),
    includeTags: csv(get("tin", "tagsPick", "tag")),
    excludeTags: csv(get("tex", "tagsHide")),
    tagMode: get("tagMode", "d_tagMode") === "AND" ? "AND" : "OR",
    showDone: ["1", "true", "on"].includes(get("done", "showDone")),
    dueTo: dateOnly(get("dueTo")),
    overdue: get("overdue") === "1",
    due7: get("due") === "7d",
  };
}
export function filtersWhere(input: Params = {}): Prisma.TaskWhereInput {
  const f = parseFilters(input);
  const AND: Prisma.TaskWhereInput[] = [];
  if (f.status) AND.push({ status: f.status });
  else if (!f.showDone) AND.push({ status: { not: "DONE" } });
  if (f.q)
    AND.push({
      OR: [{ title: { contains: f.q } }, { description: { contains: f.q } }],
    });
  if (f.description) AND.push({ description: { contains: f.description } });
  if (f.dueTo)
    AND.push({
      endDate: { lt: new Date(utcDate(f.dueTo).getTime() + DAY_MS) },
    });
  const today = utcDate(todayYmd());
  if (f.overdue) AND.push({ status: { not: "DONE" }, endDate: { lt: today } });
  if (f.due7)
    AND.push({
      status: { not: "DONE" },
      endDate: { gte: today, lt: new Date(today.getTime() + 7 * DAY_MS) },
    });
  return AND.length ? { AND } : {};
}
export function matchesTags(
  tags: string | null | undefined,
  input: Params,
): boolean {
  const f = parseFilters(input);
  const tokens = new Set(
    (tags || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
  if (f.excludeTags.some((t) => tokens.has(t))) return false;
  return (
    !f.includeTags.length ||
    (f.tagMode === "AND"
      ? f.includeTags.every((t) => tokens.has(t))
      : f.includeTags.some((t) => tokens.has(t)))
  );
}
export function mergeWhere(
  a: Prisma.TaskWhereInput,
  b: Prisma.TaskWhereInput,
): Prisma.TaskWhereInput {
  return { AND: [a, b] };
}

export function matchesAssignments(
  task: {
    executorName?: string | null;
    responsibleName?: string | null;
    executor?: { name: string } | null;
    responsible?: { name: string } | null;
  },
  input: Params,
) {
  const f = parseFilters(input);
  const key = (value: string) =>
    value.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    (!f.executorName ||
      key(task.executorName || task.executor?.name || "") ===
        key(f.executorName)) &&
    (!f.responsibleName ||
      key(task.responsibleName || task.responsible?.name || "") ===
        key(f.responsibleName))
  );
}
