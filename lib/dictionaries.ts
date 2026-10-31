import { prisma } from "./db";
import type { SessionUser } from "./auth";
export type DictType = "tags" | "executors" | "responsibles";
const clean = (v: string) => v.replace(/\s+/g, " ").trim();
export async function dictionaryItems(
  session: SessionUser,
  type: DictType,
  scopes = ["GLOBAL", session.id],
) {
  const field =
    type === "tags"
      ? "tags"
      : type === "executors"
        ? "executorName"
        : "responsibleName";
  const [tasks, policies] = await Promise.all([
    prisma.task.findMany({
      select: {
        executorName: true,
        responsibleName: true,
        tags: true,
        updatedAt: true,
      },
    }),
    prisma.namePolicy.findMany({
      where: { field, scope: { in: scopes } },
      select: { scope: true, value: true, hidden: true },
    }),
  ]);
  const map = new Map<
    string,
    { value: string; count: number; lastUsedAt: string | null; hidden: boolean }
  >();
  for (const task of tasks) {
    const values =
      type === "tags" ? (task.tags || "").split(",") : [task[field] || ""];
    const seen = new Set<string>();
    for (const raw of values) {
      const value = clean(raw);
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      const prev = map.get(key);
      const date = task.updatedAt.toISOString();
      map.set(key, {
        value: prev?.value || value,
        count: (prev?.count || 0) + 1,
        lastUsedAt:
          !prev?.lastUsedAt || date > prev.lastUsedAt ? date : prev.lastUsedAt,
        hidden: false,
      });
    }
  }
  for (const scope of scopes)
    for (const policy of policies.filter((p) => p.scope === scope)) {
      const value = clean(policy.value);
      if (!value) continue;
      const key = value.toLowerCase();
      const prev = map.get(key);
      map.set(key, {
        value: prev?.value || value,
        count: prev?.count || 0,
        lastUsedAt: prev?.lastUsedAt || null,
        hidden: policy.hidden,
      });
    }
  return [...map.values()].sort(
    (a, b) =>
      (b.lastUsedAt || "").localeCompare(a.lastUsedAt || "") ||
      b.count - a.count ||
      a.value.localeCompare(b.value, "ru"),
  );
}
