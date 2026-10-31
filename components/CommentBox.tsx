"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";

export default function CommentBox({ taskId }: { taskId: string }) {
  const router = useRouter();

  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const v = body.trim();
    if (!v) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: v }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Не удалось добавить комментарий");
        setLoading(false);
        return;
      }

      setBody("");
      setLoading(false);
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setLoading(false);
    }

    // ✅ вместо полной перезагрузки
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Input
        label="Комментарий"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Например: пауза, потому что ждем подрядчика..."
      />
      {error && <div className="text-sm text-red-600">{error}</div>}
      <Button size="sm" onClick={submit} disabled={loading}>
        {loading ? "Добавляем..." : "Добавить"}
      </Button>
    </div>
  );
}
