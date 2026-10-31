import type { Prisma } from "@prisma/client";
export async function validateRelations(
  db: Prisma.TransactionClient,
  taskId: string | null,
  parentId: string | null | undefined,
  executorId?: string | null,
  responsibleId?: string | null,
) {
  const ids = [executorId, responsibleId].filter((id): id is string => !!id);
  if (ids.length) {
    const users = await db.user.count({
      where: { id: { in: [...new Set(ids)] } },
    });
    if (users !== new Set(ids).size)
      throw new Error("Исполнитель или ответственный не найден");
  }
  let parent = parentId;
  const seen = new Set<string>(taskId ? [taskId] : []);
  while (parent) {
    if (seen.has(parent)) throw new Error("Родительская задача создаёт цикл");
    seen.add(parent);
    const row: { parentTaskId: string | null } | null =
      await db.task.findUnique({
        where: { id: parent },
        select: { parentTaskId: true },
      });
    if (!row) throw new Error("Родительская задача не найдена");
    parent = row.parentTaskId;
  }
}
