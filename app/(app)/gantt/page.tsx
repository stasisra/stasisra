import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { queryTasks } from "@/lib/tasks";
import { scopeWhere } from "@/lib/taskQuery";
import { getFilterOptions } from "@/lib/filterOptions";
import GanttBoard from "@/components/GanttBoard";
import TaskFiltersSheet from "@/components/TaskFiltersSheet";
import RememberGlobalFilters from "@/components/RememberGlobalFilters";
export default async function GanttPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) return null;
  const params = await searchParams;
  const [tasks, options, users] = await Promise.all([
    queryTasks(session, params, true),
    getFilterOptions(session, scopeWhere(session)),
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const serialized = tasks.map((t) => ({
    ...t,
    startDate: t.startDate.toISOString(),
    endDate: t.endDate.toISOString(),
    comments: t.comments.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
  }));
  return (
    <div className="space-y-4">
      <RememberGlobalFilters />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Gantt</h1>
        <TaskFiltersSheet
          {...options}
          showStatus
          showExpand={false}
          showDashboardView={false}
        />
      </div>
      <GanttBoard
        initialTasks={serialized}
        users={users}
        initialMode={params.mode === "week" ? "week" : "day"}
        focusId={typeof params.focus === "string" ? params.focus : null}
      />
    </div>
  );
}
