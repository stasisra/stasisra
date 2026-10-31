import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import path from "node:path";
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
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 24 });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.font(path.join(process.cwd(), "assets/fonts/DejaVuSans.ttf"));
  doc.fontSize(16).text("Задачи");
  doc.moveDown();
  const widths = [240, 105, 105, 85, 35, 100, 100];
  const labels = [
    "Задача",
    "Исполнитель",
    "Ответственный",
    "Статус",
    "%",
    "Начало",
    "Окончание",
  ];
  const draw = (values: string[], y: number, height: number) => {
    let x = 24;
    values.forEach((value, i) => {
      doc
        .fontSize(8)
        .text(value, x + 3, y + 3, {
          width: widths[i] - 6,
          height: height - 4,
          ellipsis: true,
        });
      x += widths[i];
    });
    doc
      .moveTo(24, y + height)
      .lineTo(doc.page.width - 24, y + height)
      .strokeColor("#dddddd")
      .stroke();
  };
  let y = doc.y;
  draw(labels, y, 24);
  y += 24;
  for (const t of rows) {
    const values = [
      "  ".repeat(t.level) + t.title,
      t.executorName || t.executor?.name || "—",
      t.responsibleName || t.responsible?.name || "—",
      t.status,
      `${t.percentComplete}%`,
      t.startDate.toISOString().slice(0, 10),
      t.endDate.toISOString().slice(0, 10),
    ];
    doc.fontSize(8);
    const height = Math.min(
      100,
      Math.max(
        24,
        ...values.map(
          (v, i) => doc.heightOfString(v, { width: widths[i] - 6 }) + 8,
        ),
      ),
    );
    if (y + height > doc.page.height - 24) {
      doc.addPage();
      y = 24;
      draw(labels, y, 24);
      y += 24;
    }
    draw(values, y, height);
    y += height;
  }
  doc.end();
  const result = await output;
  return new NextResponse(new Uint8Array(result), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=tasks.pdf",
      "Cache-Control": "no-store",
    },
  });
}
