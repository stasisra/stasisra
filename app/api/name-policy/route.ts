import { dictionaryItems } from "@/lib/dictionaries";
// app/api/name-policy/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isAdmin, userIdFromSession } from "@/lib/taskQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = new Set(["executorName", "responsibleName"]);
type Field = "executorName" | "responsibleName";

function norm(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * GET /api/name-policy?field=executorName&mode=hybrid|global|personal
 * Возвращает список значений из задач (count + lastUsed) + признак hidden по режиму.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const field = sp.get("field");
  if (field !== "executorName" && field !== "responsibleName")
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  const mode = sp.get("mode") || "hybrid";
  const scopes =
    mode === "global"
      ? ["GLOBAL"]
      : mode === "personal"
        ? [session.id]
        : ["GLOBAL", session.id];
  return NextResponse.json({
    field,
    mode,
    items: await dictionaryItems(
      session,
      field === "executorName" ? "executors" : "responsibles",
      scopes,
    ),
  });
}

/**
 * POST /api/name-policy
 * body: { field, scope: "GLOBAL"|"ME", value, hidden }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const field = norm(String(body.field ?? "")) as Field;
  if (!FIELDS.has(field))
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });

  const scopeIn = norm(String(body.scope ?? "ME"));
  const hidden = Boolean(body.hidden);
  const value = norm(String(body.value ?? ""));
  if (!value)
    return NextResponse.json({ error: "Empty value" }, { status: 400 });

  const userId = userIdFromSession(session);

  // scope rules
  const scope = scopeIn === "GLOBAL" ? "GLOBAL" : userId;
  if (scope === "GLOBAL" && !isAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.namePolicy.upsert({
    where: { scope_field_value: { scope, field, value } } as any,
    create: { scope, field, value, hidden },
    update: { hidden },
  });

  return NextResponse.json({ ok: true });
}
