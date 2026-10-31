// components/NamePolicyManager.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Select, Badge } from "@/components/ui";

type Field = "executorName" | "responsibleName";
type Mode = "hybrid" | "global" | "personal";

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

export default function NamePolicyManager() {
  const [field, setField] = useState<Field>("executorName");
  const [mode, setMode] = useState<Mode>("hybrid");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  // merge UI
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mergeScope, setMergeScope] = useState<"ME" | "GLOBAL">("ME");
  const [mergeMsg, setMergeMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMergeMsg(null);
    try {
      const res = await fetch(`/api/name-policy?field=${field}&mode=${mode}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Ошибка загрузки");
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: any) {
      setItems([]);
      setMergeMsg(e?.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, mode]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) => x.value.toLowerCase().includes(s));
  }, [items, q]);

  const setHidden = async (
    value: string,
    hidden: boolean,
    scope: "ME" | "GLOBAL",
  ) => {
    setMergeMsg(null);
    const res = await fetch("/api/name-policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ field, scope, value, hidden }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMergeMsg(data?.error || "Ошибка сохранения");
      return;
    }
    await load();
  };

  const doMerge = async () => {
    setMergeMsg(null);
    const f = from.trim();
    const t = to.trim();
    if (!f || !t) {
      setMergeMsg("Заполни from/to");
      return;
    }
    const res = await fetch("/api/name-policy/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ field, scope: mergeScope, from: f, to: t }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMergeMsg(data?.error || "Ошибка merge");
      return;
    }
    setMergeMsg(`OK. Обновлено задач: ${data.changed ?? 0}`);
    setFrom("");
    // to оставляем — обычно удобно
    await load();
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap gap-3">
            <Select
              label="Поле"
              value={field}
              onChange={(e) => setField(e.target.value as Field)}
            >
              <option value="executorName">Исполнитель (executorName)</option>
              <option value="responsibleName">
                Ответственный (responsibleName)
              </option>
            </Select>

            <Select
              label="Режим"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="hybrid">Hybrid (GLOBAL + ME)</option>
              <option value="personal">Только ME</option>
              <option value="global">Только GLOBAL</option>
            </Select>

            <Input
              label="Поиск"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="начни вводить…"
            />
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
      </Card>

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-4">
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

          <Select
            label="Scope операции"
            value={mergeScope}
            onChange={(e) => setMergeScope(e.target.value as any)}
          >
            <option value="ME">ME (только мои)</option>
            <option value="GLOBAL">GLOBAL (для всех, админ)</option>
          </Select>

          <div className="flex items-end">
            <Button onClick={doMerge}>Merge / Rename</Button>
          </div>
        </div>

        {mergeMsg && (
          <div className="mt-2 text-sm text-slate-700">{mergeMsg}</div>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-600">
                <th className="py-2 px-3">Значение</th>
                <th className="py-2 px-3">Задач</th>
                <th className="py-2 px-3">Последнее использование</th>
                <th className="py-2 px-3">Статус</th>
                <th className="py-2 px-3">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((x) => (
                <tr key={x.value} className="border-b border-slate-100">
                  <td className="py-2 px-3 text-sm">{x.value}</td>
                  <td className="py-2 px-3 text-sm">{x.count}</td>
                  <td className="py-2 px-3 text-sm">{fmtDate(x.lastUsedAt)}</td>
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
                        onClick={() => setHidden(x.value, !x.hidden, "ME")}
                        title="Скрыть/показать только у меня"
                      >
                        {x.hidden ? "Показать (ME)" : "Скрыть (ME)"}
                      </Button>

                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setHidden(x.value, !x.hidden, "GLOBAL")}
                        title="Скрыть/показать глобально (только админ)"
                      >
                        {x.hidden ? "Показать (GLOBAL)" : "Скрыть (GLOBAL)"}
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => {
                          setFrom(x.value);
                          if (!to) setTo(x.value);
                        }}
                        title="Подставить в merge"
                      >
                        В merge
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td className="py-3 px-3 text-sm text-slate-600" colSpan={5}>
                    Ничего не найдено.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
