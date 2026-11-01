import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { workspaceDb, WorkspaceError } from "@/lib/workspace/database";
import { applyReview } from "@/lib/product/import";
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const { token } = await ctx.params;
    return NextResponse.json(applyReview(workspaceDb(), user, token), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Не удалось импортировать",
      },
      { status: error instanceof WorkspaceError ? error.status : 400 },
    );
  }
}
