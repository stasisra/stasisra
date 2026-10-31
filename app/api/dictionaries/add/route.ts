// app/api/dictionaries/add/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isAdmin, userIdFromSession } from "@/lib/taskQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DictType = "tags" | "executors" | "responsibles";

function normSpaces(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function mapTypeToField(type: DictType) {
  if (type === "tags") return "tags";
  if (type === "executors") return "executorName";
  return "responsibleName";
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const type = normSpaces(String(body.type ?? "")) as DictType;
  if (type !== "tags" && type !== "executors" && type !== "responsibles") {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const value = normSpaces(String(body.value ?? ""));
  if (!value)
    return NextResponse.json({ error: "Empty value" }, { status: 400 });

  if (type === "tags" && value.includes(",")) {
    return NextResponse.json(
      { error: "Tag cannot contain comma" },
      { status: 400 },
    );
  }

  const scopeIn = normSpaces(String(body.scope ?? "ME")); // "ME" | "GLOBAL"
  const userId = userIdFromSession(session);
  const scope = scopeIn === "GLOBAL" ? "GLOBAL" : userId;

  if (scope === "GLOBAL" && !isAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const field = mapTypeToField(type);

  // add = гарантируем, что элемент существует и активен (hidden=false)
  await prisma.namePolicy.upsert({
    where: { scope_field_value: { scope, field, value } } as any,
    create: { scope, field, value, hidden: false },
    update: { hidden: false },
  });

  return NextResponse.json({ ok: true });
}
