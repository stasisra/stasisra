// components/TaskLink.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import React, { useMemo } from "react";

type Props = Omit<React.ComponentProps<typeof Link>, "href"> & {
  taskId: string;
  /**
   * Если хочешь принудительно задать return (например из server component) —
   * передай уже encodeURIComponent(...) строку.
   */
  returnTo?: string;
};

export default function TaskLink({ taskId, returnTo, ...rest }: Props) {
  const pathname = usePathname();
  const sp = useSearchParams();

  const ret = useMemo(() => {
    if (returnTo && returnTo.trim()) return returnTo;

    const qs = sp?.toString() ?? "";
    const full = qs ? `${pathname}?${qs}` : pathname;
    return encodeURIComponent(full);
  }, [returnTo, pathname, sp]);

  const href = `/tasks/${taskId}${ret ? `?return=${ret}` : ""}`;

  return <Link href={href} {...rest} />;
}
