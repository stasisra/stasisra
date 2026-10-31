// lib/globalFilters.ts
export const GLOBAL_FILTER_KEYS = [
  "ex",
  "resp",
  "st",
  "tin",
  "tex",
  "dueTo",
  "done",
  "exp",
  "tagMode",
  "overdue",
  "due",
] as const;
export type GlobalFilterKey = (typeof GLOBAL_FILTER_KEYS)[number];

export function isGlobalKey(k: string): k is GlobalFilterKey {
  return (GLOBAL_FILTER_KEYS as readonly string[]).includes(k);
}

/**
 * Нормализация:
 * - done: только "1" (иначе удалить)
 * - exp: только "0" или "1" (если нет — ставим "1" по дефолту)
 */
export function normalizeGlobalParams(input: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();

  for (const key of GLOBAL_FILTER_KEYS) {
    const v = (input.get(key) ?? "").trim();
    if (!v) continue;
    out.set(key, v);
  }

  // done
  if (out.get("done") !== "1") out.delete("done");

  // exp: обязателен (A-логика)
  const exp = out.get("exp");
  if (exp !== "0" && exp !== "1") out.set("exp", "1");

  return out;
}

/**
 * Берём ТОЛЬКО глобальные ключи из текущего URL.
 * Никакие d_*, mode, return, overdue/due, legacy и т.п. сюда не попадут.
 */
export function extractGlobalParams(input: URLSearchParams): URLSearchParams {
  return normalizeGlobalParams(input);
}

/**
 * Строим ссылку вида "/tasks?ex=...&tin=...".
 * Если глобальных параметров нет — вернёт просто "/tasks".
 */
export function buildHref(path: string, globals: URLSearchParams): string {
  const qs = globals.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Утилита: есть ли в URL хоть один глобальный фильтр (кроме exp) */
export function hasAnyGlobalData(globals: URLSearchParams): boolean {
  // exp всегда есть, поэтому не считаем его “данными”
  const keys = ["ex", "resp", "st", "tin", "tex", "dueTo", "done"];
  return keys.some((k) => (globals.get(k) ?? "").trim().length > 0);
}

export const GLOBAL_STORAGE_KEY = "filters:globalQuery";

/**
 * Достаём глобальные фильтры из localStorage (строка query без '?').
 * Возвращаем нормализованные params.
 */
export function loadGlobalFromStorage(): URLSearchParams {
  try {
    const raw = localStorage.getItem(GLOBAL_STORAGE_KEY) || "";
    const sp = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
    return normalizeGlobalParams(sp);
  } catch {
    // дефолт: exp=1
    const d = new URLSearchParams();
    d.set("exp", "1");
    return d;
  }
}

export function saveGlobalToStorage(globals: URLSearchParams) {
  try {
    const norm = normalizeGlobalParams(globals);
    localStorage.setItem(GLOBAL_STORAGE_KEY, norm.toString());
  } catch {}
}
