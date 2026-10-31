import { getFilterOptions } from "@/lib/filterOptions";
import { internalPath } from "@/lib/navigation";
// app/(app)/tasks/new/page.tsx
import { Card, Button } from "@/components/ui";
import TaskForm from "@/components/TaskForm";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { scopeWhere } from "@/lib/taskQuery";

function firstStr(v: string | string[] | undefined) {
  if (!v) return "";
  return Array.isArray(v) ? String(v[0] ?? "") : String(v);
}

export default async function TaskCreatePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) return null;

  const baseWhere = scopeWhere(session);
  const parentId = (
    (typeof searchParams?.parentId === "string"
      ? searchParams.parentId
      : ""
    ).trim() || ""
  ).trim();

  const returnUrlRaw = firstStr(searchParams?.return).trim();
  const returnUrl = internalPath(returnUrlRaw);

  const [users, parents, parent] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),

    prisma.task.findMany({
      where: baseWhere,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, title: true, sortOrder: true },
    }),

    parentId
      ? prisma.task.findFirst({
          where: { AND: [{ id: parentId }, baseWhere] },
          select: { id: true, tags: true, sortOrder: true },
        })
      : Promise.resolve(null),
  ]);

  const {
    executorOptions: executorHints,
    responsibleOptions: responsibleHints,
    tagOptions: tagHints,
  } = await getFilterOptions(session, baseWhere);

  const initial = parent
    ? {
        parentTaskId: parent.id,
        tags: parent.tags ?? "",
        sortOrder: (parent.sortOrder ?? 0) + 10,
      }
    : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {parent ? "Новая подзадача" : "Новая задача"}
        </h1>

        {/* ✅ возвращаемся “туда же” */}
        <a href={returnUrl}>
          <Button variant="secondary">← Назад</Button>
        </a>
      </div>

      <Card className="p-4">
        <TaskForm
          mode="create"
          users={users}
          parents={parents}
          currentUserId={session.id}
          executorHints={executorHints}
          responsibleHints={responsibleHints}
          tagHints={tagHints}
          initial={initial}
          returnUrl={returnUrl} // ✅ NEW
        />
      </Card>
    </div>
  );
}
