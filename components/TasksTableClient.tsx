// components/TasksTableClient.tsx
"use client";
import { calendarDays, todayYmd } from "@/lib/dates";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge, Card } from "@/components/ui";
import { buildTree } from "@/lib/taskTree";
import {
  AttachmentButton,
  TaskAttachmentsModal,
} from "@/components/TaskAttachments";
import TaskDescriptionHover from "@/components/TaskDescriptionHover";

type TaskCommentLite = { body: string; createdAt: string };

type Task = {
  id: string;
  title: string;
  description: string | null;
  startDate: string; // ISO
  endDate: string; // ISO
  percentComplete: number;
  status: string;
  priority: string;
  parentTaskId: string | null;
  sortOrder: number;
  tags?: string | null;

  executorName?: string | null;
  responsibleName?: string | null;

  executor?: { id: string; name: string } | null;
  responsible?: { id: string; name: string } | null;

  comments?: TaskCommentLite[];

  level?: number;
  children?: Task[];
};

type TasksTableClientProps = {
  tasks: Task[];

  // оставлены, чтобы не ломать вызов с page.tsx
  executorOptions: string[];
  responsibleOptions: string[];
  tagOptions: string[];
  descriptionHints: string[];
  titleHints: string[];

  initialStatusFromUrl?: any;
  initialOverdue?: boolean;
  initialDue7d?: boolean;
};

