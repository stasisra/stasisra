import { Suspense } from "react";
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md">
        <Suspense fallback={<div>Загрузка…</div>}>{children}</Suspense>
      </div>
    </div>
  );
}
