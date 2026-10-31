import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Context) {
  if (!(await getSession()))
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { id } = await ctx.params;
  const file = await prisma.attachment.findUnique({ where: { id } });
  if (!file)
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "sandbox",
    },
  });
}
export async function DELETE(_req: Request, ctx: Context) {
  if (!(await getSession()))
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { id } = await ctx.params;
  await prisma.attachment.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
