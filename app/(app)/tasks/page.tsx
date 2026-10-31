import { getSession } from "@/lib/auth";
import { scopeWhere, toParams, type Params } from "@/lib/taskQuery";
import { queryTasks } from "@/lib/tasks";
import { getFilterOptions } from "@/lib/filterOptions";
import { Button } from "@/components/ui";
import TasksTableClient from "@/components/TasksTableClient";
import TaskFiltersSheet from "@/components/TaskFiltersSheet";
import RememberGlobalFilters from "@/components/RememberGlobalFilters";
import RememberQuery from "@/components/RememberQuery";
export const dynamic = "force-dynamic";
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) return null;
  const params = await searchParams;
  const [tasks, options] = await Promise.all([
    queryTasks(session, params, true),
    getFilterOptions(session, scopeWhere(session)),
  ]);
  const serialized = tasks.map((t) => ({
    ...t,
    startDate: t.startDate.toISOString(),
    endDate: t.endDate.toISOString(),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    comments: t.comments.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
  }));
  const qs = toParams(params as Params).toString();
  return (
    <div className="space-y-4">
      <RememberGlobalFilters />
      <RememberQuery storageKey="tasks:lastQuery" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <div className="flex flex-wrap items-center gap-2">
          <TaskFiltersSheet
            {...options}
            showStatus
            showExpand
            showDashboardView={false}
          />
          {(["csv", "xlsx", "pdf"] as const).map((ext) => (
            <a key={ext} href={`/api/tasks/export.${ext}?${qs}`}>
              <Button variant="secondary" size="sm">
                {ext.toUpperCase()}
              </Button>
            </a>
          ))}
          <a
            href={`/tasks/new?return=${encodeURIComponent("/tasks" + (qs ? "?" + qs : ""))}`}
          >
            <Button>+ Задача</Button>
          </a>
        </div>
      </div>
      <TasksTableClient
        tasks={serialized}
        {...options}
        descriptionHints={[]}
        titleHints={[]}
      />
    </div>
  );
}
