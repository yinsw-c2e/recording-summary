import type { LinkResult, OrganizeResult, QualityResult } from "../schema";
import type { LLMProvider, LinkCardsInput, OrganizeTranscriptInput, SummaryInput } from "./llm";

function inferType(text: string): OrganizeResult["items"][number]["type"] {
  if (/怎么办|为什么|是否|怎么|问题|疑惑|不确定/.test(text)) return "question";
  if (/待办|需要|明天|记得|去做|行动|实现|开发/.test(text)) return "task";
  if (/知识|概念|学习|复习|理解|原理/.test(text)) return "knowledge";
  if (/idea|灵感|想法|突然想到|记录一下/i.test(text) && !/项目|产品|功能|软件|系统|方案|用户/.test(text)) return "raw_idea";
  if (/项目|产品|功能|软件|系统|方案|用户/.test(text)) return "project_idea";
  if (/感觉|反思|情绪|今天/.test(text)) return "reflection";
  return "daily_note";
}

function tagsFor(text: string): string[] {
  const tags = new Set<string>();
  if (/语音|录音|播放|音频/.test(text)) tags.add("语音记录");
  if (/AI|模型|DeepSeek|提示词|整理/.test(text)) tags.add("AI整理");
  if (/知识|复习|学习/.test(text)) tags.add("知识复习");
  if (/项目|软件|产品|功能/.test(text)) tags.add("产品想法");
  if (/手机|PWA|网页/.test(text)) tags.add("移动端");
  if (tags.size === 0) tags.add("日常记录");
  return [...tags].slice(0, 5);
}

function splitThoughts(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks = normalized
    .split(/(?:。|！|？|\n|；|;|然后呢|再一个|另外|还有一个|我又想到)/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 6);
  return chunks.length ? chunks : [normalized];
}

export class MockLLMProvider implements LLMProvider {
  name = "mock";

  async correctTranscript(input: { rawText: string }): Promise<string> {
    return input.rawText;
  }

  async organizeTranscript(input: OrganizeTranscriptInput): Promise<OrganizeResult> {
    const parts = splitThoughts(input.rawText);
    return {
      cleanedTranscript: input.rawText.replace(/嗯|啊|这个这个|就是说/g, "").trim(),
      items: parts.map((part, index) => ({
        type: inferType(part),
        title: part.length > 26 ? `${part.slice(0, 26)}...` : part,
        summary: part,
        keyPoints: [part],
        actions: /做|实现|开发|需要/.test(part) ? [part] : [],
        tags: tagsFor(part),
        sourceTextRange: `segment-${index + 1}`,
        sourceQuote: part.slice(0, 220),
        confidence: 0.62
      }))
    };
  }

  async linkCards(input: LinkCardsInput): Promise<LinkResult> {
    const relations: LinkResult["relations"] = [];
    for (const card of input.newCards) {
      const best = input.candidateCards.find((candidate) => {
        if (candidate.id === card.id) return false;
        return card.tags.some((tag) => candidate.tags.includes(tag));
      });
      if (best) {
        relations.push({
          fromTitle: card.title,
          toCardId: best.id,
          relationType: card.type === best.type ? "continuation" : "project_link",
          confidence: 0.58,
          rationale: "本地 mock 根据标签重合建立弱关联。"
        });
      }
    }
    return { relations };
  }

  async checkQuality(): Promise<QualityResult> {
    return { issues: [] };
  }

  async writeSummary(input: SummaryInput): Promise<string> {
    const heading = input.period === "day" ? "日总结" : input.period === "week" ? "周总结" : "月总结";
    const byType = input.cards.reduce<Record<string, number>>((acc, card) => {
      acc[card.type] = (acc[card.type] ?? 0) + 1;
      return acc;
    }, {});
    const typeLines = Object.entries(byType).map(([type, count]) => `- ${type}: ${count} 条`);
    const actionLines = input.cards.flatMap((card) => card.actions.map((action) => `- ${action}`)).slice(0, 8);
    const cardLines = input.cards.slice(0, 12).map((card) => `- **${card.title}**：${card.summary}`);
    return [
      `# ${input.periodKey} ${heading}`,
      "",
      `本周期整理出 ${input.cards.length} 条卡片。`,
      "",
      "## 分类概览",
      ...(typeLines.length ? typeLines : ["- 暂无分类内容"]),
      "",
      "## 重点内容",
      ...(cardLines.length ? cardLines : ["- 暂无内容"]),
      "",
      "## 行动项",
      ...(actionLines.length ? actionLines : ["- 暂无明确行动项"])
    ].join("\n");
  }

  async writeListeningScript(input: SummaryInput & { summaryMarkdown: string }): Promise<string> {
    const label = input.period === "day" ? "今天" : input.period === "week" ? "本周" : "本月";
    const cards = input.cards.slice(0, 8).map((card, index) => `${index + 1}. ${card.title}。${card.summary}`).join("\n");
    return `${label}的复习开始。你一共沉淀了 ${input.cards.length} 条内容。\n${cards || "目前还没有可复习的内容。"}\n复习结束。`;
  }
}
