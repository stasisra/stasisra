import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { attachmentMeta, attachmentSelect } from "@/lib/attachmentMeta";
const MAX = 10 * 1024 * 1024;
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
      { error: "Максимальный размер — 10 МБ" },
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
        { error: "Максимальный размер — 10 МБ" },
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
      { error: "Максимальный размер — 10 МБ" },
      { status: 413 },
    );
  const row = await prisma.attachment.create({
    data: {
      taskId: id,
      name: file.name.slice(0, 255),
      type: file.type || "application/octet-stream",
      size: file.size,
      data: new Uint8Array(await file.arrayBuffer()),
    },
    select: attachmentSelect,
  });
  return NextResponse.json(attachmentMeta(row), { status: 201 });
}
