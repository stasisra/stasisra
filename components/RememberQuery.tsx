// components/RememberQuery.tsx
"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const TASKS_ALLOWED_KEYS = new Set([
  "ex",
  "resp",
  "tin",
  "tex",
  "st",
  "done",
  "dueTo",
  "overdue",
  "due",
  "exp",
  "tagMode",
]);

function sanitizeTasksQuery(qs: string) {
  const p = new URLSearchParams(qs);

  // никогда не сохраняем return
  p.delete("return");

  // legacy tasks keys
  p.delete("executor");
  p.delete("responsible");
  p.delete("tagsPick");
  p.delete("tagsHide");
  p.delete("status");
  p.delete("showDone");

  // dashboard keys
  p.delete("d_focus");
  p.delete("d_commentsDays");
  p.delete("d_sort");
  p.delete("d_tagMode");
  p.delete("focusDays");
  p.delete("commentsDays");
  p.delete("sort");

  // whitelist: всё неизвестное удаляем
  for (const k of Array.from(p.keys())) {
    if (!TASKS_ALLOWED_KEYS.has(k)) p.delete(k);
  }

  // ✅ нормализация пустых значений
  for (const k of Array.from(p.keys())) {
    const v = (p.get(k) ?? "").trim();
    if (!v) p.delete(k);
    else p.set(k, v);
  }

  return p.toString();
}

export default function RememberQuery({ storageKey }: { storageKey: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();

  useEffect(() => {
    try {
      const qs = sp?.toString() ?? "";

      // ✅ КРИТИЧНО: tasks:lastQuery записываем ТОЛЬКО если есть фильтры
      if (storageKey === "tasks:lastQuery") {
        const cleaned = sanitizeTasksQuery(qs);

        // ✅ если фильтров нет — НЕ перетираем сохранённый lastQuery значением "/tasks"

        const full = `${pathname}${cleaned ? `?${cleaned}` : ""}`;
        localStorage.setItem(storageKey, full);
        return;
      }

      // default: сохраняем как есть
      const full = qs ? `${pathname}?${qs}` : pathname;
      localStorage.setItem(storageKey, full);
    } catch {}
  }, [storageKey, pathname, sp]);

  return null;
}
