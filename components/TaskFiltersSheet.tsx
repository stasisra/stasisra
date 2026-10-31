// components/TaskFiltersSheet.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Input, Select } from "@/components/ui";
import TagMultiSelect from "@/components/TagMultiSelect";

type StatusKey = "" | "PLANNED" | "IN_PROGRESS" | "PAUSED" | "DONE";
type SortKey = "due" | "updated" | "executor" | "responsible";
type TagMode = "OR" | "AND";

type Chip = { key: string; label: string; clearKeys: string[] };

function csvToArr(s: string | null) {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function arrToCsv(arr: string[]) {
  return arr
    .map((x) => x.trim())
    .filter(Boolean)
    .join(",");
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
  const v = arrToCsv(arr);
  if (!v) p.delete(key);
  else p.set(key, v);
}

const DASHBOARD_KEYS = [
  "d_focus",
  "d_commentsDays",
  "d_sort",
  "d_tagMode",
  // legacy dashboard keys (если где-то остались)
  "focusDays",
  "commentsDays",
  "sort",
  "tagMode",
];

const LEGACY_KEYS = [
  "executor",
  "responsible",
  "tagsPick",
  "tagsHide",
  "status",
  "showDone",
];

function parseFromUrl(sp: URLSearchParams) {
  // ✅ canonical global ONLY (без legacy fallback)
  const ex = sp.get("ex") ?? "";
  const resp = sp.get("resp") ?? "";
  const tin = csvToArr(sp.get("tin"));
  const tex = csvToArr(sp.get("tex"));
  const st = (sp.get("st") ?? "") as StatusKey;
  const done = sp.get("done") === "1";
  const dueTo = sp.get("dueTo") ?? "";

  // ✅ exp совместим с TasksTableClient:
  // default expanded => нет параметра
  // collapsed => exp=0
  const exp = sp.get("exp") !== "0"; // true по умолчанию

  // dashboard-only (для панели, если включено showDashboardView)
  const d_focus = sp.get("d_focus") ?? "";
  const d_commentsDays = sp.get("d_commentsDays") ?? "";
  const d_sort = sp.get("d_sort") ?? "";
  const d_tagMode = sp.get("tagMode") ?? sp.get("d_tagMode") ?? "";

  // normalize dashboard values
  const normFocus = d_focus === "14" ? "14" : "7";
  const normComments =
    d_commentsDays === "7" ? "7" : d_commentsDays === "30" ? "30" : "14";
  const normSort: SortKey =
    d_sort === "updated" ||
    d_sort === "executor" ||
    d_sort === "responsible" ||
    d_sort === "due"
      ? (d_sort as SortKey)
      : "due";
  const normTagMode: TagMode = d_tagMode === "AND" ? "AND" : "OR";

  return {
    ex,
    resp,
    tin,
    tex,
    st,
    done,
    dueTo,
    exp,

    d_focus: normFocus,
    d_commentsDays: normComments,
    d_sort: normSort,
    d_tagMode: normTagMode,
  };
}

function countActiveDataFilters(v: {
  ex: string;
  resp: string;
  tin: string[];
  tex: string[];
  st: string;
  done: boolean;
  dueTo: string;
}) {
  let n = 0;
  if (v.ex) n++;
  if (v.resp) n++;
  if (v.tin.length) n++;
  if (v.tex.length) n++;
  if (v.st) n++;
  if (v.done) n++;
  if (v.dueTo) n++;
  return n;
}

export default function TaskFiltersSheet(props: {
  executorOptions: string[];
  responsibleOptions: string[];
  tagOptions: string[];

  showStatus?: boolean; // default true
  showExpand?: boolean; // default true
  showDashboardView?: boolean; // default true
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const showStatus = props.showStatus ?? true;
  const showExpand = props.showExpand ?? true;
  const showDashboardView = props.showDashboardView ?? true;

  const applied = useMemo(
    () => parseFromUrl(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const badge = useMemo(() => countActiveDataFilters(applied), [applied]);

  const [open, setOpen] = useState(false);

  // panel state
  const [ex, setEx] = useState(applied.ex);
  const [resp, setResp] = useState(applied.resp);
  const [tin, setTin] = useState<string[]>(applied.tin);
  const [tex, setTex] = useState<string[]>(applied.tex);
  const [st, setSt] = useState<StatusKey>(applied.st);
  const [done, setDone] = useState<boolean>(applied.done);
  const [dueTo, setDueTo] = useState<string>(applied.dueTo);
  const [exp, setExp] = useState<boolean>(applied.exp);

  // dashboard-only panel state
  const [dFocus, setDFocus] = useState<string>(applied.d_focus);
  const [dCommentsDays, setDCommentsDays] = useState<string>(
    applied.d_commentsDays,
  );
  const [dSort, setDSort] = useState<SortKey>(applied.d_sort);
  const [dTagMode, setDTagMode] = useState<TagMode>(applied.d_tagMode);

  // URL -> panel state
  useEffect(() => {
    setEx(applied.ex);
    setResp(applied.resp);
    setTin(applied.tin);
    setTex(applied.tex);
    setSt(applied.st);
    setDone(applied.done);
    setDueTo(applied.dueTo);
    setExp(applied.exp);

    setDFocus(applied.d_focus);
    setDCommentsDays(applied.d_commentsDays);
    setDSort(applied.d_sort);
    setDTagMode(applied.d_tagMode);
  }, [applied]);

  // ESC close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // lock scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ✅ chips: ONLY data filters
  const activeChips = useMemo<Chip[]>(() => {
    const out: Chip[] = [];

    if (applied.ex)
      out.push({
        key: "ex",
        label: `Исп: ${applied.ex}`,
        clearKeys: ["ex", ...LEGACY_KEYS],
      });
    if (applied.resp)
      out.push({
        key: "resp",
        label: `Отв: ${applied.resp}`,
        clearKeys: ["resp", ...LEGACY_KEYS],
      });

    if (applied.tin?.length) {
      const label =
        applied.tin.length <= 3
          ? applied.tin.join(", ")
          : `${applied.tin.length} тега`;
      out.push({
        key: "tin",
        label: `Теги+: ${label}`,
        clearKeys: ["tin", ...LEGACY_KEYS],
      });
    }

    if (applied.tex?.length) {
      const label =
        applied.tex.length <= 3
          ? applied.tex.join(", ")
          : `${applied.tex.length} тега`;
      out.push({
        key: "tex",
        label: `Теги-: ${label}`,
        clearKeys: ["tex", ...LEGACY_KEYS],
      });
    }

    if (showStatus && applied.st)
      out.push({
        key: "st",
        label: `Статус: ${applied.st}`,
        clearKeys: ["st", ...LEGACY_KEYS],
      });

    if (applied.done)
      out.push({
        key: "done",
        label: "DONE",
        clearKeys: ["done", ...LEGACY_KEYS],
      });

    if (applied.dueTo)
      out.push({
        key: "dueTo",
        label: `До: ${applied.dueTo}`,
        clearKeys: ["dueTo"],
      });

    return out;
  }, [applied, showStatus]);

  const clearKeys = (keys: string[]) => {
    const p = new URLSearchParams(searchParams.toString());
    keys.forEach((k) => p.delete(k));

    // ✅ если это /tasks и dashboard view скрыт — чистим dashboard мусор всегда
    if (!showDashboardView && pathname === "/tasks") {
      DASHBOARD_KEYS.forEach((k) => p.delete(k));
    }

    const qs = p.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  const resetInPanel = () => {
    const p = new URLSearchParams(searchParams.toString());

    // canonical global
    p.delete("ex");
    p.delete("resp");
    p.delete("tin");
    p.delete("tex");
    p.delete("st");
    p.delete("done");
    p.delete("dueTo");
    p.delete("tagMode");
    p.delete("exp");

    // common extras
    p.delete("overdue");
    p.delete("due");

    // ✅ важное: если dashboard view выключен (на /tasks), чистим d_* всегда
    if (!showDashboardView || pathname === "/tasks") {
      DASHBOARD_KEYS.forEach((k) => p.delete(k));
    } else {
      // dashboard defaults
      p.set("d_commentsDays", "14");
      p.set("d_focus", "7");
      p.set("d_tagMode", "OR");
      p.set("d_sort", "due");
    }

    // legacy cleanup
    LEGACY_KEYS.forEach((k) => p.delete(k));

    const qs = p.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });

    // clean form (sheet stays open)
    setEx("");
    setResp("");
    setTin([]);
    setTex([]);
    setSt("");
    setDone(false);
    setDueTo("");
    setExp(true); // default expanded

    if (showDashboardView) {
      setDFocus("7");
      setDCommentsDays("14");
      setDTagMode("OR");
      setDSort("due");
    }
  };

  const quickReset = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resetInPanel();
  };

  const apply = () => {
    const p = new URLSearchParams(searchParams.toString());

    // canonical global
    setOrDelete(p, "ex", ex);
    setOrDelete(p, "resp", resp);
    setCsvOrDelete(p, "tin", tin);
    setCsvOrDelete(p, "tex", tex);
    setOrDelete(p, "st", st);

    if (done) p.set("done", "1");
    else p.delete("done");

    setOrDelete(p, "dueTo", dueTo);

    // ✅ exp совместим с TasksTableClient
    // default expanded => без параметра
    if (exp) p.delete("exp");
    else p.set("exp", "0");

    // dashboard-only
    if (showDashboardView) {
      p.set("d_focus", dFocus === "14" ? "14" : "7");
      p.set(
        "d_commentsDays",
        dCommentsDays === "7" ? "7" : dCommentsDays === "30" ? "30" : "14",
      );
      p.set("d_sort", dSort);
      p.set("tagMode", dTagMode);
      p.delete("d_tagMode");
    } else {
      // ✅ если панель dashboard не показываем — не даём d_* жить в URL
      DASHBOARD_KEYS.forEach((k) => p.delete(k));
    }

    // cleanup legacy keys
    LEGACY_KEYS.forEach((k) => p.delete(k));

    const qs = p.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    setOpen(false);
  };

  return (
    <>
      {/* Top bar: button + reset + chips */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Фильтры
          {badge > 0 ? <span className="text-slate-500">({badge})</span> : null}
        </button>

        {badge > 0 && (
          <button
            type="button"
            onClick={quickReset}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
            title="Сбросить все фильтры"
            aria-label="Сбросить все фильтры"
          >
            ×
          </button>
        )}

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {activeChips.map((c) => (
              <span
                key={c.key}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700"
                title={c.label}
              >
                <span className="max-w-[260px] truncate">{c.label}</span>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                  title="Убрать"
                  aria-label={`Убрать: ${c.label}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearKeys(c.clearKeys);
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Sheet */}
      {open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Фильтры"
          >
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div className="text-base font-semibold">Фильтры</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50"
              >
                Закрыть
              </button>
            </div>

            <div className="h-[calc(100%-56px)] overflow-auto space-y-4 p-4">
              <Card className="p-4">
                <div className="mb-3 text-sm font-semibold">Фильтры задач</div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Select
                    label="Исполнитель"
                    value={ex}
                    onChange={(e) => setEx(e.target.value)}
                  >
                    <option value="">Все</option>
                    {props.executorOptions.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>

                  <Select
                    label="Ответственный"
                    value={resp}
                    onChange={(e) => setResp(e.target.value)}
                  >
                    <option value="">Все</option>
                    {props.responsibleOptions.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>

                  {showStatus && (
                    <div className="md:col-span-2">
                      <Select
                        label="Статус"
                        value={st}
                        onChange={(e) => setSt(e.target.value as StatusKey)}
                      >
                        <option value="">Все</option>
                        <option value="PLANNED">PLANNED</option>
                        <option value="IN_PROGRESS">IN_PROGRESS</option>
                        <option value="PAUSED">PAUSED</option>
                        <option value="DONE">DONE</option>
                      </Select>
                    </div>
                  )}

                  <div className="md:col-span-2">
                    <TagMultiSelect
                      label="Теги (включить)"
                      options={props.tagOptions}
                      value={tin}
                      onChange={setTin}
                      placeholder="Выбери несколько..."
                    />
                  </div>

                  <div className="md:col-span-2">
                    <TagMultiSelect
                      label="Скрыть теги"
                      options={props.tagOptions}
                      value={tex}
                      onChange={setTex}
                      placeholder="Скрыть из выборки..."
                    />
                  </div>

                  <div className="md:col-span-2">
                    <Input
                      label="Заканчиваются до даты"
                      type="date"
                      value={dueTo}
                      onChange={(e) => setDueTo(e.target.value)}
                    />
                  </div>

                  <div className="md:col-span-2 flex flex-wrap gap-4 pt-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={(e) => setDone(e.target.checked)}
                      />
                      Показывать DONE
                    </label>

                    {showExpand && (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={exp}
                          onChange={(e) => setExp(e.target.checked)}
                        />
                        Развернуть уровни
                      </label>
                    )}
                  </div>
                </div>
              </Card>

              {showDashboardView && (
                <Card className="p-4">
                  <div className="mb-3 text-sm font-semibold">Вид дашборда</div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Select
                      label="Фокус"
                      value={dFocus}
                      onChange={(e) => setDFocus(e.target.value)}
                    >
                      <option value="7">7 дней</option>
                      <option value="14">14 дней</option>
                    </Select>

                    <Select
                      label="Комментарии (период)"
                      value={dCommentsDays}
                      onChange={(e) => setDCommentsDays(e.target.value)}
                    >
                      <option value="7">7 дней</option>
                      <option value="14">14 дней</option>
                      <option value="30">30 дней</option>
                    </Select>

                    <Select
                      label="Режим тегов"
                      value={dTagMode}
                      onChange={(e) => setDTagMode(e.target.value as TagMode)}
                    >
                      <option value="OR">OR (любой тег)</option>
                      <option value="AND">AND (все теги)</option>
                    </Select>

                    <Select
                      label="Сортировка"
                      value={dSort}
                      onChange={(e) => setDSort(e.target.value as SortKey)}
                    >
                      <option value="due">По дедлайну</option>
                      <option value="updated">По обновлению</option>
                      <option value="executor">По исполнителю</option>
                      <option value="responsible">По ответственному</option>
                    </Select>
                  </div>
                </Card>
              )}

              <div className="flex items-center gap-2">
                <Button onClick={apply} type="button">
                  Применить
                </Button>
                <Button
                  variant="secondary"
                  onClick={resetInPanel}
                  type="button"
                >
                  Сброс
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
