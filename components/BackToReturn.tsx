"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function BackToReturn({
  fallbackHref = "/tasks",
  className = "",
}: {
  fallbackHref?: string;
  className?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const ret = sp.get("return");

  const goBack = () => {
    if (ret) {
      // ret already encoded when we created the link
      const decoded = decodeURIComponent(ret);
      router.push(decoded);
      return;
    }
    // if user opened task directly (no return)
    router.push(fallbackHref);
  };

  return (
    <button
      type="button"
      onClick={goBack}
      className={className || "text-sm underline"}
    >
      ← Назад
    </button>
  );
}
