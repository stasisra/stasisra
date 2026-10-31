import { prisma } from "./db";
import {
  filtersWhere,
  matchesTags,
  matchesAssignments,
  scopeWhere,
  type Params,
} from "./taskQuery";
import type { SessionUser } from "./auth";
import type { Prisma } from "@prisma/client";
export const taskInclude = {
  executor: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true } },
  comments: {
    take: 1,
    orderBy: { createdAt: "desc" },
    select: { body: true, createdAt: true },
  },
} satisfies Prisma.TaskInclude;
export async function queryTasks(
  session: SessionUser,
  input: Params = {},
  includeParents = false,
) {
  const all = await prisma.task.findMany({
    where: scopeWhere(session),
    include: taskInclude,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const rows = await prisma.task.findMany({
    where: { AND: [scopeWhere(session), filtersWhere(input)] },
    select: { id: true, tags: true },
  });
  const matchingTags = new Set(
    rows.filter((t) => matchesTags(t.tags, input)).map((t) => t.id),
  );
  const keep = new Set(
    all
      .filter((t) => matchingTags.has(t.id) && matchesAssignments(t, input))
      .map((t) => t.id),
  );
  if (includeParents) {
    const byId = new Map(all.map((t) => [t.id, t]));
    for (const id of [...keep]) {
      let parent = byId.get(id)?.parentTaskId;
      const seen = new Set<string>([id]);
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        keep.add(parent);
        parent = byId.get(parent)?.parentTaskId;
      }
    }
  }
  return all.filter((t) => keep.has(t.id));
}
