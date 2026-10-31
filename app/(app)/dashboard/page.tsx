import { getFilterOptions } from "@/lib/filterOptions";
import { queryTasks } from "@/lib/tasks";
import { todayYmd, utcDate } from "@/lib/dates";
// app/(app)/dashboard/page.tsx
import { Card, Badge, Button } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scopeWhere } from "@/lib/taskQuery";
import { TaskAttachmentsInline } from "@/components/TaskAttachmentsInline";
import TaskLink from "@/components/TaskLink";
import TaskFiltersSheet from "@/components/TaskFiltersSheet";
// import RememberQuery from "@/components/RememberQuery";
import RememberGlobalFilters from "@/components/RememberGlobalFilters";

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
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
  }).format(d);
}

function parseYMD(s: string) {
  const v = (s ?? "").trim();
  if (!v) return null;
  // expecting YYYY-MM-DD
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ✅ ВАЖНО: пустая строка => fallback
 * Иначе Number("") = 0 -> clamp -> 1 день
 */
function clampInt(n: unknown, min: number, max: number, fallback: number) {
  if (typeof n === "string" && n.trim() === "") return fallback;
  const x = typeof n === "string" ? Number(n) : typeof n === "number" ? n : NaN;
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.round(x)));
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

function toURLSearchParams(obj?: {
  [key: string]: string | string[] | undefined;
}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, String(v[0] ?? ""));
    } else {
      p.set(k, v);
    }
  }
  return p;
}

function setOrDelete(
  p: URLSearchParams,
  key: string,
  value: string | null | undefined,
) {
  const v = (value ?? "").trim();
  if (!v) p.delete(key);
  else p.set(key, v);
}

function setCsvOrDelete(p: URLSearchParams, key: string, arr: string[]) {
  const clean = arr.map((x) => x.trim()).filter(Boolean);
  if (!clean.length) p.delete(key);
  else p.set(key, clean.join(","));
}

