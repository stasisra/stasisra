// app/api/comments/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canSeeTask } from "@/lib/auth";

function safeDecodeURIComponent(v: string) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function normalizeInternalPath(raw: string | null | undefined) {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const decoded = safeDecodeURIComponent(v).trim();
  // базовая защита: разрешаем только внутренние пути
  if (!decoded.startsWith("/")) return "";
  return decoded;
}

async function doDelete(
  req: Request,
  commentId: string,
  returnRaw?: string | null,
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const comment = await prisma.taskComment.findUnique({
    where: { id: commentId },
    include: {
      task: { include: { executor: true, responsible: true } },
    },
  });

  if (!comment || !comment.task)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canSeeTask(session, comment.task as any))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const userId = (session as any).id;
  const canDelete =
    session.role === "ADMIN" ||
    comment.authorId === userId ||
    comment.task.executor?.id === userId ||
    comment.task.responsible?.id === userId;

  if (!canDelete)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.taskComment.delete({ where: { id: commentId } });

  // ✅ вернёмся в карточку задачи, но сохраним return
  const returnUrl = normalizeInternalPath(returnRaw) || "/tasks";
  const taskHref = `/tasks/${comment.taskId}?return=${encodeURIComponent(returnUrl)}`;

  return NextResponse.redirect(new URL(taskHref, req.url), 303);
}

export async function POST(
  req: Request,
  { params: rawParams }: { params: Promise<{ id: string }> },
) {
  const params = await rawParams;
  const fd = await req.formData().catch(() => null);
  const method = String(fd?.get("_method") || "").toUpperCase();

  if (method === "DELETE") {
    const returnRaw = fd?.get("return")?.toString() ?? null;
    return doDelete(req, params.id, returnRaw);
  }

  return NextResponse.json({ error: "Unsupported" }, { status: 405 });
}

// если потом захочешь удалять через fetch
export async function DELETE(
  req: Request,
  { params: rawParams }: { params: Promise<{ id: string }> },
) {
  const params = await rawParams;
  // тут return неоткуда взять, оставим fallback
  return doDelete(req, params.id, null);
}
