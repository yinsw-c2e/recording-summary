import type { ThoughtCard } from "./api";

export type CompletedActions = Record<string, true>;

export interface FocusActionItem {
  id: string;
  action: string;
  title: string;
  type: string;
}

export function markdownList(items: string[], emptyText: string): string[] {
  return items.length ? items.map((item) => `- ${item}`) : [`- ${emptyText}`];
}

export function buildFocusListeningScript(input: {
  day: string;
  cards: ThoughtCard[];
  actionItems: FocusActionItem[];
  completedActions: CompletedActions;
  completedActionCount: number;
  reviewCards: ThoughtCard[];
}): string {
  const { actionItems, cards, completedActionCount, completedActions, day, reviewCards } = input;
  if (!cards.length) return "";
  const starredCards = cards.filter((card) => card.starred);
  const pendingActionItems = actionItems.filter((item) => !completedActions[item.id]);
  const lines = [
    `${day}重点。共 ${cards.length} 张卡片，${starredCards.length} 个已标重点，${actionItems.length} 个行动项，已完成 ${completedActionCount} 个，${reviewCards.length} 个待确认。`
  ];

  if (starredCards.length) {
    lines.push("已标重点卡片。");
    starredCards.slice(0, 6).forEach((card, index) => {
      lines.push(`${index + 1}. ${card.title}。${card.summary}`);
    });
    if (starredCards.length > 6) lines.push(`还有 ${starredCards.length - 6} 张已标重点卡片，请打开页面查看。`);
  }

  if (actionItems.length) {
    lines.push(pendingActionItems.length ? "未完成行动项。" : "所有行动项已完成。");
    pendingActionItems.slice(0, 10).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.action}。来自：${item.title}。`);
    });
    if (pendingActionItems.length > 10) lines.push(`还有 ${pendingActionItems.length - 10} 个未完成行动项，请打开页面查看。`);
  }

  if (reviewCards.length) {
    lines.push("待确认内容。");
    reviewCards.slice(0, 5).forEach((card, index) => {
      lines.push(`${index + 1}. ${card.title}。${card.summary}`);
    });
    if (reviewCards.length > 5) lines.push(`还有 ${reviewCards.length - 5} 条待确认内容。`);
  }

  if (!starredCards.length && !actionItems.length && !reviewCards.length) {
    lines.push("今天没有明确行动项或待确认问题。主要卡片包括。");
    cards.slice(0, 6).forEach((card, index) => {
      lines.push(`${index + 1}. ${card.title}。${card.summary}`);
    });
    if (cards.length > 6) lines.push(`还有 ${cards.length - 6} 张卡片。`);
  }

  return lines.join("\n");
}

export function buildFocusExportMarkdown(input: {
  day: string;
  cards: ThoughtCard[];
  actionItems: FocusActionItem[];
  completedActions: CompletedActions;
  completedActionCount: number;
  reviewCards: ThoughtCard[];
  typeLabels: Record<string, string>;
}): string {
  const { actionItems, cards, completedActionCount, completedActions, day, reviewCards, typeLabels } = input;
  if (!cards.length) return "";
  const starredCards = cards.filter((card) => card.starred);
  const lines = [
    `# ${day} 重点`,
    "",
    `- 卡片：${cards.length}`,
    `- 已标重点：${starredCards.length}`,
    `- 行动项：${actionItems.length}`,
    `- 已完成行动项：${completedActionCount}`,
    `- 待确认：${reviewCards.length}`,
    "",
    "## 已标重点",
    ...markdownList(
      starredCards.map((card) => `${typeLabels[card.type] ?? card.type}｜${card.title}：${card.summary}`),
      "暂无手动标记的重点卡片"
    ),
    "",
    "## 行动项",
    ...markdownList(
      actionItems.map((item) => `[${completedActions[item.id] ? "x" : " "}] ${item.action}（${typeLabels[item.type] ?? item.type}：${item.title}）`),
      "暂无明确行动项"
    )
  ];

  if (reviewCards.length) {
    lines.push("", "## 待确认", ...reviewCards.map((card) => `- ${card.title}：${card.summary}`));
  }

  lines.push(
    "",
    "## 卡片",
    ...cards.map((card) => `- ${typeLabels[card.type] ?? card.type}｜${card.title}：${card.summary}`)
  );

  return lines.join("\n");
}
