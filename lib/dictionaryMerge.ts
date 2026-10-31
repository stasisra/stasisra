import { prisma } from "./db";
import { normalizeTags } from "./validators";
import type { SessionUser } from "./auth";
import type { DictType } from "./dictionaries";
const clean = (v: string) => v.replace(/\s+/g, " ").trim();
export async function mergeDictionary(
  session: SessionUser,
  type: DictType,
  rawFrom: string,
  rawTo: string,
  global: boolean,
) {
  const from = clean(rawFrom),
    to = clean(rawTo);
  const key = (v: string) => clean(v).toLowerCase();
  if (!from || !to || from.length > 500 || to.length > 500)
    throw new Error("Укажите корректные значения");
  if (type === "tags" && (from.includes(",") || to.includes(",")))
    throw new Error("Тег не должен содержать запятую");
  if (key(from) === key(to)) return 0;
  const field =
    type === "tags"
      ? "tags"
      : type === "executors"
        ? "executorName"
        : "responsibleName";
  const scope = global ? "GLOBAL" : session.id;
  return prisma.$transaction(
    async (db) => {
      const rows = await db.task.findMany({
        select: {
          id: true,
          tags: true,
          executorName: true,
          responsibleName: true,
        },
      });
      let changed = 0;
      for (const row of rows) {
        if (type === "tags") {
          const tokens = (row.tags || "").split(",");
          if (!tokens.some((v) => key(v) === key(from))) continue;
          await db.task.update({
            where: { id: row.id },
            data: {
              tags: normalizeTags(
                tokens.map((v) => (key(v) === key(from) ? to : v)).join(","),
              ),
            },
          });
        } else {
          const value = row[field];
          if (!value || key(value) !== key(from)) continue;
          await db.task.update({
            where: { id: row.id },
            data: { [field]: to },
          });
        }
        changed++;
      }
      for (const [value, hidden] of [
        [from, true],
        [to, false],
      ] as const)
        await db.namePolicy.upsert({
          where: { scope_field_value: { scope, field, value } },
          create: { scope, field, value, hidden },
          update: { hidden },
        });
      return changed;
    },
    { timeout: 30000 },
  );
}
