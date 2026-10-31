// components/PreserveQueryLink.tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ReactNode, useMemo } from "react";
import { buildHref, extractGlobalParams } from "@/lib/globalFilters";

export default function PreserveQueryLink({
  href,
  children,
  className,
  title,
}: {
  href: string; // "/tasks" | "/gantt" | "/dashboard"
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const sp = useSearchParams();

  const fullHref = useMemo(() => {
    const current = new URLSearchParams(sp?.toString() ?? "");
    const globals = extractGlobalParams(current);
    return buildHref(href, globals);
  }, [href, sp]);

  return (
    <Link href={fullHref} className={className} title={title}>
      {children}
    </Link>
  );
}
