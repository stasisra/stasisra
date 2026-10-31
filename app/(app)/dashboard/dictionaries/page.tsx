// app/(app)/dashboard/dictionaries/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Badge } from "@/components/ui";

type DictType = "tags" | "executors" | "responsibles";

type Item = {
  value: string;
  count: number;
  lastUsedAt: string | null;
  hidden: boolean;
};

function fmtDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(s));
  } catch {
    return s;
  }
}

function normSpaces(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function keyOf(s: string) {
  return normSpaces(s).toLowerCase();
}

function typeLabel(t: DictType) {
  if (t === "tags") return "Теги";
  if (t === "executors") return "Исполнители";
  return "Ответственные";
}

function readTypeFromLocation(): DictType {
  try {
    const u = new URL(window.location.href);
    const t = (u.searchParams.get("type") ?? "tags") as DictType;
    if (t === "tags" || t === "executors" || t === "responsibles") return t;
    return "tags";
  } catch {
    return "tags";
  }
}

function buildDashboardHrefFromTasksLastQuery() {
  try {
    const saved = localStorage.getItem("tasks:lastQuery") || "";
    if (!saved) return "/dashboard";

    // saved обычно "/tasks?...". Нам нужен только querystring
    const qIndex = saved.indexOf("?");
    if (qIndex === -1) return "/dashboard";

    const qs = saved.slice(qIndex + 1).trim();
    if (!qs) return "/dashboard";

    // на всякий случай чистим return (если вдруг когда-то попадет)
    const p = new URLSearchParams(qs);
    p.delete("return");

    const out = p.toString();
    return out ? `/dashboard?${out}` : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export default function DictionariesPage() {
  const [type, setType] = useState<DictType>("tags");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [activeFirst, setActiveFirst] = useState(true);

  // add
  const [newValue, setNewValue] = useState("");
  const [adding, setAdding] = useState(false);

  // merge
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [merging, setMerging] = useState(false);

  // init type from URL
  useEffect(() => {
    setType(readTypeFromLocation());
  }, []);

  // sync URL when type changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);

    // ✅ убираем весь мусор (ex/tin/exp/return и т.д.)
    u.search = "";
    u.searchParams.set("type", type);

    window.history.replaceState({}, "", u.toString());
  }, [type]);

  const load = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/dictionaries?type=${type}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Ошибка загрузки");
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: any) {
      setItems([]);
      setMsg(e?.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let out = !s
      ? items
      : items.filter((x) => x.value.toLowerCase().includes(s));

    out = [...out].sort((a, b) => {
      if (activeFirst) {
        if (a.hidden !== b.hidden) return a.hidden ? 1 : -1; // active first
      }
      return a.value.localeCompare(b.value, "ru");
    });

    return out;
  }, [items, q, activeFirst]);

  const setHidden = async (value: string, hidden: boolean) => {
    setMsg(null);
    const res = await fetch("/api/dictionaries/hide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, value, hidden, scope: "ME" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data?.error || "Ошибка сохранения");
      return;
    }
    await load();
  };

  const doAdd = async () => {
    setMsg(null);
    const v = normSpaces(newValue);
    if (!v) {
      setMsg("Введите значение");
      return;
    }
    if (type === "tags" && v.includes(",")) {
      setMsg("Тег не может содержать запятую");
      return;
    }

    setAdding(true);
    try {
      const res = await fetch("/api/dictionaries/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, value: v, scope: "ME" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Ошибка добавления");
      setNewValue("");
      await load();
    } catch (e: any) {
      setMsg(e?.message || "Ошибка");
    } finally {
      setAdding(false);
    }
  };

  const doMerge = async () => {
    setMsg(null);
    const f = normSpaces(from);
    const t = normSpaces(to);
    if (!f || !t) {
      setMsg("Заполните from/to");
      return;
    }
    if (keyOf(f) === keyOf(t)) {
      setMsg("from и to одинаковые");
      return;
    }
    if (type === "tags" && (f.includes(",") || t.includes(","))) {
      setMsg("Тег не может содержать запятую");
      return;
    }

    setMerging(true);
    try {
      const res = await fetch("/api/dictionaries/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, from: f, to: t, scope: "ME" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Ошибка merge");
      setMsg(`OK. Обновлено задач: ${data.changed ?? 0}`);
      setFrom("");
      // to оставляем — удобно
      await load();
    } catch (e: any) {
      setMsg(e?.message || "Ошибка");
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <a
              href="#"
              className="text-sm underline"
              onClick={(e) => {
                e.preventDefault();
                window.location.href = buildDashboardHrefFromTasksLastQuery();
              }}
            >
              ← Назад
            </a>

            <div className="text-lg font-semibold">Справочники</div>
          </div>

          <a
            href="#"
            className="text-sm underline"
            title="Закрыть и вернуться в Dashboard"
            onClick={(e) => {
              e.preventDefault();
              window.location.href = buildDashboardHrefFromTasksLastQuery();
            }}
          >
            ✕ Закрыть
          </a>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Left menu */}
        <Card className="p-3">
          <div className="text-xs text-slate-500 uppercase tracking-wide">
            Раздел
          </div>
          <div className="mt-2 space-y-1">
            {(["tags", "executors", "responsibles"] as DictType[]).map((t) => {
              const active = t === type;
              return (
                <button
                  key={t}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm border ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                  onClick={() => setType(t)}
                >
                  {typeLabel(t)}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Right */}
        <div className="space-y-4">
          {/* Controls */}
          <Card className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-wrap gap-3">
                <Input
                  label="Поиск"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="начни вводить…"
                />

                <div className="flex items-center gap-2 pt-6">
                  <input
                    id="activeFirst"
                    type="checkbox"
                    checked={activeFirst}
                    onChange={(e) => setActiveFirst(e.target.checked)}
                  />
                  <label
                    htmlFor="activeFirst"
                    className="text-sm text-slate-700"
                  >
                    Сначала активные
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={load} disabled={loading}>
                  {loading ? "..." : "Обновить"}
                </Button>
                <span className="text-sm text-slate-600">
                  Всего: {items.length}
                </span>
              </div>
            </div>

            {msg && <div className="mt-3 text-sm text-slate-700">{msg}</div>}
          </Card>

          {/* Add */}
          <Card className="p-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
              <Input
                label={`Добавить: ${typeLabel(type)}`}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={
                  type === "tags" ? "например: marketing" : "например: Alex"
                }
              />
              <div className="flex items-end">
                <Button onClick={doAdd} disabled={adding}>
                  {adding ? "..." : "+ Добавить"}
                </Button>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {type === "tags"
                ? "Правило: в одном теге нельзя использовать запятую."
                : "Добавление влияет только на подсказки, задачи не меняет."}
            </div>
          </Card>

          {/* Merge */}
          <Card className="p-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_220px]">
              <Input
                label="from (как сейчас)"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <Input
                label="to (как должно быть)"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
              <div className="flex items-end">
                <Button onClick={doMerge} disabled={merging}>
                  {merging ? "..." : "Merge / Rename"}
                </Button>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              После merge старое значение будет скрыто из подсказок.{" "}
              {type === "tags"
                ? "Теги заменяются как отдельные элементы списка, дубли удаляются."
                : ""}
            </div>
          </Card>

          {/* Table */}
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-600">
                    <th className="py-2 px-3">Значение</th>
                    <th className="py-2 px-3">Используется</th>
                    <th className="py-2 px-3">Последнее</th>
                    <th className="py-2 px-3">Статус</th>
                    <th className="py-2 px-3">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((x) => (
                    <tr
                      key={x.value}
                      className={`border-b border-slate-100 ${x.hidden ? "opacity-70" : ""}`}
                    >
                      <td className="py-2 px-3 text-sm">{x.value}</td>
                      <td className="py-2 px-3 text-sm">{x.count}</td>
                      <td className="py-2 px-3 text-sm">
                        {fmtDate(x.lastUsedAt)}
                      </td>
                      <td className="py-2 px-3">
                        {x.hidden ? (
                          <Badge>HIDDEN</Badge>
                        ) : (
                          <span className="text-sm text-slate-600">active</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setHidden(x.value, !x.hidden)}
                            title="Скрыть/показать в подсказках"
                          >
                            {x.hidden ? "Показать" : "Скрыть"}
                          </Button>

                          <Button
                            size="sm"
                            onClick={() => {
                              setFrom(x.value);
                              if (!to) setTo(x.value);
                            }}
                            title="Подставить значение в поле from"
                          >
                            В merge
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filtered.length === 0 && (
                    <tr>
                      <td
                        className="py-3 px-3 text-sm text-slate-600"
                        colSpan={5}
                      >
                        Ничего не найдено.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
