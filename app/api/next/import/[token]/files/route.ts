import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { workspaceDb, WorkspaceError } from "@/lib/workspace/database";
import { multipart } from "@/lib/product/http";
import { stageImportFile } from "@/lib/product/import";
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const form = await multipart(req, 20 * 1024 * 1024 + 65536),
      file = form.get("file"),
      id = form.get("id");
    if (!(file instanceof File) || typeof id !== "string")
      throw new WorkspaceError("Выберите файл");
    const { token } = await ctx.params;
    return NextResponse.json(
      stageImportFile(
        workspaceDb(),
        user,
        token,
        id,
        Buffer.from(await file.arrayBuffer()),
      ),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Не удалось загрузить файл",
      },
      { status: error instanceof WorkspaceError ? error.status : 400 },
    );
  }
}
