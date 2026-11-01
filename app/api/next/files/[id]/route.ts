import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { workspaceDb, WorkspaceError } from "@/lib/workspace/database";
import { unlinkFile } from "@/lib/product/files";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Context) {
  if (!(await getSession()))
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { id } = await ctx.params;
  const file = workspaceDb()
    .prepare("SELECT * FROM ContentFile WHERE id=?")
    .get(id) as any;
  if (!file)
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition":
        "attachment; filename*=UTF-8''" +
        encodeURIComponent(file.name).replace(
          /[!'()*]/g,
          (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
        ),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "sandbox",
    },
  });
}
export async function DELETE(req: Request, ctx: Context) {
  if (!(await getSession()))
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const { id } = await ctx.params,
      itemId = new URL(req.url).searchParams.get("itemId");
    if (!itemId)
      throw new WorkspaceError(
        "Укажите карточку, из которой нужно убрать файл",
      );
    unlinkFile(workspaceDb(), itemId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof WorkspaceError
            ? error.message
            : "Не удалось убрать файл",
      },
      { status: error instanceof WorkspaceError ? error.status : 500 },
    );
  }
}