function splitTags(s: string) {
  return (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toYmd(iso: string) {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function diffDaysInclusive(start: string, end: string) {
  return Math.max(0, calendarDays(start, end) + 1);
}
function remainingDaysFromToday(end: string) {
  return Math.max(0, calendarDays(todayYmd(), end));
}

export default function TasksTableClient({ tasks }: TasksTableClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString(); // стабильная зависимость

  // keep list in sync
  const [items, setItems] = useState<Task[]>(tasks);
  useEffect(() => setItems(tasks), [tasks]);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // ✅ ONLY 2 toggles
  const [showDone, setShowDone] = useState(false); // default: НЕ показывать DONE
  const [expandLevels, setExpandLevels] = useState(true); // default: развернуто

  // ✅ два режима раскрытия:
  // expandLevels=true  -> по умолчанию открыто, можно СВЕРНУТЬ узлы (collapsed)
  // expandLevels=false -> по умолчанию закрыто, можно РАСКРЫТЬ узлы (expandedManual)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expandedManual, setExpandedManual] = useState<Set<string>>(
    () => new Set(),
  );

  // статус из URL: если выбран конкретный статус, чекбокс DONE блокируем
  const stParam = (sp.get("st") || sp.get("status") || "").trim();
  const showDoneDisabled = stParam.length > 0;

  // URL -> local (только done/exp)
  useEffect(() => {
    const doneRaw = sp.get("done") === "1" || sp.get("showDone") === "1";
    setShowDone(doneRaw);

    // exp: default expanded; exp=0 -> collapsed
    const expRaw = sp.get("exp");
    setExpandLevels(expRaw === null ? true : expRaw !== "0");
  }, [qs, sp]);

  const patchUrl = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(sp.toString());
    mutate(p);
    const nextQs = p.toString();
    const next = nextQs ? `${pathname}?${nextQs}` : pathname;
    router.replace(next, { scroll: false });
  };
  const toggleNode = (id: string) => {
    if (expandLevels) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setExpandedManual((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  };

  // ✅ локально скрываем DONE только если статус НЕ выбран
  const visibleItems = useMemo(() => {
    if (showDoneDisabled) return items;
    return showDone ? items : items.filter((t) => t.status !== "DONE");
  }, [items, showDone, showDoneDisabled]);

  const tree = useMemo(() => buildTree(visibleItems as any), [visibleItems]);

  const rows = useMemo(() => {
    const out: any[] = [];

    const walk = (n: any) => {
      out.push(n);

      const kids = n.children ?? [];
      if (!kids.length) return;

      if (!(expandLevels ? !collapsed.has(n.id) : expandedManual.has(n.id)))
        return;

      for (const c of kids) walk(c);
    };

    for (const r of tree as any[]) walk(r);
    return out;
  }, [tree, expandLevels, collapsed, expandedManual]);

  // inline edit state (как было)
  const [editEndId, setEditEndId] = useState<string | null>(null);
  const [editEnd, setEditEnd] = useState<string>("");
  const [savingEndId, setSavingEndId] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  const [editPctId, setEditPctId] = useState<string | null>(null);
  const [editPct, setEditPct] = useState<number>(0);
  const [savingPctId, setSavingPctId] = useState<string | null>(null);
  const [pctError, setPctError] = useState<string | null>(null);

  const openEditEndDate = (task: Task) => {
    setEndError(null);
    setEditEndId(task.id);
    setEditEnd(toYmd(task.endDate));
  };

  const closeEditEndDate = () => {
    setEndError(null);
    setEditEndId(null);
    setEditEnd("");
  };

  const saveEndDate = async (taskId: string) => {
    if (!editEnd) return;

    setSavingEndId(taskId);
    setEndError(null);

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endDate: editEnd }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Ошибка сохранения даты");

      const nextIso = `${editEnd}T00:00:00.000Z`;
      setItems((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, endDate: nextIso } : t)),
      );

      closeEditEndDate();
    } catch (e: any) {
      setEndError(e?.message || "Ошибка сохранения");
    } finally {
      setSavingEndId(null);
    }
  };

  const openEditPct = (task: Task) => {
    setPctError(null);
    setEditPctId(task.id);
    setEditPct(
      typeof task.percentComplete === "number" ? task.percentComplete : 0,
    );
  };

  const closeEditPct = () => {
    setPctError(null);
    setEditPctId(null);
  };

  const savePct = async (taskId: string) => {
    const pct = Math.max(0, Math.min(100, Math.round(Number(editPct))));
    setSavingPctId(taskId);
    setPctError(null);

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ percentComplete: pct }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Ошибка сохранения %");

      setItems((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, percentComplete: pct } : t)),
      );
      closeEditPct();
    } catch (e: any) {
      setPctError(e?.message || "Ошибка сохранения");
    } finally {
      setSavingPctId(null);
    }
  };

  const modalTitle = openTaskId
    ? (items.find((t) => t.id === openTaskId)?.title ?? "")
    : "";

  const returnUrl = useMemo(() => {
    const full = `${pathname}${qs ? `?${qs}` : ""}`;
    return encodeURIComponent(full);
  }, [pathname, qs]);

  return (
    <div className="space-y-4">
      {/* ✅ ONLY 2 CHECKBOXES */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-6">
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
              checked={showDone}
              disabled={showDoneDisabled}
              onChange={(e) => {
                const checked = e.target.checked;
                setShowDone(checked);

                patchUrl((p) => {
                  if (checked) p.set("done", "1");
                  else p.delete("done");
                  p.delete("showDone"); // cleanup legacy
                });
              }}
            />
            Показывать DONE
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={expandLevels}
              onChange={(e) => {
                const checked = e.target.checked;
                setExpandLevels(checked);

                // ✅ не смешиваем режимы
                if (checked) setExpandedManual(new Set());
                else setCollapsed(new Set());

                patchUrl((p) => {
                  // default expanded => без параметра
                  if (checked) p.delete("exp");
                  else p.set("exp", "0");
                });
              }}
            />
            Развернуть уровни
          </label>
        </div>
      </Card>

      {/* Table */}
      <Card className="p-4 overflow-x-auto">
        <table className="w-full min-w-[1360px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-600">
              <th className="py-2 pr-2">Теги</th>
              <th className="py-2 pr-2">Задача</th>
              <th className="py-2 pr-2">📎</th>
              <th className="py-2 pr-2">Исполнитель</th>
              <th className="py-2 pr-2">Ответственный</th>
              <th className="py-2 pr-2">Статус</th>
              <th className="py-2 pr-2">%</th>
              <th className="py-2 pr-2">Даты</th>
              <th className="py-2 pr-2">Всего дней</th>
              <th className="py-2 pr-2">Осталось</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((n: any) => {
              const tagsArr = splitTags((n.tags ?? "") as string);
              const lastComment = (n.comments?.[0]?.body ?? "").trim();
              const lvl = n.level ?? 0;

              const kids = n.children ?? [];
              const hasKids = kids.length > 0;

              const totalDays = diffDaysInclusive(n.startDate, n.endDate);
              const leftDays = remainingDaysFromToday(n.endDate);
              const warn = leftDays > 0 && leftDays <= 7;

              const isEditingEnd = editEndId === n.id;
              const isEditingPct = editPctId === n.id;

              const open = hasKids
                ? expandLevels
                  ? !collapsed.has(n.id)
                  : expandedManual.has(n.id)
                : false;

              return (
                <tr key={n.id} className="border-b border-slate-100">
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap gap-1">
                      {tagsArr.length ? (
                        tagsArr.map((t: string) => (
                          <Badge key={t} title={t}>
                            {t}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </div>
                  </td>

                  <td className="py-2 pr-2">
                    <div
                      className="flex items-center gap-2"
                      style={{ paddingLeft: lvl * 16 }}
                    >
                      {lvl > 0 && <span className="text-slate-400">↳</span>}

                      {/* ✅ стрелка ВСЕГДА если есть дети */}
                      {hasKids ? (
                        <button
                          type="button"
                          onClick={() => toggleNode(n.id)}
                          className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-full border border-slate-200 bg-white px-2 text-[18px] leading-none text-slate-600 hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98]"
                          title={open ? "Свернуть" : "Развернуть"}
                        >
                          {open ? "▾" : "▸"}
                        </button>
                      ) : (
                        <span className="inline-block h-6 w-[28px]" />
                      )}

                      <Link
                        className="font-medium hover:underline"
                        href={`/tasks/${n.id}?return=${returnUrl}`}
                        title={lastComment || undefined}
                      >
                        {n.title}
                      </Link>

                      {lastComment && (
                        <span
                          className="inline-block h-3 w-3 rounded-full bg-sky-500"
                          title={lastComment}
                        />
                      )}
                    </div>

                    <TaskDescriptionHover
                      description={n.description}
                      indentPx={lvl * 16 + 36}
                    />
                  </td>

                  <td className="py-2 pr-2">
                    <AttachmentButton
                      taskId={n.id}
                      onOpen={() => setOpenTaskId(n.id)}
                    />
                  </td>

                  <td className="py-2 pr-2 text-sm">
                    {(n.executorName ?? "").trim() || n.executor?.name || "—"}
                  </td>
                  <td className="py-2 pr-2 text-sm">
                    {(n.responsibleName ?? "").trim() ||
                      n.responsible?.name ||
                      "—"}
                  </td>

                  <td className="py-2 pr-2">
                    <Badge>{n.status}</Badge>
                  </td>

                  <td className="py-2 pr-2">
                    {!isEditingPct ? (
                      <button
                        type="button"
                        className="inline-flex items-center"
                        onClick={() => openEditPct(n)}
                        title="Изменить % выполнения"
                      >
                        <Badge>{n.percentComplete}%</Badge>
                      </button>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="inline-flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={5}
                            value={editPct}
                            onChange={(e) => setEditPct(Number(e.target.value))}
                            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                          />
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm hover:bg-slate-50"
                            onClick={() => savePct(n.id)}
                            disabled={savingPctId === n.id}
                          >
                            {savingPctId === n.id ? "..." : "Сохранить"}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm hover:bg-slate-50"
                            onClick={closeEditPct}
                            disabled={savingPctId === n.id}
                          >
                            Отмена
                          </button>
                        </div>
                        {pctError && (
                          <div className="text-xs text-red-600">{pctError}</div>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="py-2 pr-2 text-sm whitespace-nowrap">
                    <span>{String(n.startDate).slice(0, 10)}</span>
                    <span className="mx-2 text-slate-400">→</span>

                    {!isEditingEnd ? (
                      <button
                        type="button"
                        className="underline decoration-dotted hover:decoration-solid"
                        onClick={() => openEditEndDate(n)}
                        title="Изменить дату окончания"
                      >
                        {String(n.endDate).slice(0, 10)}
                      </button>
                    ) : (
                      <span className="inline-flex flex-col">
                        <span className="inline-flex items-center gap-2">
                          <input
                            type="date"
                            value={editEnd}
                            onChange={(e) => setEditEnd(e.target.value)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                          />
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm hover:bg-slate-50"
                            onClick={() => saveEndDate(n.id)}
                            disabled={savingEndId === n.id}
                          >
                            {savingEndId === n.id ? "..." : "Сохранить"}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm hover:bg-slate-50"
                            onClick={closeEditEndDate}
                            disabled={savingEndId === n.id}
                          >
                            Отмена
                          </button>
                        </span>

                        {endError && (
                          <div className="mt-1 text-xs text-red-600">
                            {endError}
                          </div>
                        )}
                      </span>
                    )}
                  </td>

                  <td className="py-2 pr-2 text-sm">{totalDays || "—"}</td>

                  <td className="py-2 pr-2 text-sm">
                    <span
                      className={
                        warn
                          ? "rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-700"
                          : "text-slate-700"
                      }
                      title={warn ? "Осталось 7 дней или меньше" : undefined}
                    >
                      {leftDays}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="mt-3 text-sm text-slate-600">Ничего не найдено.</div>
        )}
      </Card>

      <TaskAttachmentsModal
        taskId={openTaskId ?? ""}
        taskTitle={modalTitle}
        open={openTaskId != null}
        onClose={() => setOpenTaskId(null)}
      />
    </div>
  );
}
