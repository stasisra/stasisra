"use client";

import { useSearchParams } from "next/navigation";
import { internalPath } from "@/lib/navigation";
import { useState } from "react";
import { Button, Card, Input } from "@/components/ui";

export default function LoginPage() {
  const sp = useSearchParams();
  const next = internalPath(sp.get("next"), "/dashboard");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось войти");
        return;
      }
      window.location.assign(next);
    } catch {
      setError("Нет соединения с сервером. Повторите вход.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold">Вход</h1>
      <p className="mt-1 text-sm text-slate-600">Вход администратора</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label="Пароль"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <Button className="w-full" disabled={loading}>
          {loading ? "Входим..." : "Войти"}
        </Button>
      </form>
    </Card>
  );
}
