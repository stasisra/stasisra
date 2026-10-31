// components/TaskDescriptionHover.tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

function compactOneLine(s: string, n = 140) {
  const v = (s || "").replace(/\s+/g, " ").trim();
  if (v.length <= n) return v;
  return v.slice(0, n - 1) + "…";
}

export default function TaskDescriptionHover({
  description,
  indentPx = 0,
}: {
  description: string | null | undefined;
  indentPx?: number;
}) {
  const text = (description ?? "").trim();
  if (!text) return null;

  return (
    <div
      className="text-xs text-slate-600 min-w-0"
      style={{ paddingLeft: indentPx }}
    >
      <div className="flex items-start gap-2 min-w-0">
        <span className="truncate">{compactOneLine(text, 140)}</span>

        <HoverCard openDelay={180}>
          <HoverCardTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              aria-label="Show description"
              title="Show description"
            >
              ℹ️
            </Button>
          </HoverCardTrigger>

          <HoverCardContent className="w-[520px]">
            <div className="max-h-[280px] overflow-auto text-sm text-slate-900 whitespace-pre-wrap">
              {text}
            </div>
          </HoverCardContent>
        </HoverCard>
      </div>
    </div>
  );
}
