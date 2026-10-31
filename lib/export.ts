import { buildTree } from "./taskTree";
import type { queryTasks } from "./tasks";
export function exportRows(tasks: Awaited<ReturnType<typeof queryTasks>>) {
  const rows: Array<(typeof tasks)[number] & { level: number }> = [];
  const visit = (
    node: ReturnType<typeof buildTree<(typeof tasks)[number]>>[number],
  ) => {
    rows.push(node);
    for (const child of node.children) visit(child);
  };
  for (const root of buildTree(tasks)) visit(root);
  return rows;
}
export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
