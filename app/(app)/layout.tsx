// app/(app)/layout.tsx
import { getSession } from "@/lib/auth";
import { Button } from "@/components/ui";
import TasksNavLink from "@/components/TasksNavLink";
import GanttNavLink from "@/components/GanttNavLink";
import DashboardNavLink from "@/components/DashboardNavLink";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-none items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <DashboardNavLink className="text-sm font-semibold">
              Task &amp; Gantt
            </DashboardNavLink>

            <nav className="flex items-center gap-3 text-sm text-slate-600">
              <TasksNavLink className="hover:text-slate-900">
                Tasks
              </TasksNavLink>
              <GanttNavLink className="hover:text-slate-900">
                Gantt
              </GanttNavLink>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-600">
              {session?.name}{" "}
              <span className="text-slate-400">({session?.role})</span>
            </div>
            <form action="/api/auth/logout" method="post">
              <Button variant="secondary" size="sm" type="submit">
                Выйти
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-none px-4 py-6">{children}</main>
    </div>
  );
}
