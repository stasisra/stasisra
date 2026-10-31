// components/GanttBoard.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { todayYmd } from "@/lib/dates";
import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  format,
  startOfDay,
  startOfWeek,
} from "date-fns";

import { Badge, Button } from "@/components/ui";
import { buildTree, flattenTree } from "@/lib/taskTree";
import TaskLink from "@/components/TaskLink";

type TaskCommentLite = {
  body: string;
  createdAt: string; // ISO
};

type Task = {
  id: string;
  title: string;
  description: string | null;
  tags?: string | null;

  startDate: string; // ISO
  endDate: string; // ISO
  percentComplete: number;
  status: string;
  priority: string;

  parentTaskId: string | null;
  sortOrder: number;

  executorName?: string | null;
  responsibleName?: string | null;

  executor: { id: string; name: string } | null;
  responsible: { id: string; name: string } | null;

  comments?: TaskCommentLite[];

  level?: number;
  children?: Task[];
};

type User = { id: string; name: string };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function GanttBoard({
  initialTasks,
  initialMode,
  focusId,
}: {
  initialTasks: Task[];
  users: User[];
  initialMode: "day" | "week";
  focusId?: string | null;

  // оставил пропсы, даже если не используем в борде — чтобы не ломать page.tsx
  executorOptions?: string[];
  responsibleOptions?: string[];
  tagOptions?: string[];
  descriptionHints?: string[];
  titleHints?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // mode живет как state (Day/Week кнопки)
  const [mode, setMode] = useState<"day" | "week">(initialMode);

  // 3 чекбокса (тоже state, но синхроним с URL)
  const [exp, setExp] = useState<boolean>(true); // expand levels
  const [past, setPast] = useState<boolean>(false); // show 7 days before today
  const [done, setDone] = useState<boolean>(false); // show DONE

  // ---- URL -> state (restore on reload/back + reacts to TaskFiltersSheet changes) ----
  useEffect(() => {
    const modeFromUrl = sp.get("mode");
    setMode(modeFromUrl === "week" ? "week" : "day");

    // ✅ exp: if param missing => default true
    // ✅ if exp=0 => false, exp=1 => true
    const expRaw = sp.get("exp");
    setExp(expRaw === null ? true : expRaw === "1");

    // ✅ past: canonical past=1 OR legacy showPast=1
    setPast(sp.get("past") === "1" || sp.get("showPast") === "1");

    // ✅ done: canonical done=1 OR legacy showDone=1
    setDone(sp.get("done") === "1" || sp.get("showDone") === "1");
  }, [sp]);

  const updateUrl = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  const showDoneDisabled = !!(sp.get("st") || sp.get("status"));

  // ===== scroll sync for gantt columns =====
  const headScrollRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const syncLock = useRef(false);

  const syncScroll = (from: "head" | "body") => {
    if (syncLock.current) return;
    const head = headScrollRef.current;
    const body = bodyScrollRef.current;
    if (!head || !body) return;

    syncLock.current = true;
    if (from === "body") head.scrollLeft = body.scrollLeft;
    else body.scrollLeft = head.scrollLeft;

    requestAnimationFrame(() => {
      syncLock.current = false;
    });
  };

  const filtered = initialTasks;

  const tree = useMemo(() => buildTree(filtered as any), [filtered]);

  // expand/collapse internal state
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const t of initialTasks) s.add(t.id);
    return s;
  });

  // если поменялись отфильтрованные задачи — корректно “дораскрыть” видимые узлы
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const t of filtered) next.add(t.id);
      return next;
    });
  }, [filtered]);

  const rows = useMemo(() => {
    const base = exp ? flattenTree(tree as any, expanded) : (tree as any[]);
    return base as any[];
  }, [tree, expanded, exp]);

  const calendarDate = (iso: string) =>
    new Date(iso.slice(0, 10) + "T00:00:00");
  const today = useMemo(() => new Date(todayYmd() + "T00:00:00"), []);

  const { columns, colWidth, getColIndex, colLabel } = useMemo(() => {
    if (mode === "day") {
      const horizon = 120;
      const start = startOfDay(past ? addDays(today, -7) : today);
      const columns = Array.from({ length: horizon }, (_, i) =>
        addDays(start, i),
      );
      const colWidth = 24;
      const getColIndex = (d: Date) =>
        differenceInCalendarDays(startOfDay(d), start);
      const colLabel = (d: Date) => format(d, "d");
      return { columns, colWidth, getColIndex, colLabel };
    }

    const days = 180;
    const start = startOfWeek(past ? addDays(today, -7) : today, {
      weekStartsOn: 1,
    });
    const weeks = Math.ceil(days / 7);
    const columns = Array.from({ length: weeks }, (_, i) =>
      addDays(start, i * 7),
    );
    const colWidth = 84;
    const getColIndex = (d: Date) =>
      Math.floor(differenceInCalendarDays(startOfDay(d), start) / 7);
    const colLabel = (d: Date) => {
      const from = d;
      const to = addDays(d, 6);
      return `${format(from, "dd.MM")}-${format(to, "dd.MM")}`;
    };
    return { columns, colWidth, getColIndex, colLabel };
  }, [mode, today, past]);

  const todayPos = useMemo(() => {
    const idx = getColIndex(today);
    return idx * colWidth;
  }, [getColIndex, today, colWidth]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  };

  const expandAll = () => {
    const s = new Set<string>();
    for (const t of filtered) s.add(t.id);
    setExpanded(s);
  };

  const collapseAll = () => setExpanded(new Set());

  // === LEFT PANEL LAYOUT ===
  const LEFT_W = 980;
  const LEFT_GRID = "420px 48px 190px 120px 120px 70px";

  return (
    <div className="space-y-4">
      {/* Top controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Gantt</h2>
          <p className="text-sm text-slate-600">
            Day: 120 дней · Week: 180 дней
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-2">
            <Button
              variant={mode === "day" ? "primary" : "secondary"}
              size="sm"
              onClick={() => updateUrl({ mode: "day" })}
            >
              Day (120)
            </Button>
            <Button
              variant={mode === "week" ? "primary" : "secondary"}
              size="sm"
              onClick={() => updateUrl({ mode: "week" })}
            >
              Week (180)
            </Button>
          </div>

          <Button variant="ghost" size="sm" onClick={expandAll}>
            Развернуть
          </Button>
          <Button variant="ghost" size="sm" onClick={collapseAll}>
            Свернуть
          </Button>
        </div>
      </div>

      {/* ✅ ONLY 3 CHECKBOXES (old filter UI removed) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={exp}
              onChange={(e) => updateUrl({ exp: e.target.checked ? "1" : "0" })}
            />
            Развернуть уровни
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={past}
              onChange={(e) =>
                updateUrl({ past: e.target.checked ? "1" : null })
              }
            />
            Показать 7 дней до сегодня
          </label>

          <label
            className={`flex items-center gap-2 text-sm text-slate-700 ${showDoneDisabled ? "opacity-60" : ""}`}
            title={
              showDoneDisabled
                ? "Когда выбран конкретный статус — DONE показывается через фильтр статуса"
                : ""
            }
          >
            <input
              type="checkbox"
              checked={done}
              onChange={(e) =>
                updateUrl({ done: e.target.checked ? "1" : null })
              }
              disabled={showDoneDisabled}
            />
            Показывать DONE
          </label>
        </div>
      </div>

      {/* Board */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        {/* Header */}
        <div className="flex border-b border-slate-200">
          <div
            className="sticky left-0 z-10 shrink-0 border-r border-slate-200 bg-white"
            style={{ width: LEFT_W }}
          >
            <div
              className="gap-2 px-3 py-2 text-xs text-slate-600"
              style={{ display: "grid", gridTemplateColumns: LEFT_GRID }}
            >
              <div>Задача</div>
              <div>Lvl</div>
              <div>Даты</div>
              <div>Исполнитель</div>
              <div>Ответственный</div>
              <div>%</div>
            </div>
          </div>

          <div
            ref={headScrollRef}
            onScroll={() => syncScroll("head")}
            className="relative overflow-auto"
          >
            <div style={{ width: columns.length * colWidth }} className="flex">
              {columns.map((d) => (
                <div
                  key={d.toISOString()}
                  style={{ width: colWidth }}
                  className="border-l border-slate-100 px-1 py-2 text-[10px] text-slate-600 whitespace-nowrap"
                >
                  {mode === "day" ? (
                    <div className="text-center">
                      {colLabel(d)}
                      <div className="text-slate-400">{format(d, "MM")}</div>
                    </div>
                  ) : (
                    <div className="text-center">{colLabel(d)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          ref={bodyScrollRef}
          onScroll={() => syncScroll("body")}
          className="relative overflow-auto"
          style={{ maxHeight: 650 }}
        >
          {/* Today line */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 border-l-2 border-amber-400"
            style={{ left: LEFT_W + todayPos }}
          />

          {rows.map((t: any) => {
            const s = startOfDay(calendarDate(t.startDate));
            const e = endOfDay(calendarDate(t.endDate));
            const visibleBar =
              getColIndex(e) >= 0 && getColIndex(s) < columns.length;
            const fromIdx = clamp(getColIndex(s), 0, columns.length - 1);
            const toIdx = clamp(getColIndex(e), 0, columns.length - 1);
            const left = fromIdx * colWidth;
            const width = Math.max(colWidth, (toIdx - fromIdx + 1) * colWidth);

            const hasChildren = (t.children?.length ?? 0) > 0;
            const isExpanded = expanded.has(t.id);
            const isFocused = focusId && t.id === focusId;
            const lvl = t.level ?? 0;

            const lastComment = (t.comments?.[0]?.body ?? "").trim();
            const hasComment = lastComment.length > 0;
            const titleTip = hasComment
              ? `${t.title}\n\nКомментарий: ${lastComment}`
              : t.title;

            return (
              <div
                key={t.id}
                className={
                  "flex border-b border-slate-100 " +
                  (isFocused ? "bg-amber-50 " : "") +
                  (hasComment ? "bg-sky-50/40 " : "")
                }
              >
                {/* Left sticky row */}
                <div
                  className="sticky left-0 z-10 shrink-0 border-r border-slate-200 bg-white"
                  style={{ width: LEFT_W }}
                >
                  <div
                    className="gap-2 px-3 py-2 text-sm"
                    style={{
                      display: "grid",
                      gridTemplateColumns: LEFT_GRID,
                      alignItems: "start",
                    }}
                  >
                    {/* Задача */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-6 min-w-[28px] items-center justify-center shrink-0">
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggle(t.id)}
                              className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-full border border-slate-200 bg-white px-2 text-[18px] leading-none text-slate-600 hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98]"
                              title={isExpanded ? "Свернуть" : "Развернуть"}
                            >
                              {isExpanded ? "▾" : "▸"}
                            </button>
                          ) : (
                            <span className="inline-block h-6 w-[28px]" />
                          )}
                        </span>

                        <div
                          className="min-w-0 flex items-center gap-2"
                          style={{ marginLeft: lvl * 16 }}
                        >
                          {lvl > 0 && <span className="text-slate-400">↳</span>}

                          <TaskLink
                            taskId={t.id}
                            className="font-semibold truncate hover:underline"
                            title={titleTip}
                          >
                            {t.title}
                          </TaskLink>

                          {hasComment && (
                            <span
                              className="inline-block h-4 w-4 rounded-full bg-sky-500"
                              title={lastComment}
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Lvl */}
                    <div className="text-xs text-slate-500">{lvl}</div>

                    {/* Даты */}
                    <div className="text-xs text-slate-700 whitespace-nowrap">
                      {format(calendarDate(t.startDate), "yyyy-MM-dd")} →{" "}
                      {format(calendarDate(t.endDate), "yyyy-MM-dd")}
                    </div>

                    {/* Исполнитель */}
                    <div className="truncate">
                      {(t.executorName ?? "").trim() || t.executor?.name || "—"}
                    </div>

                    {/* Ответственный */}
                    <div className="truncate">
                      {(t.responsibleName ?? "").trim() ||
                        t.responsible?.name ||
                        "—"}
                    </div>

                    {/* % */}
                    <div>
                      <Badge>{t.percentComplete}%</Badge>
                    </div>
                  </div>
                </div>

                {/* Right timeline */}
                <div
                  className="relative"
                  style={{ width: columns.length * colWidth }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${columns.length}, ${colWidth}px)`,
                    }}
                  >
                    {columns.map((d) => (
                      <div
                        key={d.toISOString()}
                        className="border-l border-slate-100"
                      />
                    ))}
                  </div>

                  {/* clickable bar */}
                  {visibleBar ? (
                    <TaskLink
                      taskId={t.id}
                      className="absolute top-2 h-6 rounded-lg border border-slate-300 bg-slate-200 hover:bg-slate-300 overflow-hidden"
                      style={{ left, width }}
                      title={titleTip}
                      aria-label={`Открыть задачу: ${t.title}`}
                    >
                      <div className="absolute inset-0">
                        <div
                          className="h-full bg-slate-400"
                          style={{
                            width: `${clamp(t.percentComplete, 0, 100)}%`,
                          }}
                        />
                      </div>

                      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-2">
                        <span className="text-[10px] font-semibold text-slate-700">
                          {t.percentComplete}%
                        </span>
                        <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                          {t.status}
                        </span>
                      </div>
                    </TaskLink>
                  ) : (
                    <span className="absolute left-3 top-3 text-xs text-slate-400">
                      Вне диапазона
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {rows.length === 0 && (
            <div className="p-4 text-sm text-slate-600">
              Нет задач по фильтрам.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
