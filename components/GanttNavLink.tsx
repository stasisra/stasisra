// components/GanttNavLink.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function GanttNavLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const sp = useSearchParams();
  const [savedHref, setSavedHref] = useState("/gantt");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("gantt:lastQuery");
      if (!saved) return;

      if (saved.startsWith("/gantt")) setSavedHref(saved);
      else if (saved.startsWith("?")) setSavedHref(`/gantt${saved}`);
      else if (saved === "/gantt") setSavedHref("/gantt");
    } catch {}
  }, []);

  const href = useMemo(() => {
    const qs = sp?.toString() ?? "";
    if (qs.length > 0) return `/gantt?${qs}`;
    return savedHref;
  }, [sp, savedHref]);

  return (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}
