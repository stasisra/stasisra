// components/TaskForm.tsx
"use client";

import { todayYmd } from "@/lib/dates";
import { internalPath } from "@/lib/navigation";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input, Select } from "@/components/ui";

type UserOpt = { id: string; name: string };
type TaskOpt = { id: string; title: string; sortOrder?: number | null };

function uniqSorted(arr: string[]) {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b, "ru"),
  );
}

function splitTags(v: string) {
  return (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeTagsStringFromArray(arr: string[]) {
  return arr
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

function normalizeReturnUrl(raw: unknown) {
  return internalPath(raw, "");
}

export default function TaskForm({
  mode,
  users,
  parents,
  initial,
  taskId,
  currentUserId,
  executorHints,
  responsibleHints,
  tagHints,
  returnUrl,
}: {
  mode: "create" | "edit";
  users: UserOpt[];
  parents: TaskOpt[];
  initial?: any;
  taskId?: string;
  currentUserId?: string;

  executorHints?: string[];
  responsibleHints?: string[];
  tagHints?: string[];

  returnUrl?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const fallbackUserId = currentUserId ?? users[0]?.id ?? "";

  const effectiveReturnUrl = useMemo(() => {
    const fromProp = normalizeReturnUrl(returnUrl);
    if (fromProp) return fromProp;

    const fromQuery = normalizeReturnUrl(sp?.get("return"));
    if (fromQuery) return fromQuery;

    try {
      const saved = localStorage.getItem("tasks:lastQuery") || "";
      const norm = normalizeReturnUrl(saved);
      if (norm) return norm;
    } catch {}

    return "/tasks";
  }, [returnUrl, sp]);

  const effectiveReturnEnc = useMemo(
    () => encodeURIComponent(effectiveReturnUrl),
    [effectiveReturnUrl],
  );

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState<string>(
    initial?.description ?? "",
  );
  const [startDate, setStartDate] = useState(
    initial?.startDate
      ? new Date(initial.startDate).toISOString().slice(0, 10)
      : todayYmd(),
  );
  const [endDate, setEndDate] = useState(
    initial?.endDate
      ? new Date(initial.endDate).toISOString().slice(0, 10)
      : todayYmd(),
  );

  const [executorName, setExecutorName] = useState(initial?.executorName ?? "");
  const [responsibleName, setResponsibleName] = useState(
    initial?.responsibleName ?? "",
  );

  const [executorId, setExecutorId] = useState(
    initial?.executorId ?? fallbackUserId,
  );
  const [responsibleId, setResponsibleId] = useState(
    initial?.responsibleId ?? fallbackUserId,
  );

  const [percentComplete, setPercentComplete] = useState<number>(
    initial?.percentComplete ?? 0,
  );
  const [status, setStatus] = useState(initial?.status ?? "PLANNED");
  const [priority, setPriority] = useState(initial?.priority ?? "MEDIUM");
  const [parentTaskId, setParentTaskId] = useState<string>(
    initial?.parentTaskId ?? "",
  );
  const [sortOrder, setSortOrder] = useState<number>(initial?.sortOrder ?? 0);

  const [tagsArr, setTagsArr] = useState<string[]>(() =>
    splitTags(initial?.tags ?? ""),
  );
  const [tagDraft, setTagDraft] = useState<string>("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [createdId, setCreatedId] = useState<string | null>(null);

  const execIsExternal = useMemo(
    () => executorName.trim().length > 0,
    [executorName],
  );
  const respIsExternal = useMemo(
    () => responsibleName.trim().length > 0,
    [responsibleName],
  );

  const normalizedTagHints = useMemo(
    () => uniqSorted(tagHints ?? []),
    [tagHints],
  );
  const tagQuery = useMemo(() => tagDraft.trim().toLowerCase(), [tagDraft]);

  const filteredTagHints = useMemo(() => {
    if (!normalizedTagHints.length) return [];
    if (!tagQuery) return normalizedTagHints.slice(0, 20);
    return normalizedTagHints
      .filter((t) => t.toLowerCase().includes(tagQuery))
      .slice(0, 20);
  }, [normalizedTagHints, tagQuery]);

  const addTagSingle = (tag: string) => {
    const t = tag.trim();
    if (!t) return;

    setTagsArr((prev) => {
      const lower = t.toLowerCase();
      if (prev.some((x) => x.toLowerCase() === lower)) return prev;
      return [...prev, t];
    });
  };

  const addTagsFromInput = (value: string) => {
    const list = splitTags(value);
    if (!list.length) return;
    for (const t of list) addTagSingle(t);
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    const lower = tag.toLowerCase();
    setTagsArr((prev) => prev.filter((x) => x.toLowerCase() !== lower));
  };

  const onParentChange = (val: string) => {
    setParentTaskId(val);
    if (!val) return;

    const p = parents.find((x) => x.id === val);
    if (p && typeof p.sortOrder === "number") {
      setSortOrder(p.sortOrder);
    }
  };

  const resetForNextCreate = () => {
    setCreatedId(null);
    setError(null);
    setLoading(false);

    setTitle("");
    setDescription("");
    setTagsArr([]);
    setTagDraft("");
    setPercentComplete(0);
    setStatus("PLANNED");
    setPriority("MEDIUM");
  };

  async function submit() {
    if (loading || (mode === "create" && createdId)) return; // ✅ защита от двойного клика
    setLoading(true);
    setError(null);
    setCreatedId(null);

    try {
      const payload: any = {
        title,
        description: description ? description : null,
        startDate,
        endDate,
        percentComplete: Number(percentComplete),
        status,
        priority,
        parentTaskId: parentTaskId || null,
        tags: normalizeTagsStringFromArray(tagsArr) || null,
        sortOrder: Number(sortOrder),

        executorName: executorName || null,
        responsibleName: responsibleName || null,
        executorId: execIsExternal ? null : executorId || null,
        responsibleId: respIsExternal ? null : responsibleId || null,
      };

      const url = mode === "create" ? "/api/tasks" : `/api/tasks/${taskId}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Ошибка сохранения");
        return;
      }

      // ✅ EDIT — остаёмся в карточке, но обязательно сбрасываем loading
      if (mode === "edit") {
        const id = String(data.id || taskId);
        router.replace(`/tasks/${id}?return=${effectiveReturnEnc}`);
        router.refresh(); // ✅ важно: гарантировать обновление данных/страницы
        setLoading(false); // ✅ иначе "Сохраняем..." может зависнуть
        return;
      }

      // ✅ CREATE — остаёмся на странице и показываем кнопки
      setCreatedId(String(data.id));
    } catch (e: any) {
      setError(e?.message || "Ошибка сохранения");
    } finally {
      // ✅ для create всегда выключаем loading тут
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {mode === "create" && createdId && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="font-medium">Задача создана ✅</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <a href={`/tasks/${createdId}?return=${effectiveReturnEnc}`}>
              <Button size="sm" variant="secondary">
                Открыть задачу
              </Button>
            </a>
            <Button size="sm" onClick={resetForNextCreate}>
              + Задача
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Название"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />

        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-700">Теги</div>

          <div className="flex flex-wrap gap-2">
            {tagsArr.length === 0 && (
              <div className="text-xs text-slate-500">Нет тегов</div>
            )}
            {tagsArr.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              >
                <span>{t}</span>
                <button
                  type="button"
                  onClick={() => removeTag(t)}
                  className="text-slate-400 hover:text-slate-700"
                  title="Удалить тег"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Добавить тег"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTagsFromInput(tagDraft);
                  }
                }}
                list="tagHintsList"
                placeholder="начни вводить..."
              />
              <datalist id="tagHintsList">
                {normalizedTagHints.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={() => addTagsFromInput(tagDraft)}
            >
              + Добавить
            </Button>
          </div>

          {filteredTagHints.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs text-slate-500 mr-1">Подсказки:</div>
              {filteredTagHints.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addTagSingle(t)}
                  className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  title="Добавить тег"
                >
                  + {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1 sm:col-span-2">
          <div className="text-sm font-medium text-slate-700">Описание</div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Можно с переносами строк, списками и т.д."
            className="min-h-[160px] resize-y whitespace-pre-wrap"
          />
          <div className="text-xs text-slate-500">
            Поддерживаются переносы строк (Enter).
          </div>
        </div>

        <Input
          label="Порядок (sortOrder)"
          type="number"
          value={String(sortOrder)}
          onChange={(e) => setSortOrder(Number(e.target.value))}
        />

        <Input
          label="Дата начала"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
        />
        <Input
          label="Дата окончания"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          required
        />

        <div className="space-y-2">
          <Input
            label="Исполнитель (фамилия/компания)"
            value={executorName}
            onChange={(e) => setExecutorName(e.target.value)}
            list="execHints"
            placeholder="Напр. Ivanov / ABC Ltd"
          />
          <datalist id="execHints">
            {(executorHints ?? []).map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>

          <Select
            label="Исполнитель (пользователь системы)"
            value={executorId}
            onChange={(e) => setExecutorId(e.target.value)}
            disabled={execIsExternal}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>

          {execIsExternal && (
            <div className="text-xs text-slate-500">
              Заполнено имя — пользователь системы игнорируется.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Input
            label="Ответственный (фамилия/компания)"
            value={responsibleName}
            onChange={(e) => setResponsibleName(e.target.value)}
            list="respHints"
            placeholder="Напр. Petrova / XYZ s.r.o."
          />
          <datalist id="respHints">
            {(responsibleHints ?? []).map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>

          <Select
            label="Ответственный (пользователь системы)"
            value={responsibleId}
            onChange={(e) => setResponsibleId(e.target.value)}
            disabled={respIsExternal}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>

          {respIsExternal && (
            <div className="text-xs text-slate-500">
              Заполнено имя — пользователь системы игнорируется.
            </div>
          )}
        </div>

        <Select
          label="Статус"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="PLANNED">PLANNED</option>
          <option value="IN_PROGRESS">IN_PROGRESS</option>
          <option value="PAUSED">PAUSED</option>
          <option value="DONE">DONE</option>
        </Select>

        <Select
          label="Приоритет"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
        </Select>

        <Input
          label="% исполнения"
          type="number"
          min={0}
          max={100}
          value={String(percentComplete)}
          onChange={(e) => setPercentComplete(Number(e.target.value))}
        />

        <Select
          label="Родительская задача (подзадача)"
          value={parentTaskId}
          onChange={(e) => onParentChange(e.target.value)}
        >
          <option value="">(нет)</option>
          {parents.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          onClick={submit}
          disabled={loading || (mode === "create" && createdId !== null)}
        >
          {loading ? "Сохраняем..." : "Сохранить"}
        </Button>

        {mode === "create" && createdId && (
          <Button variant="secondary" onClick={resetForNextCreate}>
            + Задача
          </Button>
        )}

        <a className="text-sm underline self-center" href={effectiveReturnUrl}>
          Отмена
        </a>
      </div>
    </div>
  );
}
