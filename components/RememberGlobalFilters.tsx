// components/RememberGlobalFilters.tsx
"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { extractGlobalParams, saveGlobalToStorage } from "@/lib/globalFilters";

// Какие страницы имеют право "запоминать" глобальные фильтры
const ALLOW_PREFIXES = ["/tasks", "/gantt", "/dashboard"];

// Страницы, где НЕЛЬЗЯ трогать global-filters
const BLOCK_PREFIXES = [
  "/admin",
  "/auth",
  "/login",
  "/register",

  // ✅ важно: справочники реально живут тут
  "/dashboard/dictionaries",
];

function startsWithAny(path: string, prefixes: string[]) {
  return prefixes.some(
    (p) => path === p || path.startsWith(p + "/") || path.startsWith(p),
  );
}

export default function RememberGlobalFilters() {
  const sp = useSearchParams();
  const pathname = usePathname() || "";

  useEffect(() => {
    // 1) Жёстко блокируем админку/справочники/авторизацию
    if (startsWithAny(pathname, BLOCK_PREFIXES)) return;

    // 2) Разрешаем только на целевых страницах (tasks/gantt/dashboard)
    if (!startsWithAny(pathname, ALLOW_PREFIXES)) return;

    const current = new URLSearchParams(sp?.toString() ?? "");

    // 3) ВАЖНО: если в URL нет ни одного глобального ключа —
    // ничего не сохраняем, чтобы НЕ перетирать storage пустотой/дефолтами.

    const globals = extractGlobalParams(current);
    saveGlobalToStorage(globals);
  }, [sp, pathname]);

  return null;
}
