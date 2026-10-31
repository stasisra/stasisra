// components/TasksNavLink.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function safeDecodeURIComponent(v: string) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function normalizeTasksHref(raw: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;

  // already /tasks...
  if (v.startsWith("/tasks")) return v;

  // ?tin=...
  if (v.startsWith("?")) return `/tasks${v}`;

  // url-encoded
  const dec = safeDecodeURIComponent(v).trim();
  if (dec.startsWith("/tasks")) return dec;
  if (dec.startsWith("?")) return `/tasks${dec}`;

  return null;
}

// ✅ глобальные ключи, которые должны “переезжать” между страницами
const GLOBAL_KEYS = new Set([
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

// ✅ legacy → canonical (на случай, если где-то еще всплывает старое)
const LEGACY_MAP: Record<string, string> = {
  executor: "ex",
  responsible: "resp",
  tagsPick: "tin",
  tagsHide: "tex",
  status: "st",
  showDone: "done",
};

function buildTasksHrefFromCurrentQuery(sp: URLSearchParams): string | null {
  const out = new URLSearchParams();

  // 1) canonical keys
  for (const k of Array.from(GLOBAL_KEYS)) {
    const v = sp.get(k);
    if (v != null && String(v).trim().length > 0) out.set(k, v);
  }

  // 2) legacy fallback (только если canonical отсутствует)
  for (const [legacy, canon] of Object.entries(LEGACY_MAP)) {
    if (out.has(canon)) continue;
    const v = sp.get(legacy);
    if (v != null && String(v).trim().length > 0) out.set(canon, v);
  }

  // важное: НЕ переносим dashboard-only и gantt-only ключи типа d_* / focus / mode / return
  const qs = out.toString();
  if (!qs) return null;

  return `/tasks?${qs}`;
}

export default function TasksNavLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const spHook = useSearchParams();
  const [savedHref, setSavedHref] = useState("/tasks");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tasks:lastQuery");
      const norm = saved ? normalizeTasksHref(saved) : null;
      if (norm) setSavedHref(norm);
    } catch {}
  }, []);

  const href = useMemo(() => {
    const sp = new URLSearchParams(spHook?.toString() ?? "");

    // 1) return has priority (card -> tasks)
    const retRaw = sp.get("return") ?? "";
    const ret = normalizeTasksHref(retRaw);
    if (ret) return ret;

    // 2) build /tasks from current page global filters (dashboard/gantt -> tasks)
    const fromCurrent = buildTasksHrefFromCurrentQuery(sp);
    if (fromCurrent) return fromCurrent;

    // 3) fallback to last saved tasks list
    return savedHref || "/tasks";
  }, [spHook, savedHref]);

  return (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}
