import { describe, expect, it } from "vitest";
import { countActionItemFilters, matchesActionItemFilter, orderActionItems } from "../src/actionItems";

describe("action item filters", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const completed = { b: true } as const;

  it("keeps unfinished actions visible in the open filter", () => {
    expect(items.filter((item) => matchesActionItemFilter(item, completed, "open")).map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("separates completed actions while keeping all actions countable", () => {
    expect(items.filter((item) => matchesActionItemFilter(item, completed, "done")).map((item) => item.id)).toEqual(["b"]);
    expect(countActionItemFilters(items, completed)).toEqual({
      open: 2,
      all: 3,
      done: 1
    });
  });

  it("orders unfinished actions before completed ones without changing relative order", () => {
    expect(orderActionItems(items, completed).map((item) => item.id)).toEqual(["a", "c", "b"]);
  });
});
