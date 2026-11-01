import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { workspaceDb, WorkspaceError } from "@/lib/workspace/database";
import { multipart } from "@/lib/product/http";
import { previewReview } from "@/lib/product/import";
export async function POST(req: Request) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const form = await multipart(req, 48 * 1024 * 1024),
      data = form.get("data"),
      workbook = form.get("workbook");
    if (!(data instanceof File) || !(workbook instanceof File))
      throw new WorkspaceError("Выберите data.json и tasks-review.xlsx");
    return NextResponse.json(
      await previewReview(
        workspaceDb(),
        user,
        await data.text(),
        Buffer.from(await workbook.arrayBuffer()),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Не удалось прочитать файлы",
      },
      { status: error instanceof WorkspaceError ? error.status : 400 },
    );
  }
}
