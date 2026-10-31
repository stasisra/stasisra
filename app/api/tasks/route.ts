import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { taskCreateSchema, normalizeTags } from "@/lib/validators";
import { validateRelations } from "@/lib/taskRelations";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const parsed = taskCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  const v = parsed.data;
  try {
    const task = await prisma.$transaction(async (db) => {
      const executorId = v.executorName ? null : v.executorId;
      const responsibleId = v.responsibleName ? null : v.responsibleId;
      await validateRelations(
        db,
        null,
        v.parentTaskId,
        executorId,
        responsibleId,
      );
      return db.task.create({
        data: {
          ...v,
          ownerId: session.id,
          executorId,
          responsibleId,
          tags: normalizeTags(v.tags),
          startDate: new Date(v.startDate),
          endDate: new Date(v.endDate),
        },
        select: { id: true },
      });
    });
    return NextResponse.json({ ok: true, id: task.id }, { status: 201 });
  } catch (e) {
    const message =
      e instanceof Error && /не найден|создаёт цикл/.test(e.message)
        ? e.message
        : null;
    if (!message) console.error("Task create failed", e);
    return NextResponse.json(
      { error: message || "Не удалось создать задачу" },
      { status: message ? 400 : 500 },
    );
  }
}
