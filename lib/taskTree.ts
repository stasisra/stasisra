export type FlatTask = {
  id: string;
  title: string;
  parentTaskId: string | null;
  sortOrder: number;
};

export type TreeNode<T> = T & { level: number; children: TreeNode<T>[] };

export function buildTree<T extends FlatTask>(items: T[]) {
  const byId = new Map<string, TreeNode<T>>();
  for (const t of items) {
    byId.set(t.id, { ...(t as any), level: 0, children: [] });
  }

  const roots: TreeNode<T>[] = [];
  for (const t of items) {
    const node = byId.get(t.id)!;
    const seen = new Set<string>([t.id]);
    let parent = t.parentTaskId;
    let cyclic = false;
    while (parent && byId.has(parent)) {
      if (seen.has(parent)) {
        cyclic = true;
        break;
      }
      seen.add(parent);
      parent = byId.get(parent)!.parentTaskId;
    }
    if (t.parentTaskId && byId.has(t.parentTaskId) && !cyclic) {
      byId.get(t.parentTaskId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (n: TreeNode<T>) => {
    n.children.sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        a.title.localeCompare(b.title),
    );
    for (const c of n.children) sortRec(c);
  };
  roots.sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.title.localeCompare(b.title),
  );
  for (const r of roots) sortRec(r);

  const setLevels = (n: TreeNode<T>, level: number) => {
    n.level = level;
    for (const c of n.children) setLevels(c, level + 1);
  };
  for (const r of roots) setLevels(r, 0);

  return roots;
}

export function flattenTree<T extends FlatTask>(
  roots: TreeNode<T>[],
  expanded: Set<string>,
) {
  const out: TreeNode<T>[] = [];
  const walk = (n: TreeNode<T>) => {
    out.push(n);
    if (n.children.length && expanded.has(n.id)) {
      for (const c of n.children) walk(c);
    }
  };
  for (const r of roots) walk(r);
  return out;
}
