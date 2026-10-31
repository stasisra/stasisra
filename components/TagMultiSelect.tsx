"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Input } from "@/components/ui";

type Props = {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

export default function TagMultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "Выбери...",
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const normalizedOptions = useMemo(() => {
    return uniq(options.map((x) => x.trim()).filter(Boolean)).sort((a, b) =>
      a.localeCompare(b, "ru"),
    );
  }, [options]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return normalizedOptions.slice(0, 200);
    return normalizedOptions
      .filter((x) => x.toLowerCase().includes(qq))
      .slice(0, 200);
  }, [normalizedOptions, q]);

  const toggle = (t: string) => {
    const exists = value.some((x) => x.toLowerCase() === t.toLowerCase());
    if (exists)
      onChange(value.filter((x) => x.toLowerCase() !== t.toLowerCase()));
    else onChange([...value, t]);
  };

  const clear = () => onChange([]);

  return (
    <div className="relative">
      <div className="mb-1 text-sm text-slate-700">{label}</div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:bg-slate-50"
      >
        {value.length ? (
          <span className="inline-flex flex-wrap gap-1">
            {value.slice(0, 6).map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
            {value.length > 6 && (
              <span className="text-xs text-slate-500">
                +{value.length - 6}
              </span>
            )}
          </span>
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <div className="flex items-center gap-2">
            <Input
              label=""
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="поиск..."
            />
            <Button variant="secondary" type="button" onClick={clear}>
              Очистить
            </Button>
          </div>

          <div className="mt-2 max-h-64 overflow-auto">
            {filtered.length === 0 && (
              <div className="py-2 text-sm text-slate-500">
                Ничего не найдено
              </div>
            )}

            {filtered.map((t) => {
              const checked = value.some(
                (x) => x.toLowerCase() === t.toLowerCase(),
              );
              return (
                <label key={t} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(t)}
                  />
                  <span>{t}</span>
                </label>
              );
            })}
          </div>

          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Готово
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
