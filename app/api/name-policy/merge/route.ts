import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { mergeDictionary } from "@/lib/dictionaryMerge";
export async function POST(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (
    !body ||
    !["executorName", "responsibleName"].includes(body.field) ||
    typeof body.from !== "string" ||
    typeof body.to !== "string"
  )
    return NextResponse.json(
      { error: "Некорректные параметры" },
      { status: 400 },
    );
  try {
    return NextResponse.json({
      ok: true,
      changed: await mergeDictionary(
        session,
        body.field === "executorName" ? "executors" : "responsibles",
        body.from,
        body.to,
        body.scope === "GLOBAL",
      ),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Не удалось объединить значения",
      },
      { status: 400 },
    );
  }
}
