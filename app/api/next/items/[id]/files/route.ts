import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { workspaceDb, WorkspaceError } from "@/lib/workspace/database";
import { saveFile, MAX_FILE } from "@/lib/product/files";
type Context = { params: Promise<{ id: string }> };
export async function POST(req: Request, ctx: Context) {
  if (!(await getSession()))
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    if (Number(req.headers.get("content-length")) > MAX_FILE + 65536)
      throw new WorkspaceError("Максимальный размер — 20 МБ", 413);
    const reader = req.body?.getReader();
    if (!reader) throw new WorkspaceError("Файл не передан");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_FILE + 65536) {
        await reader.cancel();
        throw new WorkspaceError("Максимальный размер — 20 МБ", 413);
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": req.headers.get("content-type") || "" },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new WorkspaceError("Выберите файл");
    const { id } = await ctx.params;
    return NextResponse.json(
      saveFile(workspaceDb(), id, {
        id: form.get("uploadId") ? String(form.get("uploadId")) : undefined,
        name: file.name,
        type: file.type,
        data: new Uint8Array(await file.arrayBuffer()),
      }),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof WorkspaceError
            ? error.message
            : "Не удалось загрузить файл. Повторите попытку.",
      },
      { status: error instanceof WorkspaceError ? error.status : 400 },
    );
  }
}
