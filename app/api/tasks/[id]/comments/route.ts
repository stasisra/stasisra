import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canSeeTask, getSession } from "@/lib/auth";

export async function POST(
  req: Request,
  { params: rawParams }: { params: Promise<{ id: string }> },
) {
  const params = await rawParams;
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const task = await prisma.task.findUnique({ where: { id: params.id } });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canSeeTask(session, task))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const text = String(body.body || "").trim();
  if (!text)
    return NextResponse.json({ error: "Пустой комментарий" }, { status: 400 });

  const c = await prisma.taskComment.create({
    data: { taskId: task.id, authorId: session.id, body: text },
  });

  return NextResponse.json({ id: c.id });
}
