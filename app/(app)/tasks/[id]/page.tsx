import { internalPath } from "@/lib/navigation";
// app/(app)/tasks/[id]/page.tsx
import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui";
import TaskForm from "@/components/TaskForm";
import CommentBox from "@/components/CommentBox";
import { prisma } from "@/lib/db";
import { getSession, canSeeTask } from "@/lib/auth";
import { TaskAttachmentsInline } from "@/components/TaskAttachmentsInline";

// ✅ NEW
import { scopeWhere } from "@/lib/taskQuery";
import { getFilterOptions } from "@/lib/filterOptions";

function safeDecodeURIComponent(v: string) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function splitTags(s?: string | null) {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function uniqSorted(arr: string[]) {
  return Array.from(new Set(arr.map((x) => x.trim()).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b, "ru"),
  );
}

export default async function TaskDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) return null;

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    include: {
      executor: { select: { id: true, name: true } },
      responsible: { select: { id: true, name: true } },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!task) return <div className="text-sm">Задача не найдена</div>;
  if (!canSeeTask(session, task as any))
    return <div className="text-sm">Нет доступа</div>;

  // ✅ NEW: scope для текущего пользователя
  const baseWhere = scopeWhere(session);

  const currentUserId = (session as any).id;

  const canDeleteComment = (c: any) =>
    session.role === "ADMIN" ||
    (c.authorId && c.authorId === currentUserId) ||
    task.executor?.id === currentUserId ||
    task.responsible?.id === currentUserId;

  // ===== return URL (чтобы не терять фильтры) =====
  const returnParamRaw = searchParams?.return;
  const returnParam =
    typeof returnParamRaw === "string"
      ? returnParamRaw
      : Array.isArray(returnParamRaw)
        ? returnParamRaw[0]
        : "";

  const returnDecoded = returnParam
    ? safeDecodeURIComponent(returnParam).trim()
    : "";
  const returnUrl = internalPath(returnDecoded);
  const returnEnc = encodeURIComponent(returnUrl);

  // ✅ CHANGED: options теперь через getFilterOptions (учитывает hidden)
  const [{ executorOptions, responsibleOptions, tagOptions }, users, parents] =
    await Promise.all([
      getFilterOptions(session, baseWhere),

      prisma.user.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),

      prisma.task.findMany({
        where: baseWhere as any, // важно: чтобы не тянуть чужие задачи в список родителей
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, title: true, sortOrder: true },
      }),
    ]);

  // ✅ IMPORTANT: если у задачи уже стоит скрытое значение — показываем его в подсказках,
  // чтобы оно не “пропало” при сохранении.
  const currentExec = (task.executorName ?? "").trim();
  const currentResp = (task.responsibleName ?? "").trim();
  const currentTags = splitTags(task.tags);

  const executorHints = uniqSorted([
    ...(executorOptions ?? []),
    ...(currentExec ? [currentExec] : []),
  ]);
  const responsibleHints = uniqSorted([
    ...(responsibleOptions ?? []),
    ...(currentResp ? [currentResp] : []),
  ]);
  const tagHints = uniqSorted([...(tagOptions ?? []), ...currentTags]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div>
            <Link
              href={returnUrl}
              className="text-sm text-slate-600 hover:text-slate-900 hover:underline"
            >
              ← Назад
            </Link>
          </div>

          <h1 className="text-2xl font-semibold">{task.title}</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge>{task.status}</Badge>
            <Badge>{task.priority}</Badge>
            <Badge>{task.percentComplete}%</Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TaskAttachmentsInline taskId={task.id} taskTitle={task.title} />

          <form action={`/api/tasks/${task.id}`} method="post">
            <input type="hidden" name="_method" value="DELETE" />
            <input type="hidden" name="return" value={returnUrl} />
            <Button variant="danger" size="sm" type="submit">
              Удалить
            </Button>
          </form>

          <Link
            href={`/gantt?focus=${encodeURIComponent(task.id)}&return=${returnEnc}`}
          >
            <Button variant="secondary" size="sm">
              Показать в Ганте
            </Button>
          </Link>

          <Link
            href={`/tasks/new?parentId=${encodeURIComponent(task.id)}&return=${returnEnc}`}
          >
            <Button variant="secondary" size="sm">
              + Подзадача
            </Button>
          </Link>
        </div>
      </div>

      <Card className="p-4">
        <h2 className="text-base font-semibold">Редактирование</h2>
        <div className="mt-3">
          <TaskForm
            mode="edit"
            users={users}
            parents={parents.filter((p) => p.id !== task.id)}
            initial={task}
            taskId={task.id}
            currentUserId={currentUserId}
            executorHints={executorHints}
            responsibleHints={responsibleHints}
            tagHints={tagHints}
          />
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-base font-semibold">Комментарии</h2>
        <div className="mt-3">
          <CommentBox taskId={task.id} />
        </div>

        <div className="mt-4 space-y-2">
          {task.comments.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-xs text-slate-500">
                  {(c as any).author?.name ?? "—"} ·{" "}
                  {new Date(c.createdAt)
                    .toISOString()
                    .replace("T", " ")
                    .slice(0, 16)}{" "}
                  UTC
                </div>

                {canDeleteComment(c) && (
                  <form action={`/api/comments/${c.id}`} method="post">
                    <input type="hidden" name="_method" value="DELETE" />
                    <input type="hidden" name="return" value={returnUrl} />
                    <Button variant="danger" size="sm" type="submit">
                      Удалить
                    </Button>
                  </form>
                )}
              </div>

              <div className="mt-1 text-sm">{c.body}</div>
            </div>
          ))}

          {task.comments.length === 0 && (
            <div className="text-sm text-slate-600">Пока нет комментариев.</div>
          )}
        </div>
      </Card>
    </div>
  );
}
