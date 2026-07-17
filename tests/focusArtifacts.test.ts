import { describe, expect, it } from "vitest";
import {
  buildFocusExportMarkdown,
  buildFocusListeningScript,
  buildReviewDueListeningScript,
  type FocusActionItem
} from "../src/focusArtifacts";
import type { ThoughtCard } from "../src/api";

function card(input: Partial<ThoughtCard> & Pick<ThoughtCard, "id" | "title" | "summary">): ThoughtCard {
  return {
    type: "daily_note",
    keyPoints: [],
    actions: [],
    tags: [],
    confidence: 0.7,
    sourceRecordingId: `${input.id}-recording`,
    sourceTextRange: "segment-1",
    starred: false,
    reviewed: false,
    ...input
  };
}

describe("focus artifacts", () => {
  it("includes manually starred cards before action items in the listening script", () => {
    const starred = card({
      id: "starred-card",
      title: "重点复习卡片",
      summary: "这条没有行动项，但应该被朗读出来。",
      starred: true
    });
    const actionCard = card({
      id: "action-card",
      title: "行动卡片",
      summary: "这条提供行动项。"
    });
    const actionItems: FocusActionItem[] = [
      {
        id: "action-card-0",
        cardId: "action-card",
        actionIndex: 0,
        action: "继续整理复习流程",
        title: actionCard.title,
        type: actionCard.type
      }
    ];

    const script = buildFocusListeningScript({
      day: "2026-07-17",
      cards: [starred, actionCard],
      actionItems,
      completedActions: {},
      completedActionCount: 0,
      reviewCards: []
    });

    expect(script).toContain("1 个已标重点");
    expect(script).toContain("2 个待复习");
    expect(script).toContain("已标重点卡片。");
    expect(script).toContain("重点复习卡片。这条没有行动项，但应该被朗读出来。");
    expect(script.indexOf("已标重点卡片。")).toBeLessThan(script.indexOf("未完成行动项。"));
  });

  it("adds a starred-card section to the copied focus markdown", () => {
    const starred = card({
      id: "starred-card",
      type: "knowledge",
      title: "重点知识",
      summary: "需要反复听的知识点。",
      starred: true
    });

    const markdown = buildFocusExportMarkdown({
      day: "2026-07-17",
      cards: [starred],
      actionItems: [],
      completedActions: {},
      completedActionCount: 0,
      reviewCards: [],
      typeLabels: { knowledge: "知识" }
    });

    expect(markdown).toContain("- 已标重点：1");
    expect(markdown).toContain("- 待复习：1");
    expect(markdown).toContain("## 已标重点");
    expect(markdown).toContain("- 知识｜重点知识：需要反复听的知识点。");
  });

  it("builds a listening script only from unreviewed cards and reads starred cards first", () => {
    const reviewed = card({
      id: "reviewed-card",
      title: "已经复习过",
      summary: "这条不应该再次朗读。",
      reviewed: true
    });
    const regular = card({
      id: "regular-card",
      type: "daily_note",
      title: "普通待复习",
      summary: "这条可以稍后朗读。"
    });
    const starred = card({
      id: "starred-review-card",
      type: "knowledge",
      title: "重点待复习",
      summary: "这条应该优先朗读。",
      starred: true
    });

    const script = buildReviewDueListeningScript({
      day: "2026-07-18",
      cards: [reviewed, regular, starred],
      typeLabels: { daily_note: "记录", knowledge: "知识" }
    });

    expect(script).toContain("共 2 张卡片");
    expect(script).toContain("其中 1 张已标重点");
    expect(script).toContain("知识，重点待复习。这条应该优先朗读。");
    expect(script).toContain("记录，普通待复习。这条可以稍后朗读。");
    expect(script).not.toContain("已经复习过");
    expect(script.indexOf("重点待复习")).toBeLessThan(script.indexOf("普通待复习"));
  });

  it("returns an empty review-due script after all cards are reviewed", () => {
    const script = buildReviewDueListeningScript({
      day: "2026-07-18",
      cards: [
        card({
          id: "reviewed-card",
          title: "已经复习过",
          summary: "不需要再次朗读。",
          reviewed: true
        })
      ],
      typeLabels: {}
    });

    expect(script).toBe("");
  });
});
