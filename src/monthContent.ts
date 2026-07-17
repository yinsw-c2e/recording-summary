import type { MonthDayOverview } from "./api";

export type MonthContentFilter = "all" | "pending" | "review_due" | "summary";
export type ContentDayDirection = "previous" | "next";

export interface MonthAttentionSummary {
  pendingDays: number;
  pendingTotal: number;
  firstPendingDay: MonthDayOverview | null;
  reviewDueDays: number;
  reviewDueTotal: number;
  firstReviewDueDay: MonthDayOverview | null;
}

export const monthContentFilterLabels: Record<MonthContentFilter, string> = {
  all: "全部",
  pending: "待处理",
  review_due: "待复习",
  summary: "有总结"
};

export function monthOverviewHasContent(overview: MonthDayOverview): boolean {
  return Boolean(overview.recordings || overview.pending || overview.cards || overview.reviewDue || overview.hasSummary);
}

export function monthOverviewDetail(overview?: MonthDayOverview): string {
  if (!overview) return "";
  return [
    overview.recordings ? `${overview.recordings}录` : "",
    overview.pending ? `${overview.pending}待` : "",
    overview.cards ? `${overview.cards}卡` : "",
    overview.reviewDue ? `${overview.reviewDue}待复` : "",
    overview.summaryVersion ? `v${overview.summaryVersion}` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

export function matchesMonthContentFilter(overview: MonthDayOverview, filter: MonthContentFilter): boolean {
  if (filter === "pending") return overview.pending > 0;
  if (filter === "review_due") return overview.reviewDue > 0;
  if (filter === "summary") return overview.hasSummary;
  return true;
}

export function orderedMonthContentDays(days: MonthDayOverview[]): MonthDayOverview[] {
  return [...days].sort((left, right) => left.dayKey.localeCompare(right.dayKey));
}

export function findAdjacentContentDay(
  days: MonthDayOverview[],
  activeDay: string,
  direction: ContentDayDirection,
  maxDay?: string
): MonthDayOverview | undefined {
  const ordered = orderedMonthContentDays(days);
  if (direction === "previous") {
    return [...ordered].reverse().find((item) => item.dayKey < activeDay);
  }
  return ordered.find((item) => item.dayKey > activeDay && (!maxDay || item.dayKey <= maxDay));
}

export function summarizeMonthAttention(days: MonthDayOverview[], maxDay?: string): MonthAttentionSummary {
  const eligible = orderedMonthContentDays(days).filter((item) => !maxDay || item.dayKey <= maxDay);
  const pending = eligible.filter((item) => item.pending > 0);
  const reviewDue = eligible.filter((item) => item.reviewDue > 0);

  return {
    pendingDays: pending.length,
    pendingTotal: pending.reduce((total, item) => total + item.pending, 0),
    firstPendingDay: pending[0] ?? null,
    reviewDueDays: reviewDue.length,
    reviewDueTotal: reviewDue.reduce((total, item) => total + item.reviewDue, 0),
    firstReviewDueDay: reviewDue[0] ?? null
  };
}
