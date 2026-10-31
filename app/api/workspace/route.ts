import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSession } from "@/lib/auth";
import { workspaceDb, WorkspaceError } from "@/lib/workspace/database";
import { workspaceAction, workspaceSnapshot } from "@/lib/workspace/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { error: "Некорректный JSON" },
      { status: 400, headers },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues.map((i) => i.message).join("; ") },
      { status: 400, headers },
    );
  if (error instanceof WorkspaceError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers },
    );
  console.error(
    "Workspace operation failed",
    error instanceof Error ? error.name : "unknown",
  );
  return NextResponse.json(
    {
      error:
        "Не удалось выполнить операцию. Данные не изменены. Проверьте обновление базы и повторите.",
    },
    { status: 500, headers },
  );
}
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Требуется вход администратора" },
      { status: 401, headers },
    );
  try {
    return NextResponse.json(workspaceSnapshot(workspaceDb(), session), {
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: "Требуется вход администратора" },
      { status: 401, headers },
    );
  try {
    const reader = req.body?.getReader();
    if (!reader) throw new WorkspaceError("Пустой запрос");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new WorkspaceError("Слишком большой запрос", 413);
      }
      chunks.push(value);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return NextResponse.json(workspaceAction(workspaceDb(), session, input), {
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}
