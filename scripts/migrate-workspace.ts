import { workspaceDb } from "../lib/workspace/database";
import { migrateWorkspace } from "../lib/workspace/migrate";
try {
  const report = migrateWorkspace(workspaceDb());
  console.log(
    `Готово: задач ${report.tasks}, родительских групп ${report.createdParents}, записей для проверки ${report.issues.length}. Задачи, комментарии и вложения сохранены.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
