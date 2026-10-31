import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { queryTasks } from "@/lib/tasks";
import { exportRows } from "@/lib/export";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const rows = exportRows(
    await queryTasks(session, new URL(req.url).searchParams, true),
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Задачи");
  ws.columns = [
    { header: "Задача", key: "title", width: 50 },
    { header: "Описание", key: "description", width: 50 },
    { header: "Исполнитель", key: "executor", width: 24 },
    { header: "Ответственный", key: "responsible", width: 24 },
    { header: "Статус", key: "status", width: 18 },
    { header: "%", key: "percent", width: 8 },
    { header: "Начало", key: "start", width: 14 },
    { header: "Окончание", key: "end", width: 14 },
    { header: "Теги", key: "tags", width: 30 },
    { header: "Последний комментарий", key: "comment", width: 50 },
  ];
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.getRow(1).font = { bold: true };
  for (const t of rows) {
    const row = ws.addRow({
      title: "  ".repeat(t.level) + t.title,
      description: t.description || "",
      executor: t.executorName || t.executor?.name || "",
      responsible: t.responsibleName || t.responsible?.name || "",
      status: t.status,
      percent: t.percentComplete,
      start: t.startDate.toISOString().slice(0, 10),
      end: t.endDate.toISOString().slice(0, 10),
      tags: t.tags || "",
      comment: t.comments[0]?.body || "",
    });
    row.alignment = { vertical: "top", wrapText: true };
  }
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ws.columns.length },
  };
  const data = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(data as ArrayBuffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=tasks.xlsx",
      "Cache-Control": "no-store",
    },
  });
}
