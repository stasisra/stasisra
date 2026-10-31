import { queryTasks } from "@/lib/tasks";
import { todayYmd, utcDate } from "@/lib/dates";
// app/(app)/dashboard/focus/print/page.tsx
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TZ = "Asia/Jerusalem";
type SortKey = "due" | "updated" | "executor" | "responsible";

function splitTags(s?: string | null) {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// timezone-safe start of day
function getTzOffsetMs(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const y = get("year");
  const m = get("month");
  const d = get("day");
  const h = get("hour");
  const mi = get("minute");
  const s = get("second");

  const asUTC = Date.UTC(y, m - 1, d, h, mi, s);
  return asUTC - date.getTime();
}

function startOfDayInTZ(timeZone: string, now = new Date()) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const y = get("year");
  const m = get("month");
  const d = get("day");

  const utcMid = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const off = getTzOffsetMs(utcMid, timeZone);
  return new Date(utcMid.getTime() - off);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function fmtDateTime(d: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function fmtDateOnly(d: Date) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(d);
}

function asStr(v: unknown) {
  if (Array.isArray(v)) return String(v[0] ?? "");
  return typeof v === "string" ? v : "";
}

function parseCsv(s: string) {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseYMD(s: string) {
  const v = (s ?? "").trim();
  if (!v) return null;
  // expecting YYYY-MM-DD
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ✅ Важно: пустая строка -> fallback, а не 1.
 * Потому что Number("") = 0 и clamp превращает в min=1.
 */
function clampIntFromQuery(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  const s = asStr(raw).trim();
  if (!s) return fallback;
  const x = Number(s);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.round(x)));
}

export default async function FocusPrintPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) return null;

  const matchedTasks = await queryTasks(session, searchParams);
  const matchedWhere = { id: { in: matchedTasks.map((t) => t.id) } };
  const todayStart = utcDate(todayYmd());

  /**
   * ✅ Read URL params (aligned with dashboard canonical schema)
   * Canonical:
   *  - ex, resp, tin, tex, d_tagMode, d_sort, d_focus, d_focusFrom, d_focusTo
   * Legacy:
   *  - executor, responsible, tagsPick, tagsHide, tagMode, sort, focusDays
   */
  const executorPick = asStr(searchParams?.ex) || asStr(searchParams?.executor);
  const responsiblePick =
    asStr(searchParams?.resp) || asStr(searchParams?.responsible);

  const tagsPick = parseCsv(
    asStr(searchParams?.tin) || asStr(searchParams?.tagsPick),
  );
  const tagsHide = parseCsv(
    asStr(searchParams?.tex) || asStr(searchParams?.tagsHide),
  );

  const tagMode = (
    (asStr(searchParams?.tagMode) || asStr(searchParams?.d_tagMode)) === "AND"
      ? "AND"
      : "OR"
  ) as "OR" | "AND";

  const sort = ((): SortKey => {
    const s = asStr(searchParams?.d_sort) || asStr(searchParams?.sort);
    if (
      s === "updated" ||
      s === "executor" ||
      s === "responsible" ||
      s === "due"
    )
      return s;
    return "due";
  })();

  // ===== Focus (preset OR custom range) =====
  const focusDays = clampIntFromQuery(
    asStr(searchParams?.d_focus) || asStr(searchParams?.focusDays),
    1,
    90,
    7,
  );
  const nextFocusStart = addDays(todayStart, focusDays);

  const focusFromStr = asStr(searchParams?.d_focusFrom);
  const focusToStr = asStr(searchParams?.d_focusTo);

  const focusFromRaw = parseYMD(focusFromStr);
  const focusToRaw = parseYMD(focusToStr);

  const focusFrom = focusFromRaw ? startOfDayInTZ(TZ, focusFromRaw) : null;
  const focusTo = focusToRaw ? startOfDayInTZ(TZ, focusToRaw) : null;

  const hasCustomFocus = !!(
    focusFrom &&
    focusTo &&
    focusFrom.getTime() <= focusTo.getTime()
  );

  const focusRangeStart = hasCustomFocus ? (focusFrom as Date) : todayStart;
  const focusRangeEndExclusive = hasCustomFocus
    ? addDays(focusTo as Date, 1)
    : nextFocusStart;

  // ====== where builder for tags ======
  const tagCond = (tag: string) => ({
    OR: [
      { tags: { contains: tag } },
      { tags: { contains: `,${tag},` } },
      { tags: { contains: `${tag},` } },
      { tags: { contains: `,${tag}` } },
    ],
  });

  const tagsWhere =
    tagsPick.length === 0
      ? {}
      : tagMode === "OR"
        ? { OR: tagsPick.map(tagCond) }
        : { AND: tagsPick.map(tagCond) };

  // ✅ hide: исключаем задачи, содержащие ЛЮБОЙ из tagsHide
  const hideWhere =
    tagsHide.length === 0 ? {} : { NOT: { OR: tagsHide.map(tagCond) } };

  const executorWhere = executorPick
    ? {
        OR: [
          { executorName: executorPick },
          { executor: { is: { name: executorPick } } },
        ],
      }
    : {};

  const responsibleWhere = responsiblePick
    ? {
        OR: [
          { responsibleName: responsiblePick },
          { responsible: { is: { name: responsiblePick } } },
        ],
      }
    : {};

  // ✅ правильная сборка where: через AND, без перетирания OR/AND/NOT
  const and: any[] = [matchedWhere];
  if (Object.keys(tagsWhere).length) and.push(tagsWhere);
  if (Object.keys(hideWhere).length) and.push(hideWhere);
  if (Object.keys(executorWhere).length) and.push(executorWhere);
  if (Object.keys(responsibleWhere).length) and.push(responsibleWhere);

  const filterWhere = matchedWhere;

  const orderByFocus = (() => {
    if (sort === "updated") return [{ updatedAt: "desc" as const }];
    if (sort === "executor")
      return [{ executorName: "asc" as const }, { updatedAt: "desc" as const }];
    if (sort === "responsible")
      return [
        { responsibleName: "asc" as const },
        { updatedAt: "desc" as const },
      ];
    return [{ endDate: "asc" as const }, { updatedAt: "desc" as const }];
  })();

  const focus = await prisma.task.findMany({
    where: {
      ...filterWhere,
      status: { not: "DONE" },
      endDate: { gte: focusRangeStart, lt: focusRangeEndExclusive },
    },
    orderBy: orderByFocus,
    take: 200,
    include: {
      executor: { select: { id: true, name: true } },
      responsible: { select: { id: true, name: true } },
      parentTask: { select: { id: true, title: true } },
      subtasks: {
        select: {
          id: true,
          title: true,
          status: true,
          percentComplete: true,
          endDate: true,
          tags: true,
        },
        orderBy: [{ endDate: "asc" as const }],
        take: 8,
      },
      comments: {
        select: { body: true, createdAt: true },
        orderBy: { createdAt: "desc" as const },
        take: 3,
      },
    },
  });

  const dayMs = 24 * 60 * 60 * 1000;

  const focusTitle = hasCustomFocus
    ? `Фокус: ${fmtDateOnly(focusRangeStart)} — ${fmtDateOnly(addDays(focusRangeEndExclusive, -1))}`
    : `Фокус: ближайшие ${focusDays} дней`;

  return (
    <div className="p-6">
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  a, button, input, select, textarea { display: none !important; }
  header, nav, footer { display: none !important; }
  .no-print { display: none !important; }
  .app-header, .app-nav, .topbar, .navbar { display: none !important; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .task-card { break-inside: avoid; page-break-inside: avoid; }
}
          `,
        }}
      />

      <div className="mb-4">
        <div className="text-2xl font-semibold">{focusTitle}</div>
        <div className="mt-1 text-sm text-slate-600">
          Сформировано:{" "}
          <span className="font-medium">{fmtDateTime(new Date())}</span>
        </div>

        <div className="mt-2 text-xs text-slate-600">
          Фильтры: {executorPick ? `исполнитель: ${executorPick}; ` : ""}
          {responsiblePick ? `ответственный: ${responsiblePick}; ` : ""}
          {tagsPick.length ? `теги: ${tagsPick.join(", ")} (${tagMode}); ` : ""}
          {tagsHide.length ? `скрыто: ${tagsHide.join(", ")}; ` : ""}
          сортировка: {sort}
        </div>
      </div>

      {focus.length === 0 ? (
        <div className="text-sm text-slate-700">
          {hasCustomFocus
            ? "Нет задач с дедлайном в выбранном диапазоне."
            : `Нет задач с дедлайном в ближайшие ${focusDays} дней.`}
        </div>
      ) : (
        <div className="space-y-3">
          {focus.map((t: any) => {
            const end = t.endDate ? new Date(t.endDate) : null;
            const daysLeft = end
              ? Math.max(
                  0,
                  Math.ceil((end.getTime() - todayStart.getTime()) / dayMs),
                )
              : null;

            const executorLabel = t.executor?.name ?? t.executorName ?? "—";
            const responsibleLabel =
              t.responsible?.name ?? t.responsibleName ?? "—";
            const tagsArr = splitTags(t.tags);
            const parent = t.parentTask ?? null;
            const kids = Array.isArray(t.subtasks) ? t.subtasks : [];

            const desc = String(t.description ?? "").trim();

            const comments = Array.isArray(t.comments)
              ? t.comments
                  .map((c: any) => ({
                    body: String(c?.body ?? "").trim(),
                    createdAt: c?.createdAt ? new Date(c.createdAt) : null,
                  }))
                  .filter((c: any) => c.body.length > 0)
              : [];

            return (
              <div
                key={t.id}
                className="task-card rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_620px]">
                  <div className="min-w-0">
                    {parent && (
                      <div className="text-xs text-slate-500">
                        Родитель:{" "}
                        <span className="font-medium">{parent.title}</span>
                      </div>
                    )}

                    <div className="mt-0.5 text-base font-semibold">
                      {t.title}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-700">
                      <span className="rounded-full border border-slate-200 px-2 py-0.5">
                        {t.status}
                      </span>
                      <span className="rounded-full border border-slate-200 px-2 py-0.5">
                        {t.percentComplete}%
                      </span>

                      {end ? (
                        <>
                          <span>
                            Дедлайн:{" "}
                            <span className="font-medium">
                              {fmtDateTime(end)}
                            </span>
                          </span>
                          {daysLeft !== null && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-900">
                              осталось {daysLeft} дн.
                            </span>
                          )}
                        </>
                      ) : (
                        <span>Дедлайн: —</span>
                      )}

                      <span>
                        · Исполнитель: {executorLabel} · Ответственный:{" "}
                        {responsibleLabel}
                      </span>
                    </div>

                    {tagsArr.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tagsArr.slice(0, 10).map((tg: string) => (
                          <span
                            key={tg}
                            className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-700"
                          >
                            {tg}
                          </span>
                        ))}
                        {tagsArr.length > 10 && (
                          <span className="text-xs text-slate-500">
                            ещё {tagsArr.length - 10}
                          </span>
                        )}
                      </div>
                    )}

                    {kids.length > 0 && (
                      <div className="mt-2">
                        <div className="text-xs text-slate-500">Дети:</div>
                        <div className="mt-1 space-y-1">
                          {kids.slice(0, 8).map((k: any) => (
                            <div
                              key={k.id}
                              className="flex items-center gap-2 text-xs"
                            >
                              <span className="text-slate-400">↳</span>
                              <span className="truncate">{k.title}</span>
                              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-700">
                                {k.status}
                              </span>
                              <span className="text-slate-500">
                                {k.percentComplete}%
                              </span>
                            </div>
                          ))}
                          {kids.length > 8 && (
                            <div className="text-xs text-slate-500">
                              ещё {kids.length - 8}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-480">
                      Описание
                    </div>
                    {desc ? (
                      <div className="mt-2 text-sm text-slate-900 whitespace-pre-wrap">
                        {desc}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-slate-400">—</div>
                    )}

                    <div className="mt-4 border-t border-slate-200 pt-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Комментарии
                      </div>

                      {comments.length > 0 ? (
                        <div className="mt-2 space-y-2">
                          {comments.slice(0, 3).map((c: any, idx: number) => (
                            <div
                              key={idx}
                              className="rounded-md border border-slate-200 bg-white px-2 py-2"
                            >
                              <div className="text-[11px] text-slate-500">
                                {c.createdAt ? fmtDateTime(c.createdAt) : ""}
                              </div>
                              <div className="mt-1 text-sm text-slate-900 whitespace-pre-wrap">
                                {c.body}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-slate-400">—</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
