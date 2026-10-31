// components/TaskDescriptionCell.tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

function truncate(s: string, n = 90) {
  const v = (s || "").trim();
  if (v.length <= n) return v;
  return v.slice(0, n - 1) + "…";
}

export default function TaskDescriptionCell({
  description,
}: {
  description: string | null | undefined;
}) {
  const text = (description ?? "").trim();
  const hasText = text.length > 0;

  if (!hasText) return <span className="text-slate-400">—</span>;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="truncate text-sm text-slate-700 max-w-[360px]">
        {truncate(text, 90)}
      </span>

      <HoverCard openDelay={200}>
        <HoverCardTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Show description"
            title="Show description"
          >
            ℹ️
          </Button>
        </HoverCardTrigger>

        <HoverCardContent className="w-[480px]">
          <div className="max-h-[260px] overflow-auto text-sm text-slate-900 whitespace-pre-wrap">
            {text}
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}
