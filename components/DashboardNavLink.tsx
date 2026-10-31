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

  // если на dashboard есть свои d_* — можно тоже тащить
  "d_focus",
  "d_commentsDays",
  "d_sort",
  "d_tagMode",
]);

function buildDashboardHrefFromSearchParams(
  sp: URLSearchParams,
): string | null {
  const out = new URLSearchParams();

  for (const k of Array.from(GLOBAL_KEYS)) {
    const v = sp.get(k);
    if (v != null && String(v).trim().length > 0) out.set(k, v);
  }

  // никогда не тащим return
  out.delete("return");

  const qs = out.toString();
  return qs ? `/dashboard?${qs}` : null;
}

function buildDashboardHrefFromTasksLastQuery(): string | null {
  try {
    const saved = localStorage.getItem("tasks:lastQuery") || "";
    if (!saved) return null;

    const qIndex = saved.indexOf("?");
    if (qIndex === -1) return null;

    const qs = saved.slice(qIndex + 1).trim();
    if (!qs) return null;

    const p = new URLSearchParams(qs);
    p.delete("return");

    // оставляем только известные глобальные ключи
    for (const k of Array.from(p.keys())) {
      if (!GLOBAL_KEYS.has(k)) p.delete(k);
    }

    const out = p.toString();
    return out ? `/dashboard?${out}` : "/dashboard";
  } catch {
    return null;
  }
}

function normalizeDashboardHref(raw: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;

  if (v.startsWith("/dashboard")) return v;
  if (v.startsWith("?")) return `/dashboard${v}`;

  const dec = safeDecodeURIComponent(v).trim();
  if (dec.startsWith("/dashboard")) return dec;
  if (dec.startsWith("?")) return `/dashboard${dec}`;

  return null;
}

export default function DashboardNavLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const spHook = useSearchParams();
  const [savedHref, setSavedHref] = useState<string>("/dashboard");

  useEffect(() => {
    // optional: если когда-то будешь сохранять "dashboard:lastQuery"
    try {
      const saved = localStorage.getItem("dashboard:lastQuery");
      const norm = saved ? normalizeDashboardHref(saved) : null;
      if (norm) setSavedHref(norm);
    } catch {}
  }, []);

  const href = useMemo(() => {
    const sp = new URLSearchParams(spHook?.toString() ?? "");

    // 1) если пришли с return (редко для dashboard, но пусть будет)
    const retRaw = sp.get("return") ?? "";
    const retDec = safeDecodeURIComponent(retRaw).trim();
    if (retDec.startsWith("/dashboard")) return retDec;

    // 2) если уже есть фильтры в URL — строим dashboard из них
    const fromCurrent = buildDashboardHrefFromSearchParams(sp);
    if (fromCurrent) return fromCurrent;

    // 3) иначе — берём из tasks:lastQuery
    const fromTasks = buildDashboardHrefFromTasksLastQuery();
    if (fromTasks) return fromTasks;

    // 4) fallback
    return savedHref || "/dashboard";
  }, [spHook, savedHref]);

  return (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}
