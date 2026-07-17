export type ActionItemFilter = "open" | "all" | "done";

export interface ActionItemLike {
  id: string;
}

export type CompletedActionMap = Record<string, true | undefined>;

export const actionItemFilters: Array<{ key: ActionItemFilter; label: string }> = [
  { key: "open", label: "待办" },
  { key: "all", label: "全部" },
  { key: "done", label: "已完成" }
];

export function isActionItemDone(item: ActionItemLike, completedActions: CompletedActionMap): boolean {
  return Boolean(completedActions[item.id]);
}

export function matchesActionItemFilter(
  item: ActionItemLike,
  completedActions: CompletedActionMap,
  filter: ActionItemFilter
): boolean {
  if (filter === "all") return true;
  const done = isActionItemDone(item, completedActions);
  return filter === "done" ? done : !done;
}

export function countActionItemFilters(
  items: ActionItemLike[],
  completedActions: CompletedActionMap
): Record<ActionItemFilter, number> {
  return {
    open: items.filter((item) => matchesActionItemFilter(item, completedActions, "open")).length,
    all: items.length,
    done: items.filter((item) => matchesActionItemFilter(item, completedActions, "done")).length
  };
}

export function orderActionItems<T extends ActionItemLike>(items: T[], completedActions: CompletedActionMap): T[] {
  return items
    .map((item, index) => ({ item, index, done: isActionItemDone(item, completedActions) }))
    .sort((left, right) => Number(left.done) - Number(right.done) || left.index - right.index)
    .map(({ item }) => item);
}
