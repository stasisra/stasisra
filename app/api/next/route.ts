import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { workspaceDb, WorkspaceError } from "@/lib/workspace/database";
import { productSnapshot, productAction } from "@/lib/product/service";
export async function GET() {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    return NextResponse.json(productSnapshot(workspaceDb(), user), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      "Product load failed",
      error instanceof Error ? error.name : "error",
    );
    return NextResponse.json(
      { error: "Завершите подготовку базы новой версии: npm run db:init" },
      { status: 503 },
    );
  }
}
export async function POST(req: Request) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const bytes = await req.text();
    if (Buffer.byteLength(bytes) > 2 * 1024 * 1024)
      return NextResponse.json(
        { error: "Слишком большой запрос" },
        { status: 413 },
      );
    return NextResponse.json(
      productAction(workspaceDb(), user, JSON.parse(bytes)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof WorkspaceError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    return NextResponse.json(
      {
        error:
          error instanceof WorkspaceError
            ? error.message
            : error instanceof z.ZodError
              ? error.issues[0]?.message || "Некорректные данные"
              : "Не удалось сохранить. Повторите действие.",
      },
      { status },
    );
  }
}
