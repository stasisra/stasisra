// components/DashboardFiltersClient.tsx
"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button, Card } from "@/components/ui";
import TagMultiSelect from "@/components/TagMultiSelect";

type SortKey = "due" | "updated" | "executor" | "responsible";

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

function delLegacy(p: URLSearchParams) {
  // legacy keys from old dashboard URLs
  p.delete("executor");
  p.delete("responsible");
  p.delete("tagsPick");
  p.delete("tagsHide");
  p.delete("tagMode");
  p.delete("sort");
  p.delete("commentsDays");
  p.delete("focusDays");
}

export default function DashboardFiltersClient(props: {
  executorOptions: string[];
  responsibleOptions: string[];
  tagOptions: string[];

  initialExecutor: string;
  initialResponsible: string;
  initialTagsPick: string[];
  initialTagsHide: string[];
  initialTagMode: "OR" | "AND";
  initialSort: SortKey;

  commentsDays: number; // already clamped on server
  focusDays: number; // already clamped on server
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [executor, setExecutor] = useState(props.initialExecutor);
  const [responsible, setResponsible] = useState(props.initialResponsible);

  const [tagsPick, setTagsPick] = useState<string[]>(props.initialTagsPick);
  const [tagsHide, setTagsHide] = useState<string[]>(props.initialTagsHide);
  const [tagMode, setTagMode] = useState<"OR" | "AND">(props.initialTagMode);

  const [sort, setSort] = useState<SortKey>(props.initialSort);
  const [focusDays, setFocusDays] = useState<number>(props.focusDays);

  // keep local state in sync when URL changes (server recomputes initial*)
  useEffect(() => {
    setExecutor(props.initialExecutor);
    setResponsible(props.initialResponsible);
    setTagsPick(props.initialTagsPick);
    setTagsHide(props.initialTagsHide);
    setTagMode(props.initialTagMode);
    setSort(props.initialSort);
    setFocusDays(props.focusDays);
  }, [
    props.initialExecutor,
    props.initialResponsible,
    props.initialTagsPick,
    props.initialTagsHide,
    props.initialTagMode,
    props.initialSort,
    props.focusDays,
  ]);

  const nextQuery = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());

    // canonical global (shared with tasks/gantt)
    setOrDelete(p, "ex", executor);
    setOrDelete(p, "resp", responsible);
    setCsvOrDelete(p, "tin", tagsPick);
    setCsvOrDelete(p, "tex", tagsHide);

    // canonical dashboard-only (view)
    p.set("d_tagMode", tagMode);
    p.set("d_sort", sort);
    p.set("d_commentsDays", String(props.commentsDays));
    p.set("d_focus", String(focusDays));

    // converge urls
    delLegacy(p);

    return p.toString();
  }, [
    searchParams,
    executor,
    responsible,
    tagsPick,
    tagsHide,
    tagMode,
    sort,
    props.commentsDays,
    focusDays,
  ]);

  const apply = () => {
    router.replace(`${pathname}?${nextQuery}`, { scroll: false });
  };

  const resetAll = () => {
    const p = new URLSearchParams(searchParams.toString());

    p.delete("ex");
    p.delete("resp");
    p.delete("tin");
    p.delete("tex");

    p.delete("st");
    p.delete("done");
    p.delete("dueTo");
    p.delete("overdue");
    p.delete("due");
    p.delete("exp");

    p.set("d_commentsDays", "14");
    p.set("d_focus", "7");
    p.set("d_tagMode", "OR");
    p.set("d_sort", "due");

    p.delete("executor");
    p.delete("responsible");
    p.delete("tagsPick");
    p.delete("tagsHide");
    p.delete("tagMode");
    p.delete("sort");
    p.delete("commentsDays");
    p.delete("focusDays");

    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  return (
    <Card className="p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <div>
          <div className="mb-1 text-xs text-slate-600">Исполнитель</div>
          <select
            value={executor}
            onChange={(e) => setExecutor(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Все</option>
            {props.executorOptions.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-1 text-xs text-slate-600">Ответственный</div>
          <select
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Все</option>
            {props.responsibleOptions.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <TagMultiSelect
            label="Теги (включить)"
            options={props.tagOptions}
            value={tagsPick}
            onChange={setTagsPick}
            placeholder="Выбери несколько..."
          />
        </div>

        <div className="md:col-span-2">
          <TagMultiSelect
            label="Скрыть теги"
            options={props.tagOptions}
            value={tagsHide}
            onChange={setTagsHide}
            placeholder="Спрятать из дашборда..."
          />
        </div>

        <div>
          <div className="mb-1 text-xs text-slate-600">Режим тегов</div>
          <select
            value={tagMode}
            onChange={(e) => setTagMode(e.target.value as any)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="OR">OR (любой тег)</option>
            <option value="AND">AND (все теги)</option>
          </select>
        </div>

        <div>
          <div className="mb-1 text-xs text-slate-600">Сортировка</div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="due">По дедлайну</option>
            <option value="updated">По обновлению</option>
            <option value="executor">По исполнителю</option>
            <option value="responsible">По ответственному</option>
          </select>
        </div>

        <div>
          <div className="mb-1 text-xs text-slate-600">Фокус</div>
          <select
            value={String(focusDays)}
            onChange={(e) => setFocusDays(Number(e.target.value))}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="7">7 дней</option>
            <option value="14">14 дней</option>
          </select>
        </div>

        <div className="md:col-span-6 flex items-center gap-2">
          <Button type="button" onClick={apply}>
            Применить
          </Button>
          <Button type="button" variant="secondary" onClick={resetAll}>
            Сброс
          </Button>
        </div>
      </div>
    </Card>
  );
}
