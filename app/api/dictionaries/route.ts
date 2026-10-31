import { dictionaryItems } from "@/lib/dictionaries";
// app/api/dictionaries/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { userIdFromSession } from "@/lib/taskQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DictType = "tags" | "executors" | "responsibles";

function asStr(v: unknown) {
  return typeof v === "string" ? v : "";
}

function normSpaces(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const type = new URL(req.url).searchParams.get("type");
  if (type !== "tags" && type !== "executors" && type !== "responsibles")
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  return NextResponse.json(
    { type, items: await dictionaryItems(session, type) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}) as any);

  const type = asStr(body?.type) as DictType;
  if (type !== "tags" && type !== "executors" && type !== "responsibles") {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const action = asStr(body?.action); // upsert | hide | unhide | remove
  const rawValue = normSpaces(asStr(body?.value));
  if (!rawValue) {
    return NextResponse.json({ error: "Missing value" }, { status: 400 });
  }

  const userId = userIdFromSession(session);
  const scope = asStr(body?.scope) === "GLOBAL" ? "GLOBAL" : userId;
  if (scope === "GLOBAL" && session.role !== "ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 }); // MVP: default user-scope

  // map dict type -> NamePolicy.field
  const field =
    type === "tags"
      ? "tags"
      : type === "executors"
        ? "executorName"
        : "responsibleName";

  if (
    action !== "upsert" &&
    action !== "hide" &&
    action !== "unhide" &&
    action !== "remove"
  ) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (action === "remove") {
    await prisma.namePolicy.deleteMany({
      where: { scope, field, value: rawValue },
    });
    return NextResponse.json({ ok: true });
  }

  const hidden = action === "hide" ? true : action === "unhide" ? false : false;

  // upsert/hide/unhide -> NamePolicy upsert
  await prisma.namePolicy.upsert({
    where: {
      scope_field_value: {
        scope,
        field,
        value: rawValue,
      },
    },
    create: {
      scope,
      field,
      value: rawValue,
      hidden,
    },
    update: {
      hidden,
      value: rawValue,
    },
  });

  return NextResponse.json({ ok: true });
}