export default async function DashboardPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) return null;

  const baseWhere = scopeWhere(session);
  const matchedTasks = await queryTasks(session, searchParams);
  const matchedWhere = { id: { in: matchedTasks.map((t) => t.id) } };

  // ===== dates =====
  const todayStart = utcDate(todayYmd());

  /**
   * ✅ URL keys strategy:
   * - Canonical "global" filters (shared): ex, resp, tin, tex
   * - Dashboard-only (view): d_focus, d_focusFrom, d_focusTo, d_commentsDays, d_sort, d_tagMode
   *
   * ✅ Backward compatibility:
   * - also accept legacy keys executor/responsible/tagsPick/tagsHide/tagMode/sort/commentsDays/focusDays
   * - also accept legacy showDone
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

  const tagMode: "OR" | "AND" =
    (asStr(searchParams?.tagMode) || asStr(searchParams?.d_tagMode)) === "AND"
      ? "AND"
      : "OR";

  const sort: SortKey = (() => {
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

  const commentsDays = clampInt(
    asStr(searchParams?.d_commentsDays) || asStr(searchParams?.commentsDays),
    1,
    90,
    14,
  );
  const commentsSince = addDays(todayStart, -commentsDays);

  // ===== Focus (preset OR custom range) =====
  const focusDays = clampInt(
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

  // Итоговые границы для Prisma:
  // - preset: [todayStart, nextFocusStart)
  // - custom: [focusFrom, focusTo + 1day)
  const focusRangeStart = hasCustomFocus ? (focusFrom as Date) : todayStart;
  const focusRangeEndExclusive = hasCustomFocus
    ? addDays(focusTo as Date, 1)
    : nextFocusStart;

  // ✅ DONE toggle (checkbox): done=1 => показывать DONE, иначе скрывать
  const showDone =
    asStr(searchParams?.done) === "1" || asStr(searchParams?.showDone) === "1";
  const doneWhere = showDone ? {} : { status: { not: "DONE" as const } };

  // ===== where builder for tags =====
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

  // ✅ ключевое исправление: собираем через AND, чтобы не перетирать OR/AND/NOT
  const and: any[] = [baseWhere];
  if (Object.keys(tagsWhere).length) and.push(tagsWhere);
  if (Object.keys(hideWhere).length) and.push(hideWhere);
  if (Object.keys(executorWhere).length) and.push(executorWhere);
  if (Object.keys(responsibleWhere).length) and.push(responsibleWhere);

  const dashWhere = matchedWhere;

  // ===== sorting presets =====
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

  const orderByRecent = (() => {
    if (sort === "due")
      return [{ endDate: "asc" as const }, { updatedAt: "desc" as const }];
    if (sort === "executor")
      return [{ executorName: "asc" as const }, { updatedAt: "desc" as const }];
    if (sort === "responsible")
      return [
        { responsibleName: "asc" as const },
        { updatedAt: "desc" as const },
      ];
    return [{ updatedAt: "desc" as const }];
  })();

  const taskInclude = {
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
      take: 5,
    },
  };

  const { executorOptions, responsibleOptions, tagOptions } =
    await getFilterOptions(session, baseWhere);

  // ===== data =====
  const [
    total,
    planned,
    inProgress,
    paused,
    done,
    overdue,
    focus,
    overdueTop,
    recent,
    recentComments,
  ] = await Promise.all([
    prisma.task.count({ where: dashWhere }),
    prisma.task.count({ where: { ...dashWhere, status: "PLANNED" } }),
    prisma.task.count({ where: { ...dashWhere, status: "IN_PROGRESS" } }),
    prisma.task.count({ where: { ...dashWhere, status: "PAUSED" } }),
    prisma.task.count({ where: { ...dashWhere, status: "DONE" } }),

    prisma.task.count({
      where: {
        ...dashWhere,
        status: { not: "DONE" },
        endDate: { lt: todayStart },
      },
    }),

    prisma.task.findMany({
      where: {
        ...dashWhere,
        status: { not: "DONE" },
        endDate: { gte: focusRangeStart, lt: focusRangeEndExclusive },
      },
      orderBy: orderByFocus,
      take: 10,
      include: taskInclude,
    }),

    prisma.task.findMany({
      where: {
        ...dashWhere,
        status: { not: "DONE" },
        endDate: { lt: todayStart },
      },
      orderBy: orderByFocus,
      take: 5,
      include: taskInclude,
    }),

    prisma.task.findMany({
      where: {
        ...dashWhere,
        ...doneWhere,
      },
      orderBy: orderByRecent,
      take: 6,
      include: taskInclude,
    }),

    prisma.taskComment.findMany({
      where: {
        createdAt: { gte: commentsSince },
        task: {
          ...(dashWhere as any),
          ...(doneWhere as any),
        },
      },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: {
        author: { select: { id: true, name: true } },
        task: { include: taskInclude },
      },
    }),
  ]);

  /**
   * ✅ buildQS: starts from current URL params (so we never drop unknown/future filters),
   * then normalizes canonical keys + applies optional overrides for dashboard-only params.
   */
  const buildQS = (
    overrides?: Partial<{
      d_focus: number;
      d_commentsDays: number;
      d_focusFrom: string | null;
      d_focusTo: string | null;
    }>,
  ) => {
    const p = toURLSearchParams(searchParams);

    // --- normalize canonical global keys (keep future-proof) ---
    setOrDelete(p, "ex", executorPick);
    setOrDelete(p, "resp", responsiblePick);
    setCsvOrDelete(p, "tin", tagsPick);
    setCsvOrDelete(p, "tex", tagsHide);

    // ✅ persist DONE toggle
    if (showDone) p.set("done", "1");
    else p.delete("done");
    p.delete("showDone"); // cleanup legacy

    // --- normalize dashboard-only keys ---
    p.set("tagMode", tagMode);
    p.delete("d_tagMode");
    p.set("d_sort", sort);

    p.set("d_commentsDays", String(overrides?.d_commentsDays ?? commentsDays));
    p.set("d_focus", String(overrides?.d_focus ?? focusDays));

    // custom focus keys (optional)
    const of = overrides?.d_focusFrom;
    const ot = overrides?.d_focusTo;

    if (of === null || ot === null) {
      p.delete("d_focusFrom");
      p.delete("d_focusTo");
    } else {
      // if overrides not provided, keep existing params untouched
      if (typeof of === "string") setOrDelete(p, "d_focusFrom", of);
      if (typeof ot === "string") setOrDelete(p, "d_focusTo", ot);
    }

    // optional: remove legacy keys so links converge to one schema
    p.delete("executor");
    p.delete("responsible");
    p.delete("tagsPick");
    p.delete("tagsHide");
    p.delete("tagMode");
    p.delete("sort");
    p.delete("commentsDays");
    p.delete("focusDays");

    return p.toString();
  };

  const withExtra = (
    qs: string,
    extra: Record<string, string | number | null | undefined>,
  ) => {
    const p = new URLSearchParams(qs);
    for (const [k, v] of Object.entries(extra)) {
      if (v === null || v === undefined || String(v).trim() === "") p.delete(k);
      else p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  const StatCard = ({
    label,
    value,
    href,
  }: {
    label: string;
    value: number;
    href: string;
  }) => (
    <a href={href} className="block">
      <Card className="p-4 transition hover:bg-slate-50">
        <div className="text-sm text-slate-600">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </Card>
    </a>
  );

  const TaskRow = ({ t }: any) => {
    const executorLabel = t.executor?.name ?? t.executorName ?? "—";
    const responsibleLabel = t.responsible?.name ?? t.responsibleName ?? "—";
    const end = t.endDate ? new Date(t.endDate) : null;

    const dayMs = 24 * 60 * 60 * 1000;

    const daysLeft = end
      ? Math.max(0, Math.ceil((end.getTime() - todayStart.getTime()) / dayMs))
      : null;

    const daysOverdue =
      end && end.getTime() < todayStart.getTime()
        ? Math.max(1, Math.ceil((todayStart.getTime() - end.getTime()) / dayMs))
        : null;

    const tagsArr = splitTags(t.tags);
    const parent = t.parentTask ?? null;
    const kids = Array.isArray(t.subtasks) ? t.subtasks : [];

    return (
      <div className="relative rounded-xl border border-slate-200 bg-white p-3">
        <TaskLink taskId={t.id} className="absolute inset-0 rounded-xl">
          <span className="sr-only">{`Открыть задачу: ${t.title}`}</span>
        </TaskLink>

        <div className="relative z-10 pointer-events-none flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {parent && (
              <div className="truncate text-xs text-slate-500">
                Родитель:{" "}
                <TaskLink
                  taskId={parent.id}
                  className="underline pointer-events-auto"
                >
                  {parent.title}
                </TaskLink>
              </div>
            )}

            <div className="truncate font-medium">{t.title}</div>

            {tagsArr.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tagsArr.slice(0, 8).map((tg: string) => (
                  <Badge key={tg}>{tg}</Badge>
                ))}
                {tagsArr.length > 8 && (
                  <span className="text-xs text-slate-500">
                    ещё {tagsArr.length - 8}
                  </span>
                )}
              </div>
            )}

            {kids.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-slate-500">Дети:</div>
                <div className="mt-1 space-y-1">
                  {kids.slice(0, 5).map((k: any) => (
                    <div key={k.id} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-400">↳</span>
                      <TaskLink
                        taskId={k.id}
                        className="truncate underline pointer-events-auto"
                        title={k.title}
                      >
                        {k.title}
                      </TaskLink>
                      <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-700">
                        {k.status}
                      </span>
                      <span className="text-slate-500">
                        {k.percentComplete}%
                      </span>
                    </div>
                  ))}
                  {kids.length > 5 && (
                    <div className="text-xs text-slate-500">
                      ещё {kids.length - 5}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              {end ? (
                <>
                  <span>
                    Дедлайн:{" "}
                    <span className="font-medium">{fmtDateTime(end)}</span>
                  </span>

                  {daysOverdue !== null ? (
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-900">
                      просрочено {daysOverdue} дн.
                    </span>
                  ) : daysLeft !== null ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                      осталось {daysLeft} дн.
                    </span>
                  ) : null}
                </>
              ) : (
                <span>Дедлайн: —</span>
              )}

              <span>
                · Исполнитель: {executorLabel} · Ответственный:{" "}
                {responsibleLabel}
              </span>
            </div>
          </div>

          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            <TaskAttachmentsInline taskId={t.id} taskTitle={t.title} />
            <Badge>{t.status}</Badge>
            <Badge>{t.percentComplete}%</Badge>
          </div>
        </div>
      </div>
    );
  };

  const DaysLink = ({ days, active }: { days: number; active: boolean }) => (
    <a
      href={`/dashboard${withExtra(buildQS(), { d_commentsDays: days })}`}
      className={`rounded-full px-3 py-1 text-sm border ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      {days} дн.
    </a>
  );

  const commentPreview = (s: string, n = 220) => {
    const t = (s ?? "").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  };

  const qs = buildQS();

  // Для формы (GET) — берём текущие параметры, чтобы не потерять фильтры
  const allParams = Array.from(toURLSearchParams(searchParams).entries());

  const focusTitle = hasCustomFocus
    ? `Фокус: ${fmtDateOnly(focusRangeStart)} — ${fmtDateOnly(addDays(focusRangeEndExclusive, -1))}`
    : `Фокус: ближайшие ${focusDays} дней`;

  // "Все" для фокуса:
  // - если preset: оставляем фильтр due={focusDays}d (как было)
  // - если custom: просто ведём на /tasks с текущими фильтрами (без due)
  const focusAllHref = hasCustomFocus
    ? `/tasks${qs ? `?${qs}` : ""}`
    : `/tasks${withExtra(qs, { due: `${focusDays}d` })}`;

  return (
    <div className="space-y-6">
      <RememberGlobalFilters />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-600">
            Фильтры и сортировка применяются ко всему дашборду.
          </p>
        </div>

        <div className="flex gap-2">
          <TaskFiltersSheet
            executorOptions={executorOptions}
            responsibleOptions={responsibleOptions}
            tagOptions={tagOptions}
            showStatus={false}
            showExpand={false}
            showDashboardView={true}
          />

          <a href={`/tasks/new${qs ? `?${qs}` : ""}`}>
            <Button>+ Задача</Button>
          </a>
          <a href="/dashboard/dictionaries?type=tags">
            <Button variant="secondary">Справочники</Button>
          </a>
          <a href={`/gantt${qs ? `?${qs}` : ""}`}>
            <Button variant="secondary">Открыть Гант</Button>
          </a>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <StatCard
          label="Всего"
          value={total}
          href={`/tasks${qs ? `?${qs}` : ""}`}
        />
        <StatCard
          label="План"
          value={planned}
          href={`/tasks${withExtra(qs, { st: "PLANNED" })}`}
        />
        <StatCard
          label="В работе"
          value={inProgress}
          href={`/tasks${withExtra(qs, { st: "IN_PROGRESS" })}`}
        />
        <StatCard
          label="Пауза"
          value={paused}
          href={`/tasks${withExtra(qs, { st: "PAUSED" })}`}
        />
        <StatCard
          label="Готово"
          value={done}
          href={`/tasks${withExtra(qs, { st: "DONE" })}`}
        />
        <StatCard
          label="Просрочено"
          value={overdue}
          href={`/tasks${withExtra(qs, { overdue: 1 })}`}
        />
      </div>

      {/* Focus + Overdue */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-base font-semibold">{focusTitle}</h2>

                <div className="flex items-center gap-2">
                  <a
                    href={`/dashboard${withExtra(qs, { d_focus: 7, d_focusFrom: null, d_focusTo: null })}`}
                    className={`rounded-full px-3 py-1 text-sm border ${
                      !hasCustomFocus && focusDays === 7
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    7 дн.
                  </a>

                  <a
                    href={`/dashboard${withExtra(qs, { d_focus: 14, d_focusFrom: null, d_focusTo: null })}`}
                    className={`rounded-full px-3 py-1 text-sm border ${
                      !hasCustomFocus && focusDays === 14
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    14 дн.
                  </a>

                  <a
                    href={`/dashboard${withExtra(qs, { d_focusFrom: null, d_focusTo: null })}`}
                    className={`rounded-full px-3 py-1 text-sm border ${
                      !hasCustomFocus
                        ? "border-slate-200 bg-white hover:bg-slate-50"
                        : "border-slate-900 bg-slate-900 text-white"
                    }`}
                    title="Сбросить произвольный диапазон"
                  >
                    Сброс
                  </a>
                </div>
              </div>

              {/* Custom focus range (GET form, server-friendly) */}
              <form
                action="/dashboard"
                method="get"
                className="flex flex-wrap items-end gap-2"
              >
                {/* сохраняем все текущие фильтры/параметры */}
                {allParams
                  .filter(([k]) => k !== "d_focusFrom" && k !== "d_focusTo")
                  .map(([k, v]) => (
                    <input key={`${k}:${v}`} type="hidden" name={k} value={v} />
                  ))}

                <div className="flex flex-col">
                  <label className="text-xs text-slate-500">с</label>
                  <input
                    type="date"
                    name="d_focusFrom"
                    defaultValue={focusFromStr || ""}
                    className="h-9 rounded-md border border-slate-200 px-2 text-sm"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-xs text-slate-500">по</label>
                  <input
                    type="date"
                    name="d_focusTo"
                    defaultValue={focusToStr || ""}
                    className="h-9 rounded-md border border-slate-200 px-2 text-sm"
                  />
                </div>

                <button
                  type="submit"
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm hover:bg-slate-50"
                >
                  Применить
                </button>

                <a
                  href={`/dashboard${withExtra(qs, { d_focusFrom: null, d_focusTo: null })}`}
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm inline-flex items-center hover:bg-slate-50"
                >
                  Очистить
                </a>

                {hasCustomFocus && (
                  <span className="text-xs text-slate-500">
                    (выбрано: {fmtDateOnly(focusRangeStart)} —{" "}
                    {fmtDateOnly(addDays(focusRangeEndExclusive, -1))})
                  </span>
                )}
              </form>
            </div>

            <div className="flex items-center gap-3">
              <a
                className="text-sm underline"
                href={`/dashboard/focus/print${qs ? `?${qs}` : ""}`}
                target="_blank"
                rel="noreferrer"
              >
                Печать / PDF
              </a>

              <a className="text-sm underline" href={focusAllHref}>
                Все
              </a>
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            {focus.map((t) => (
              <TaskRow key={t.id} t={t} />
            ))}
            {focus.length === 0 && (
              <div className="text-sm text-slate-600">
                {hasCustomFocus
                  ? "Нет задач с дедлайном в выбранном диапазоне."
                  : `Нет задач с дедлайном в ближайшие ${focusDays} дней.`}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Просрочено: top-5</h2>
            <a
              className="text-sm underline"
              href={`/tasks${withExtra(qs, { overdue: 1 })}`}
            >
              Все
            </a>
          </div>
          <div className="mt-3 grid gap-2">
            {overdueTop.map((t) => (
              <TaskRow key={t.id} t={t} />
            ))}
            {overdueTop.length === 0 && (
              <div className="text-sm text-slate-600">
                Просроченных задач нет.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Last comments */}
      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">Последние комментарии</h2>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">Период:</span>
            <DaysLink days={7} active={commentsDays === 7} />
            <DaysLink days={14} active={commentsDays === 14} />
            <DaysLink days={30} active={commentsDays === 30} />
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          {recentComments.map((c: any) => {
            const t = c.task;
            const end = t?.endDate ? new Date(t.endDate) : null;
            const dayMs = 24 * 60 * 60 * 1000;
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

            return (
              <div
                key={c.id}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    {parent && (
                      <div className="truncate text-xs text-slate-500">
                        Родитель:{" "}
                        <TaskLink taskId={parent.id} className="underline">
                          {parent.title}
                        </TaskLink>
                      </div>
                    )}

                    <div className="truncate font-medium">{t.title}</div>

                    {tagsArr.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {tagsArr.slice(0, 8).map((tg: string) => (
                          <Badge key={tg}>{tg}</Badge>
                        ))}
                        {tagsArr.length > 8 && (
                          <span className="text-xs text-slate-500">
                            ещё {tagsArr.length - 8}
                          </span>
                        )}
                      </div>
                    )}

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      {end ? (
                        <>
                          <span>
                            Дедлайн:{" "}
                            <span className="font-medium">
                              {fmtDateTime(end)}
                            </span>
                          </span>
                          {daysLeft !== null && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
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
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <TaskAttachmentsInline taskId={t.id} taskTitle={t.title} />
                    <Badge>{t.status}</Badge>
                    <Badge>{t.percentComplete}%</Badge>
                    <TaskLink taskId={t.id} className="text-sm underline">
                      Открыть
                    </TaskLink>
                  </div>
                </div>

                <div className="mt-2 rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">
                    {c.author?.name ?? "—"} ·{" "}
                    {fmtDateTime(new Date(c.createdAt))}
                  </div>
                  <div
                    className="mt-1 text-sm whitespace-pre-wrap break-words"
                    title={c.body}
                  >
                    {commentPreview(c.body)}
                  </div>
                </div>
              </div>
            );
          })}

          {recentComments.length === 0 && (
            <div className="text-sm text-slate-600">
              За выбранный период комментариев нет.
            </div>
          )}
        </div>
      </Card>

      {/* Recent updates */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Недавние изменения</h2>
          <a className="text-sm underline" href={`/tasks${qs ? `?${qs}` : ""}`}>
            Все задачи
          </a>
        </div>

        <div className="mt-3 grid gap-2">
          {recent.map((t: any) => (
            <TaskRow key={t.id} t={t} />
          ))}
          {recent.length === 0 && (
            <div className="text-sm text-slate-600">Пока нет задач.</div>
          )}
        </div>
      </Card>
    </div>
  );
}
