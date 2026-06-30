import OpenAI from "openai";
import { config } from "../config";
import {
  linkResultSchema,
  organizeResultSchema,
  qualityResultSchema,
  type LinkResult,
  type OrganizeResult,
  type QualityResult
} from "../schema";
import type { ThoughtCard } from "../types";
import type { LLMProvider, LinkCardsInput, OrganizeTranscriptInput, SummaryInput } from "./llm";

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return JSON.parse(match[1]);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error("LLM response did not contain a JSON object.");
}

function cardDigest(card: ThoughtCard): string {
  return [
    `id: ${card.id}`,
    `type: ${card.type}`,
    `title: ${card.title}`,
    `summary: ${card.summary}`,
    `tags: ${card.tags.join(", ")}`
  ].join("\n");
}

export class DeepSeekProvider implements LLMProvider {
  name = "deepseek";
  private client: OpenAI;

  constructor() {
    if (!config.deepseek.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is required when LLM_PROVIDER=deepseek.");
    }
    this.client = new OpenAI({
      apiKey: config.deepseek.apiKey,
      baseURL: config.deepseek.baseUrl
    });
  }

  async correctTranscript(input: { rawText: string }): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: config.deepseek.model,
      messages: [
        {
          role: "system",
          content: [
            "你是中文语音转写纠错助手。",
            "任务：修正 ASR 转写中的繁体字、同音错字、明显断句和标点问题。",
            "严格保留原意，不要总结，不要扩写，不要新增原文没有的信息。",
            "如果某个词无法确定，保留原词，不要强行猜测。只输出修正后的纯文本。"
          ].join("\n")
        },
        {
          role: "user",
          content: input.rawText
        }
      ]
    });
    return response.choices[0]?.message.content?.trim() || input.rawText;
  }

  async organizeTranscript(input: OrganizeTranscriptInput): Promise<OrganizeResult> {
    const response = await this.client.chat.completions.create({
      model: input.deepMode ? config.deepseek.proModel : config.deepseek.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是一个个人语音想法整理系统，不是普通摘要助手。",
            "你的任务是从口语转写里识别独立思想单元，去除废话，但保留事实。",
            "不是每段内容都需要总结成知识点；有些只是要保存的灵感、idea 或生活记录。",
            "对只需要保留的想法，用 raw_idea；不要强行升格为项目、知识或任务。",
            "不要为了文章流畅而合并无关内容；不确定时用 uncertain。",
            "行动项必须来自原文，不允许编造。",
            "所有输出必须是 JSON，不能输出 Markdown。"
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "请按以下 JSON 结构输出：",
            `{
  "cleanedTranscript": "去掉语气词后的清洗版文本",
  "items": [
    {
      "type": "raw_idea|project_idea|knowledge|task|question|reflection|daily_note|uncertain",
      "title": "短标题",
      "summary": "保留原意的记录或提炼结果",
      "keyPoints": ["关键点"],
      "actions": ["明确来自原文的行动项"],
      "tags": ["短标签"],
      "sourceTextRange": "原文中的位置描述",
      "sourceQuote": "能追溯到原文的短片段",
      "confidence": 0.0
    }
  ]
}`,
            "类型说明：raw_idea=突然想到的灵感或未成熟想法，只需要记录；project_idea=明确指向某个项目/产品/功能的想法；knowledge=可复习知识；task=明确要做的事；question=疑问；reflection=反思；daily_note=日常记录。",
            "拆分规则：按语义切换、新对象、新问题、从想法变任务、从项目变知识点来拆分，不只依赖停顿。",
            "如果一段话只是犹豫、口头禅或重复，清洗掉；如果它是一个还没展开的想法但可能有价值，优先保留为 raw_idea；如果连含义都不确定，再用 uncertain。",
            "keyPoints 可以为空；actions 只有原文明说要做某事时才填写，不能为了显得有用而补行动项。",
            "",
            `录音 ID: ${input.recordingId}`,
            `时间: ${input.createdAt}`,
            "原始转写：",
            input.rawText
          ].join("\n")
        }
      ]
    });

    const content = response.choices[0]?.message.content ?? "{}";
    return organizeResultSchema.parse(parseJsonObject(content));
  }

  async linkCards(input: LinkCardsInput): Promise<LinkResult> {
    if (!input.newCards.length || !input.candidateCards.length) return { relations: [] };
    const response = await this.client.chat.completions.create({
      model: config.deepseek.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你负责判断新卡片和旧卡片之间的关系。",
            "只在确实相关时建立关系；不确定时 relationType 用 uncertain，confidence 低于 0.55。",
            "输出 JSON，不输出 Markdown。"
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "关系类型只能是 continuation, duplicate, refinement, contradiction, task_followup, knowledge_link, project_link, uncertain。",
            "请输出：",
            `{"relations":[{"fromTitle":"新卡片标题","toCardId":"旧卡片 id","relationType":"project_link","confidence":0.8,"rationale":"理由"}]}`,
            "",
            "新卡片：",
            input.newCards.map(cardDigest).join("\n\n"),
            "",
            "候选旧卡片：",
            input.candidateCards.map(cardDigest).join("\n\n")
          ].join("\n")
        }
      ]
    });
    const content = response.choices[0]?.message.content ?? "{}";
    return linkResultSchema.parse(parseJsonObject(content));
  }

  async checkQuality(input: { rawText: string; cards: ThoughtCard[] }): Promise<QualityResult> {
    const response = await this.client.chat.completions.create({
      model: config.deepseek.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是整理结果质检员。检查遗漏、乱合并、无依据行动项、过度概括。只输出 JSON。"
        },
        {
          role: "user",
          content: [
            `输出结构：{"issues":[{"severity":"low|medium|high","message":"问题","cardTitle":"可选"}]}`,
            "原始转写：",
            input.rawText,
            "",
            "卡片：",
            input.cards.map(cardDigest).join("\n\n")
          ].join("\n")
        }
      ]
    });
    const content = response.choices[0]?.message.content ?? "{}";
    return qualityResultSchema.parse(parseJsonObject(content));
  }

  async writeSummary(input: SummaryInput): Promise<string> {
    const label = input.period === "day" ? "日总结" : input.period === "week" ? "周总结" : "月总结";
    const response = await this.client.chat.completions.create({
      model: config.deepseek.model,
      messages: [
        {
          role: "system",
          content: "你是个人语音记录整理助手。总结要信息密度高，但不要把所有内容都知识化或任务化。"
        },
        {
          role: "user",
          content: [
            `请生成 ${input.periodKey} 的${label}，使用 Markdown。`,
            "结构固定为：概览、灵感记录、项目脉络、知识点、行动项、待确认问题。",
            "raw_idea 类型要作为“灵感记录”保留，不要强行改写成知识点或行动项。",
            "不要编造卡片中没有的信息。",
            "",
            "卡片：",
            input.cards.map(cardDigest).join("\n\n"),
            "",
            "关系：",
            input.relations.map((relation) => JSON.stringify(relation)).join("\n")
          ].join("\n")
        }
      ]
    });
    return response.choices[0]?.message.content?.trim() || `# ${input.periodKey} ${label}\n\n暂无总结。`;
  }

  async writeListeningScript(input: SummaryInput & { summaryMarkdown: string }): Promise<string> {
    const label = input.period === "day" ? "今天" : input.period === "week" ? "本周" : "本月";
    const response = await this.client.chat.completions.create({
      model: config.deepseek.model,
      messages: [
        {
          role: "system",
          content: "你把文字总结改写成适合收听的复习稿。语言自然、短句、不要 Markdown 标记。"
        },
        {
          role: "user",
          content: [
            `请把下面的总结改写成 ${label} 的语音复习稿。`,
            "要求：先给整体概览，再讲重点，再提醒行动项；适合 3 到 8 分钟收听。",
            "不要新增事实，不要读出 Markdown 符号。",
            "",
            input.summaryMarkdown
          ].join("\n")
        }
      ]
    });
    return response.choices[0]?.message.content?.trim() || "暂无可复习内容。";
  }
}
