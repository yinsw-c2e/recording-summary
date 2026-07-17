import { describe, expect, it } from "vitest";
import {
  findAdjacentContentDay,
  matchesMonthContentFilter,
  monthOverviewDetail,
  monthOverviewHasContent,
  orderedMonthContentDays,
  summarizeMonthAttention,
  type MonthContentFilter
} from "../src/monthContent";
import type { MonthDayOverview } from "../src/api";

function overview(dayKey: string, input: Partial<MonthDayOverview> = {}): MonthDayOverview {
  return {
    dayKey,
    recordings: 0,
    pending: 0,
    cards: 0,
    reviewDue: 0,
    hasSummary: false,
    summaryVersion: null,
    ...input
  };
}

describe("month content helpers", () => {
  it("uses the same content definition for recordings, cards, review due, and summaries", () => {
    expect(monthOverviewHasContent(overview("2026-07-01"))).toBe(false);
    expect(monthOverviewHasContent(overview("2026-07-02", { recordings: 1 }))).toBe(true);
    expect(monthOverviewHasContent(overview("2026-07-03", { cards: 1 }))).toBe(true);
    expect(monthOverviewHasContent(overview("2026-07-04", { reviewDue: 1 }))).toBe(true);
    expect(monthOverviewHasContent(overview("2026-07-05", { hasSummary: true }))).toBe(true);
  });

  it("filters content days by pending, review due, and summary state", () => {
    const pending = overview("2026-07-06", { pending: 1 });
    const reviewDue = overview("2026-07-07", { reviewDue: 2 });
    const summary = overview("2026-07-08", { hasSummary: true });

    const cases: Array<[MonthContentFilter, MonthDayOverview, boolean]> = [
      ["all", pending, true],
      ["pending", pending, true],
      ["pending", summary, false],
      ["review_due", reviewDue, true],
      ["review_due", pending, false],
      ["summary", summary, true],
      ["summary", reviewDue, false]
    ];

    cases.forEach(([filter, item, expected]) => {
      expect(matchesMonthContentFilter(item, filter)).toBe(expected);
    });
  });

  it("finds adjacent content days in calendar order and respects the today ceiling", () => {
    const days = [
      overview("2026-07-12", { pending: 1 }),
      overview("2026-07-05", { cards: 1 }),
      overview("2026-07-06", { recordings: 1 })
    ];

    expect(orderedMonthContentDays(days).map((item) => item.dayKey)).toEqual(["2026-07-05", "2026-07-06", "2026-07-12"]);
    expect(findAdjacentContentDay(days, "2026-07-07", "previous")?.dayKey).toBe("2026-07-06");
    expect(findAdjacentContentDay(days, "2026-07-07", "next")?.dayKey).toBe("2026-07-12");
    expect(findAdjacentContentDay(days, "2026-07-07", "next", "2026-07-10")).toBeUndefined();
  });

  it("keeps compact detail text stable for calendar chips", () => {
    expect(monthOverviewDetail(overview("2026-07-09", { recordings: 2, pending: 1, cards: 3, reviewDue: 1, summaryVersion: 4 }))).toBe(
      "2录 1待 3卡 1待复 v4"
    );
  });

  it("summarizes overdue month attention and ignores future days", () => {
    const summary = summarizeMonthAttention(
      [
        overview("2026-07-12", { pending: 2, reviewDue: 1 }),
        overview("2026-07-03", { reviewDue: 3 }),
        overview("2026-07-18", { pending: 9, reviewDue: 9 })
      ],
      "2026-07-12"
    );

    expect(summary.pendingDays).toBe(1);
    expect(summary.pendingTotal).toBe(2);
    expect(summary.firstPendingDay?.dayKey).toBe("2026-07-12");
    expect(summary.reviewDueDays).toBe(2);
    expect(summary.reviewDueTotal).toBe(4);
    expect(summary.firstReviewDueDay?.dayKey).toBe("2026-07-03");
  });
});
