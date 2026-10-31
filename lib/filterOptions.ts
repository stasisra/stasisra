// lib/filterOptions.ts
import { prisma } from "@/lib/db";
import type { SessionUser } from "./auth";
import type { Prisma } from "@prisma/client";
import { userIdFromSession } from "@/lib/taskQuery";

/**
 * То, что возвращает helper для фильтров.
 */
export type FilterOptions = {
  executorOptions: string[];
  responsibleOptions: string[];
  tagOptions: string[];
};

function normSpaces(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

// для сравнения hidden/values (case-insensitive)
function keyOf(s: string) {
  return normSpaces(s).toLowerCase();
}

function uniqSorted(arr: (string | null | undefined)[]) {
  return Array.from(
    new Set(
      arr.map((x) => normSpaces(String(x ?? ""))).filter((x) => x.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b, "ru"));
}

function splitTags(s: string) {
  return (s ?? "")
    .split(",")
    .map((x) => normSpaces(x))
    .filter(Boolean);
}

/**
 * Возвращает options для фильтров/подсказок, учитывая NamePolicy:
 * - hidden=true скрывает значение
 * - hidden=false добавляет value как "ручное" даже если его нет в задачах
 *
 * scope: GLOBAL + userId
 */
export async function getFilterOptions(
  session: SessionUser,
  baseWhere: Prisma.TaskWhereInput,
): Promise<FilterOptions> {
  const userId = userIdFromSession(session);
  const scopes = ["GLOBAL", ...(userId ? [userId] : [])];

  const [execRows, respRows, tagRows, rawPolicies] = await Promise.all([
    prisma.task.findMany({
      where: baseWhere,
      select: { executorName: true, executor: { select: { name: true } } },

      orderBy: { executorName: "asc" },
    }),

    prisma.task.findMany({
      where: baseWhere,
      select: {
        responsibleName: true,
        responsible: { select: { name: true } },
      },

      orderBy: { responsibleName: "asc" },
    }),

    prisma.task.findMany({
      where: { AND: [baseWhere, { tags: { not: null } }] },
      select: { tags: true },
      distinct: ["tags"],
      orderBy: { tags: "asc" },
    }),

    // ✅ NamePolicy: и hidden=true (скрыть), и hidden=false (ручные значения)
    prisma.namePolicy.findMany({
      where: { scope: { in: scopes } },
      select: { field: true, value: true, hidden: true, scope: true },
    }),
  ]);

  const policyMap = new Map<string, (typeof rawPolicies)[number]>();
  for (const scope of scopes)
    for (const policy of rawPolicies.filter((p) => p.scope === scope))
      policyMap.set(policy.field + ":" + keyOf(policy.value), policy);
  const policies = [...policyMap.values()];

  // --- policies -> sets/maps ---
  const hiddenExec = new Set(
    policies
      .filter((p) => p.field === "executorName" && p.hidden)
      .map((p) => keyOf(String(p.value ?? ""))),
  );
  const hiddenResp = new Set(
    policies
      .filter((p) => p.field === "responsibleName" && p.hidden)
      .map((p) => keyOf(String(p.value ?? ""))),
  );
  const hiddenTags = new Set(
    policies
      .filter((p) => p.field === "tags" && p.hidden)
      .map((p) => keyOf(String(p.value ?? ""))),
  );

  // ✅ "ручные" (hidden=false) — должны появляться в options даже если их нет в задачах
  const manualExec = uniqSorted(
    policies
      .filter((p) => p.field === "executorName" && !p.hidden)
      .map((p) => String(p.value ?? "")),
  );

  const manualResp = uniqSorted(
    policies
      .filter((p) => p.field === "responsibleName" && !p.hidden)
      .map((p) => String(p.value ?? "")),
  );

  const manualTags = uniqSorted(
    policies
      .filter((p) => p.field === "tags" && !p.hidden)
      .map((p) => String(p.value ?? "")),
  );

  // --- options from tasks ---
  const fromTasksExec = uniqSorted(
    execRows.map((x) => x.executorName || x.executor?.name),
  );
  const fromTasksResp = uniqSorted(
    respRows.map((x) => x.responsibleName || x.responsible?.name),
  );

  const fromTasksTags = uniqSorted(
    tagRows
      .map((x) => x.tags)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .flatMap((s) => splitTags(s)),
  );

  // --- UNION (tasks + manual) then remove hidden ---
  const executorOptions = uniqSorted([...fromTasksExec, ...manualExec]).filter(
    (x) => !hiddenExec.has(keyOf(x)),
  );
  const responsibleOptions = uniqSorted([
    ...fromTasksResp,
    ...manualResp,
  ]).filter((x) => !hiddenResp.has(keyOf(x)));
  const tagOptions = uniqSorted([...fromTasksTags, ...manualTags]).filter(
    (x) => !hiddenTags.has(keyOf(x)),
  );

  return { executorOptions, responsibleOptions, tagOptions };
}
