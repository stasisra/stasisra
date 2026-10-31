import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryTasks } from "@/lib/tasks";
import { exportRows, csvCell } from "@/lib/export";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const rows = exportRows(
    await queryTasks(session, new URL(req.url).searchParams, true),
  );
  const lines = [
    [
      "id",
      "title",
      "description",
      "startDate",
      "endDate",
      "executor",
      "responsible",
      "percentComplete",
      "status",
      "priority",
      "parentTaskId",
      "tags",
      "sortOrder",
    ].join(","),
  ];
  for (const t of rows)
    lines.push(
      [
        t.id,
        t.title,
        t.description,
        t.startDate.toISOString().slice(0, 10),
        t.endDate.toISOString().slice(0, 10),
        t.executorName || t.executor?.name,
        t.responsibleName || t.responsible?.name,
        t.percentComplete,
        t.status,
        t.priority,
        t.parentTaskId,
        t.tags,
        t.sortOrder,
      ]
        .map(csvCell)
        .join(","),
    );
  return new NextResponse("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=tasks.csv",
      "Cache-Control": "no-store",
    },
  });
}
