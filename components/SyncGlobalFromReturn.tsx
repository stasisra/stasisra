// components/SyncGlobalFromReturn.tsx
"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

function safeDecodeURIComponent(v: string) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export default function SyncGlobalFromReturn() {
  const sp = useSearchParams();

  useEffect(() => {
    const retRaw = (sp?.get("return") ?? "").trim();
    if (!retRaw) return;

    const decoded = safeDecodeURIComponent(retRaw);
    const qIndex = decoded.indexOf("?");
    const qs = qIndex >= 0 ? decoded.slice(qIndex + 1) : "";

    // сохраняем именно ГЛОБАЛЬНЫЕ фильтры как есть (без d_*)
    const p = new URLSearchParams(qs);

    const keep = new URLSearchParams();
    const keys = [
      "ex",
      "resp",
      "tin",
      "tex",
      "st",
      "done",
      "dueTo",
      "exp",
      "overdue",
      "due",
    ];
    for (const k of keys) {
      const v = p.get(k);
      if (v != null && String(v).trim().length > 0) keep.set(k, v);
    }

    // дефолт: exp=1 (если нет exp)
    if (!keep.has("exp")) keep.set("exp", "1");

    localStorage.setItem("filters:globalQuery", keep.toString());
  }, [sp]);

  return null;
}
