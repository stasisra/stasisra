import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { taskUpdateSchema, normalizeTags } from "@/lib/validators";
import { validateRelations } from "@/lib/taskRelations";
import { internalPath } from "@/lib/navigation";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(req: Request, ctx: Context) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = taskUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  try {
    const task = await prisma.$transaction(async (db) => {
      const existing = await db.task.findUnique({ where: { id } });
      if (!existing) return null;
      const v = parsed.data;
      const start =
        v.startDate ?? existing.startDate.toISOString().slice(0, 10);
      const end = v.endDate ?? existing.endDate.toISOString().slice(0, 10);
      if (end < start) throw new Error("Дата окончания раньше даты начала");
      const data = { ...v, startDate: new Date(start), endDate: new Date(end) };
      if (v.executorName) data.executorId = null;
      else if (v.executorId) data.executorName = null;
      if (v.responsibleName) data.responsibleId = null;
      else if (v.responsibleId) data.responsibleName = null;
      if (v.tags !== undefined) data.tags = normalizeTags(v.tags);
      await validateRelations(
        db,
        id,
        v.parentTaskId,
        data.executorId,
        data.responsibleId,
      );
      return db.task.update({ where: { id }, data, select: { id: true } });
    });
    return task
      ? NextResponse.json(task)
      : NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
  } catch (e) {
    const message =
      e instanceof Error && /не найден|создаёт цикл|раньше/.test(e.message)
        ? e.message
        : null;
    if (!message) console.error("Task update failed", e);
    return NextResponse.json(
      { error: message || "Не удалось сохранить задачу" },
      { status: message ? 400 : 500 },
    );
  }
}
export async function DELETE(_req: Request, ctx: Context) {
  if (!(await getSession()))
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { id } = await ctx.params;
  const result = await prisma.task.deleteMany({ where: { id } });
  return result.count
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
}
export async function POST(req: Request, ctx: Context) {
  const fd = await req.formData().catch(() => null);
  if (fd?.get("_method") !== "DELETE")
    return NextResponse.json({ error: "Unsupported" }, { status: 405 });
  const res = await DELETE(req, ctx);
  if (!res.ok) return res;
  return NextResponse.redirect(
    new URL(internalPath(fd.get("return")), req.url),
    303,
  );
}
