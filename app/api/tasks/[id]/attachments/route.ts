import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { attachmentMeta, attachmentSelect } from "@/lib/attachmentMeta";
const MAX = 20 * 1024 * 1024;
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Context) {
  if (!(await getSession()))
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { id } = await ctx.params;
  const rows = await prisma.attachment.findMany({
    where: { taskId: id },
    select: attachmentSelect,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows.map(attachmentMeta), {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(req: Request, ctx: Context) {
  if (!(await getSession()))
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await prisma.task.findUnique({ where: { id }, select: { id: true } })))
    return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
  if (Number(req.headers.get("content-length")) > MAX + 65536)
    return NextResponse.json(
      { error: "Максимальный размер — 20 МБ" },
      { status: 413 },
    );
  const reader = req.body?.getReader();
  if (!reader)
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX + 65536) {
      await reader.cancel();
      return NextResponse.json(
        { error: "Максимальный размер — 20 МБ" },
        { status: 413 },
      );
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);
  const form = await new Response(buffer, {
    headers: { "content-type": req.headers.get("content-type") || "" },
  })
    .formData()
    .catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size)
    return NextResponse.json(
      { error: "Выберите непустой файл" },
      { status: 400 },
    );
  if (file.size > MAX)
    return NextResponse.json(
      { error: "Максимальный размер — 20 МБ" },
      { status: 413 },
    );
  const uploadId = form?.get("uploadId");
  if (uploadId && !/^[a-zA-Z0-9_-]{1,100}$/.test(String(uploadId)))
    return NextResponse.json(
      { error: "Некорректный идентификатор загрузки" },
      { status: 400 },
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const row = await prisma.$transaction(async (tx) => {
      if (uploadId) {
        const existing = await tx.attachment.findUnique({
          where: { id: String(uploadId) },
        });
        if (existing) {
          if (
            existing.taskId !== id ||
            existing.name !== file.name.slice(0, 255) ||
            existing.size !== file.size ||
            !Buffer.from(existing.data).equals(Buffer.from(bytes))
          )
            throw new Error("UPLOAD_CONFLICT");
          return existing;
        }
      }
      if (!(await tx.task.findUnique({ where: { id }, select: { id: true } })))
        throw new Error("TASK_MISSING");
      const created = await tx.attachment.create({
        data: {
          ...(uploadId ? { id: String(uploadId) } : {}),
          taskId: id,
          name: file.name.slice(0, 255),
          type: file.type || "application/octet-stream",
          size: file.size,
          data: bytes,
        },
        select: attachmentSelect,
      });
      await tx.workspaceMeta.update({
        where: { key: "revision" },
        data: {
          value: String(
            Number(
              (
                await tx.workspaceMeta.findUniqueOrThrow({
                  where: { key: "revision" },
                })
              ).value,
            ) + 1,
          ),
        },
      });
      return created;
    });
    return NextResponse.json(attachmentMeta(row), {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json(
      {
        error:
          message === "UPLOAD_CONFLICT"
            ? "Идентификатор файла уже используется"
            : message === "TASK_MISSING"
              ? "Задача удалена. Обновите данные."
              : "Не удалось сохранить файл. Повторите загрузку.",
      },
      {
        status:
          message === "UPLOAD_CONFLICT"
            ? 409
            : message === "TASK_MISSING"
              ? 404
              : 500,
      },
    );
  }
}
