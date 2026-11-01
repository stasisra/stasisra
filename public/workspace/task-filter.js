/* Shared, local task-tree selection. A rule applies to a node and its descendants;
   a deeper rule overrides it. No data is stored or sent by this module. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TaskTreeFilter = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  function normalize(selection = {}) {
    const ids = (value) => [
      ...new Set(
        (Array.isArray(value) ? value : []).filter(
          (id) => typeof id === "string" && id.length > 0 && id.length <= 100,
        ),
      ),
    ];
    const exclude = ids(selection.exclude),
      excluded = new Set(exclude);
    return {
      all: selection.all !== false,
      include: ids(selection.include).filter((id) => !excluded.has(id)),
      exclude,
    };
  }
  function createIndex(tasks) {
    const byId = new Map(tasks.map((task) => [task.id, task])),
      children = new Map(),
      order = [],
      parents = new Map(),
      seen = new Set();
    for (const task of tasks) {
      if (task.parent && task.parent !== task.id && byId.has(task.parent)) {
        const group = children.get(task.parent) || [];
        group.push(task.id);
        children.set(task.parent, group);
      }
    }
    const visit = (root) => {
      const pending = [{ id: root, level: 0, parent: null }];
      while (pending.length) {
        const entry = pending.pop();
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        parents.set(entry.id, entry.parent);
        order.push({ ...entry, task: byId.get(entry.id) });
        const group = children.get(entry.id) || [];
        for (let i = group.length - 1; i >= 0; i--)
          pending.push({
            id: group[i],
            level: entry.level + 1,
            parent: entry.id,
          });
      }
    };
    for (const task of tasks)
      if (!task.parent || task.parent === task.id || !byId.has(task.parent))
        visit(task.id);
    for (const task of tasks) if (!seen.has(task.id)) visit(task.id);
    return { byId, children, order, parents };
  }
  function resolve(index, input) {
    const selection = normalize(input),
      rules = new Map(selection.include.map((id) => [id, true]));
    for (const id of selection.exclude) rules.set(id, false);
    const selected = new Set(),
      states = new Map(),
      stats = new Map();
    for (const entry of index.order) {
      const state = rules.has(entry.id)
        ? rules.get(entry.id)
        : entry.parent
          ? states.get(entry.parent)
          : selection.all;
      states.set(entry.id, state);
      if (state) selected.add(entry.id);
      stats.set(entry.id, { total: 1, selected: state ? 1 : 0 });
    }
    for (let i = index.order.length - 1; i >= 0; i--) {
      const entry = index.order[i];
      if (entry.parent) {
        const child = stats.get(entry.id),
          parent = stats.get(entry.parent);
        parent.total += child.total;
        parent.selected += child.selected;
      }
    }
    return { selected, stats };
  }
  function descendants(index, id) {
    const set = new Set(),
      pending = index.byId.has(id) ? [id] : [];
    while (pending.length) {
      const current = pending.pop();
      if (set.has(current)) continue;
      set.add(current);
      for (const child of index.children.get(current) || [])
        pending.push(child);
    }
    return set;
  }
  function toggle(index, input, id, checked) {
    const previous = normalize(input);
    if (!index.byId.has(id)) return previous;
    const below = descendants(index, id),
      next = {
        all: previous.all,
        include: previous.include.filter((value) => !below.has(value)),
        exclude: previous.exclude.filter((value) => !below.has(value)),
      };
    let inherited = next.all,
      parent = index.parents.get(id);
    const positive = new Set(next.include),
      negative = new Set(next.exclude);
    while (parent) {
      if (negative.has(parent)) {
        inherited = false;
        break;
      }
      if (positive.has(parent)) {
        inherited = true;
        break;
      }
      parent = index.parents.get(parent);
    }
    if (Boolean(checked) !== inherited)
      (checked ? next.include : next.exclude).push(id);
    return normalize(next);
  }
  return { normalize, createIndex, resolve, descendants, toggle };
});
