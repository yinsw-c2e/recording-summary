import { describe, expect, it } from "vitest";
import {
  buildDayArchiveMarkdown,
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

  it("builds a complete day archive markdown with summary, recordings, actions, and cards", () => {
    const projectCard = card({
      id: "project-card",
      type: "project_idea",
      title: "手机端日档案",
      summary: "把当天内容整理成一份完整 Markdown。",
      keyPoints: ["导出当前选中的日期", "包含总结和卡片"],
      actions: ["在手机上验证复制和下载"],
      tags: ["导出", "H5"],
      confidence: 0.82,
      starred: true
    });
    const actionItems: FocusActionItem[] = [
      {
        id: "project-card-0",
        cardId: "project-card",
        actionIndex: 0,
        action: "在手机上验证复制和下载",
        title: projectCard.title,
        type: projectCard.type
      }
    ];

    const markdown = buildDayArchiveMarkdown({
      day: "2026-07-18",
      summaryMarkdown: "# 2026-07-18 日总结\n\n今天完成导出能力。",
      cards: [projectCard],
      recordings: [
        {
          time: "22:30:01",
          duration: "00:18",
          status: "已整理",
          cardCount: 1,
          note: "已生成卡片并参与总结。"
        }
      ],
      actionItems,
      completedActions: { "project-card-0": true },
      typeLabels: { project_idea: "项目想法" }
    });

    expect(markdown).toContain("# 2026-07-18 日档案");
    expect(markdown).toContain("- 录音：1");
    expect(markdown).toContain("# 2026-07-18 日总结");
    expect(markdown).toContain("- 22:30:01｜00:18｜已整理｜1 张卡片；已生成卡片并参与总结。");
    expect(markdown).toContain("- [x] 在手机上验证复制和下载（项目想法：手机端日档案）");
    expect(markdown).toContain("### 1. 手机端日档案");
    expect(markdown).toContain("- 置信度：82%");
    expect(markdown).toContain("- 导出当前选中的日期");
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
