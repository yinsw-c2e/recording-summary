import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  createAudioAsset,
  createJob,
  deleteRecordingCascade,
  finishJob,
  getCardsForPeriod,
  getCardPeriodKeys,
  getJobByHash,
  getLatestSummary,
  getNextCardVersionForRecording,
  getPendingTranscripts,
  getRecording,
  getRecentCards,
  getRelationsForCards,
  getTranscriptionJob,
  getTranscriptsForPeriod,
  insertCard,
  insertRelation,
  insertSummary,
  markTranscriptionJobSuspect,
  completeTranscriptionJob,
  nextSummaryVersion,
  updateCard,
  updateRecordingStatus,
  upsertTranscript,
  type DbHandle
} from "./db";
import { absoluteDataPath, dataPaths, relativeDataPath } from "./paths";
import type { OrganizedCardInput } from "./schema";
import type { Period, SummaryArtifact, ThoughtCard } from "./types";
import type { LLMProvider } from "./providers/llm";
import { TTSProvider } from "./providers/tts";

function hash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function slug(input: string): string {
  return input
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || nanoid(8);
}

function markdownForCard(card: ThoughtCard): string {
  return [
    `# ${card.title}`,
    "",
    `类型：${card.type}`,
    `置信度：${card.confidence.toFixed(2)}`,
    `来源录音：${card.sourceRecordingId}`,
    `来源片段：${card.sourceTextRange}`,
    "",
    "## 摘要",
    card.summary,
    "",
    "## 关键点",
    ...(card.keyPoints.length ? card.keyPoints.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 行动项",
    ...(card.actions.length ? card.actions.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 标签",
    card.tags.map((tag) => `#${tag}`).join(" ")
  ].join("\n");
}

async function persistCardMarkdown(card: ThoughtCard): Promise<void> {
  const dir = path.join(dataPaths.cards, card.createdAt.slice(0, 10));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${card.id}-${slug(card.title)}.md`);
  await fs.writeFile(filePath, markdownForCard(card), "utf8");
}

async function removeStoredFiles(storedPaths: string[]): Promise<void> {
  await Promise.all(
    [...new Set(storedPaths)].map(async (storedPath) => {
      await fs.rm(absoluteDataPath(storedPath), { force: true }).catch(() => undefined);
    })
  );
}

async function removeCardMarkdownFiles(cardIds: string[]): Promise<void> {
  if (!cardIds.length) return;

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries.map(async (entry) => {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(target);
          return;
        }
        if (cardIds.some((id) => entry.name.startsWith(`${id}-`) && entry.name.endsWith(".md"))) {
          await fs.rm(target, { force: true }).catch(() => undefined);
        }
      })
    );
  }

  await walk(dataPaths.cards);
}

function periodLabel(period: Period): string {
  return period === "day" ? "日总结" : period === "week" ? "周总结" : "月总结";
}

function cardTypeLabel(type: ThoughtCard["type"]): string {
  const labels: Record<ThoughtCard["type"], string> = {
    raw_idea: "灵感记录",
    project_idea: "项目想法",
    knowledge: "知识点",
    task: "行动项",
    question: "待确认问题",
    reflection: "反思",
    daily_note: "日常记录",
    uncertain: "待确认"
  };
  return labels[type] ?? type;
}

function stableSummaryMarkdown(input: {
  period: Period;
  periodKey: string;
  cards: ThoughtCard[];
  relations: Array<{ fromTitle: string; toTitle: string; relationType: string; rationale: string }>;
}): string {
  const byType = input.cards.reduce<Record<string, ThoughtCard[]>>((acc, card) => {
    const label = cardTypeLabel(card.type);
    acc[label] = acc[label] ?? [];
    acc[label].push(card);
    return acc;
  }, {});
  const relationLines = input.relations.map(
    (relation) => `- ${relation.fromTitle} -> ${relation.toTitle}：${relation.relationType}。${relation.rationale}`
  );

  return [
    `# ${input.periodKey} ${periodLabel(input.period)}`,
    "",
    "## 概览",
    `本周期当前保留 ${input.cards.length} 条卡片，${input.relations.length} 条关系。`,
    "这份总结由已确认卡片稳定生成，未重新调用 AI 改写未变化内容。",
    "",
    ...Object.entries(byType).flatMap(([label, cards]) => [
      `## ${label}`,
      ...cards.flatMap((card) => [
        `### ${card.title}`,
        card.summary,
        ...(card.keyPoints.length ? ["", "关键点：", ...card.keyPoints.map((item) => `- ${item}`)] : []),
        ...(card.actions.length ? ["", "行动项：", ...card.actions.map((item) => `- ${item}`)] : []),
        ...(card.tags.length ? ["", `标签：${card.tags.map((tag) => `#${tag}`).join(" ")}`] : []),
        ""
      ])
    ]),
    relationLines.length ? "## 关系" : "",
    ...relationLines
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .trim();
}

function stableListeningScript(period: Period, cards: ThoughtCard[]): string {
  const label = period === "day" ? "今天" : period === "week" ? "本周" : "本月";
  const lines = cards.slice(0, 12).map((card, index) => `${index + 1}. ${card.title}。${card.summary}`);
  return [`${label}的复习开始。当前保留 ${cards.length} 条内容。`, ...lines, "复习结束。"].join("\n");
}

function isLikelyBadTranscript(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 4) return true;
  const mediaTail = /(请不吝)?点赞.{0,6}订阅.{0,6}转发.{0,6}打赏|明镜与点点栏目|感谢收看|字幕由/.test(compact);
  if (mediaTail) return true;
  const repeated = compact.length >= 24 && compact.slice(0, 12) === compact.slice(12, 24);
  return repeated && compact.length < 90;
}

function normalizeCard(input: OrganizedCardInput, recordingId: string, version: number): Omit<ThoughtCard, "id" | "createdAt" | "updatedAt"> & { rawJson: unknown } {
  return {
    type: input.type,
    title: input.title.trim(),
    summary: input.summary.trim(),
    keyPoints: input.keyPoints.map((item) => item.trim()).filter(Boolean),
    actions: input.actions.map((item) => item.trim()).filter(Boolean),
    tags: input.tags.map((item) => item.trim()).filter(Boolean).slice(0, 8),
    sourceRecordingId: recordingId,
    sourceTextRange: input.sourceTextRange || "full",
    confidence: input.confidence,
    version,
    rawJson: input
  };
}

async function createCardsForTranscript(
  handle: DbHandle,
  llm: LLMProvider,
  transcript: { recordingId: string; rawText: string; recordingCreatedAt: string },
  version: number,
  deepMode: boolean
): Promise<ThoughtCard[]> {
  const result = await llm.organizeTranscript({
    recordingId: transcript.recordingId,
    rawText: transcript.rawText,
    createdAt: transcript.recordingCreatedAt,
    version,
    deepMode
  });

  const cards: ThoughtCard[] = [];
  for (const item of result.items) {
    const card = insertCard(handle, normalizeCard(item, transcript.recordingId, version));
    await persistCardMarkdown(card);
    cards.push(card);
  }

  await llm.checkQuality({ rawText: transcript.rawText, cards });
  return cards;
}

async function organizeSingleTranscript(
  handle: DbHandle,
  llm: LLMProvider,
  transcript: { recordingId: string; rawText: string; recordingCreatedAt: string }
): Promise<{ cardsCreated: number; relationsCreated: number }> {
  updateRecordingStatus(handle, transcript.recordingId, "organizing");
  const cards = await createCardsForTranscript(handle, llm, transcript, 1, false);
  if (!cards.length) {
    updateRecordingStatus(handle, transcript.recordingId, "no_content", "AI did not extract any usable cards from this transcript.");
    return { cardsCreated: 0, relationsCreated: 0 };
  }

  const relations = await linkNewCards(handle, llm, cards);
  updateRecordingStatus(handle, transcript.recordingId, "organized");
  return { cardsCreated: cards.length, relationsCreated: relations };
}

async function linkNewCards(handle: DbHandle, llm: LLMProvider, newCards: ThoughtCard[]): Promise<number> {
  if (!newCards.length) return 0;
  const newIds = new Set(newCards.map((card) => card.id));
  const candidates = getRecentCards(handle, 160).filter((card) => !newIds.has(card.id));
  if (!candidates.length) return 0;

  const result = await llm.linkCards({ newCards, candidateCards: candidates });
  let inserted = 0;
  for (const relation of result.relations) {
    if (relation.relationType === "uncertain" || relation.confidence < 0.55) continue;
    const fromCard = newCards.find((card) => card.title === relation.fromTitle) ?? newCards[0];
    const toCard = candidates.find((card) => card.id === relation.toCardId);
    if (!fromCard || !toCard) continue;
    insertRelation(handle, {
      fromCardId: fromCard.id,
      toCardId: toCard.id,
      relationType: relation.relationType,
      confidence: relation.confidence,
      rationale: relation.rationale
    });
    inserted += 1;
  }
  return inserted;
}

export async function organizeNew(handle: DbHandle, llm: LLMProvider): Promise<{
  processed: number;
  skipped: number;
  cardsCreated: number;
  relationsCreated: number;
}> {
  const pending = getPendingTranscripts(handle);
  let processed = 0;
  let skipped = 0;
  let cardsCreated = 0;
  let relationsCreated = 0;

  for (const transcript of pending) {
    const inputHash = hash(`organize:v1:${transcript.recordingId}:${transcript.rawText}`);
    const existing = getJobByHash(handle, inputHash);
    if (existing?.status === "completed") {
      skipped += 1;
      continue;
    }
    const job = existing ?? createJob(handle, "organize-new", inputHash);
    try {
      const result = await organizeSingleTranscript(handle, llm, transcript);
      finishJob(handle, job.id, "completed");
      processed += 1;
      cardsCreated += result.cardsCreated;
      relationsCreated += result.relationsCreated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateRecordingStatus(handle, transcript.recordingId, "failed", message);
      finishJob(handle, job.id, "failed", message);
      throw error;
    }
  }

  return { processed, skipped, cardsCreated, relationsCreated };
}

export async function regenerateSummary(
  handle: DbHandle,
  llm: LLMProvider,
  tts: TTSProvider,
  period: Period,
  periodKey: string
) {
  const cards = getCardsForPeriod(handle, period, periodKey);
  const relations = getRelationsForCards(handle, cards.map((card) => card.id));
  const summaryMarkdown = await llm.writeSummary({ period, periodKey, cards, relations });
  const listeningScript = await llm.writeListeningScript({ period, periodKey, cards, relations, summaryMarkdown });
  const version = nextSummaryVersion(handle, period, periodKey);

  const summaryDir = path.join(dataPaths.summaries, period);
  await fs.mkdir(summaryDir, { recursive: true });
  const markdownPath = path.join(summaryDir, `${periodKey}-v${version}.md`);
  await fs.writeFile(markdownPath, summaryMarkdown, "utf8");

  const ttsResult = await tts.synthesize(listeningScript, `${period}-${periodKey}-v${version}`);
  const summaryId = nanoid();
  const audioAsset = ttsResult
    ? createAudioAsset(handle, {
        kind: "summary",
        ownerId: summaryId,
        path: ttsResult.path,
        mimeType: ttsResult.mimeType
      })
    : null;

  return insertSummary(handle, {
    id: summaryId,
    period,
    periodKey,
    markdownPath: relativeDataPath(markdownPath),
    listeningScript,
    audioAssetId: audioAsset?.id ?? null,
    version
  });
}

export async function completeRemoteTranscription(
  handle: DbHandle,
  llm: LLMProvider,
  tts: TTSProvider,
  input: { jobId: string; rawText: string; language?: string }
): Promise<{
  recordingId: string;
  status: "completed" | "suspect" | "no_content";
  cardsCreated: number;
  relationsCreated: number;
  summary: SummaryArtifact | null;
}> {
  const job = getTranscriptionJob(handle, input.jobId);
  if (!job) throw new Error("transcription job not found");
  const recording = getRecording(handle, job.recordingId);
  if (!recording) throw new Error("recording not found for transcription job");

  const correctedText = (await llm.correctTranscript({ rawText: input.rawText })).trim();
  const transcriptPath = path.join(dataPaths.rawTranscript, `${job.recordingId}.txt`);
  await fs.writeFile(transcriptPath, correctedText, "utf8");

  if (isLikelyBadTranscript(correctedText)) {
    upsertTranscript(handle, {
      recordingId: job.recordingId,
      rawText: correctedText,
      language: input.language ?? "zh",
      sourceTimeRanges: "full",
      status: "failed",
      path: relativeDataPath(transcriptPath)
    });
    markTranscriptionJobSuspect(handle, input.jobId, "Transcript looked like ASR hallucination or empty speech.");
    return { recordingId: job.recordingId, status: "suspect", cardsCreated: 0, relationsCreated: 0, summary: null };
  }

  upsertTranscript(handle, {
    recordingId: job.recordingId,
    rawText: correctedText,
    language: input.language ?? "zh",
    sourceTimeRanges: "full",
    status: "completed",
    path: relativeDataPath(transcriptPath)
  });
  updateRecordingStatus(handle, job.recordingId, "transcribed");

  const result = await organizeSingleTranscript(handle, llm, {
    recordingId: job.recordingId,
    rawText: correctedText,
    recordingCreatedAt: recording.createdAt
  });
  const summary = result.cardsCreated ? await regenerateStableSummary(handle, tts, "day", recording.createdAt.slice(0, 10)) : null;
  completeTranscriptionJob(handle, input.jobId);
  return {
    recordingId: job.recordingId,
    status: result.cardsCreated ? "completed" : "no_content",
    cardsCreated: result.cardsCreated,
    relationsCreated: result.relationsCreated,
    summary
  };
}

export async function saveManualTranscriptAndOrganize(
  handle: DbHandle,
  llm: LLMProvider,
  tts: TTSProvider,
  input: { recordingId: string; rawText: string; language?: string }
): Promise<{
  recordingId: string;
  status: "completed" | "no_content";
  cardsCreated: number;
  relationsCreated: number;
  summary: SummaryArtifact | null;
}> {
  const recording = getRecording(handle, input.recordingId);
  if (!recording) throw new Error("recording not found");

  const cardCount = (handle.db
    .prepare("SELECT count(*) AS n FROM thought_cards WHERE source_recording_id = ?")
    .get(input.recordingId) as { n: number }).n;
  if (cardCount > 0) throw new Error("recording already has cards; use deep reorganize if you need to rebuild it");

  const text = input.rawText.trim();
  if (!text) throw new Error("text is required");

  const row = handle.db.prepare("SELECT day_key FROM recordings WHERE id = ?").get(input.recordingId) as { day_key: string } | undefined;
  const periodDayKey = row?.day_key || recording.createdAt.slice(0, 10);
  const transcriptPath = path.join(dataPaths.rawTranscript, `${input.recordingId}.txt`);
  await fs.writeFile(transcriptPath, text, "utf8");
  upsertTranscript(handle, {
    recordingId: input.recordingId,
    rawText: text,
    language: input.language ?? "zh",
    sourceTimeRanges: "full",
    status: "completed",
    path: relativeDataPath(transcriptPath)
  });
  updateRecordingStatus(handle, input.recordingId, "transcribed");

  const stamp = new Date().toISOString();
  handle.db
    .prepare(
      `UPDATE transcription_jobs
       SET status = 'completed', locked_by = NULL, locked_at = NULL, error = NULL, updated_at = ?, finished_at = ?
       WHERE recording_id = ?`
    )
    .run(stamp, stamp, input.recordingId);

  const result = await organizeSingleTranscript(handle, llm, {
    recordingId: input.recordingId,
    rawText: text,
    recordingCreatedAt: recording.createdAt
  });
  const summary = result.cardsCreated ? await regenerateStableSummary(handle, tts, "day", periodDayKey) : null;

  return {
    recordingId: input.recordingId,
    status: result.cardsCreated ? "completed" : "no_content",
    cardsCreated: result.cardsCreated,
    relationsCreated: result.relationsCreated,
    summary
  };
}

export async function updateThoughtCardAndRefreshSummaries(
  handle: DbHandle,
  tts: TTSProvider,
  input: {
    cardId: string;
    type: ThoughtCard["type"];
    title: string;
    summary: string;
    keyPoints: string[];
    actions: string[];
    tags: string[];
  }
): Promise<{ card: ThoughtCard; summaries: Partial<Record<Period, SummaryArtifact>> }> {
  const card = updateCard(handle, input.cardId, {
    type: input.type,
    title: input.title,
    summary: input.summary,
    keyPoints: input.keyPoints,
    actions: input.actions,
    tags: input.tags
  });
  if (!card) throw new Error("card not found");

  await removeCardMarkdownFiles([card.id]);
  await persistCardMarkdown(card);

  const keys = getCardPeriodKeys(handle, card.id);
  const summaries: Partial<Record<Period, SummaryArtifact>> = {};
  if (keys) {
    for (const period of ["day", "week", "month"] as Period[]) {
      summaries[period] = await regenerateStableSummary(handle, tts, period, keys[period]);
    }
  }

  return { card, summaries };
}

export async function regenerateStableSummary(handle: DbHandle, tts: TTSProvider, period: Period, periodKey: string): Promise<SummaryArtifact> {
  const cards = getCardsForPeriod(handle, period, periodKey);
  const relations = getRelationsForCards(handle, cards.map((card) => card.id));
  const summaryMarkdown = stableSummaryMarkdown({ period, periodKey, cards, relations });
  const listeningScript = stableListeningScript(period, cards);
  const version = nextSummaryVersion(handle, period, periodKey);

  const summaryDir = path.join(dataPaths.summaries, period);
  await fs.mkdir(summaryDir, { recursive: true });
  const markdownPath = path.join(summaryDir, `${periodKey}-v${version}.md`);
  await fs.writeFile(markdownPath, summaryMarkdown || `# ${periodKey} ${periodLabel(period)}\n\n暂无内容。`, "utf8");

  const ttsResult = await tts.synthesize(listeningScript, `${period}-${periodKey}-v${version}`);
  const summaryId = nanoid();
  const audioAsset = ttsResult
    ? createAudioAsset(handle, {
        kind: "summary",
        ownerId: summaryId,
        path: ttsResult.path,
        mimeType: ttsResult.mimeType
      })
    : null;

  return insertSummary(handle, {
    id: summaryId,
    period,
    periodKey,
    markdownPath: relativeDataPath(markdownPath),
    listeningScript,
    audioAssetId: audioAsset?.id ?? null,
    version
  });
}

export async function deepReorganize(
  handle: DbHandle,
  llm: LLMProvider,
  tts: TTSProvider,
  period: Period,
  periodKey: string
) {
  const transcripts = getTranscriptsForPeriod(handle, period, periodKey);
  let cardsCreated = 0;
  let relationsCreated = 0;

  for (const transcript of transcripts) {
    const version = getNextCardVersionForRecording(handle, transcript.recordingId);
    const inputHash = hash(`deep-reorganize:${period}:${periodKey}:${transcript.recordingId}:v${version}:${transcript.rawText}`);
    const existing = getJobByHash(handle, inputHash);
    if (existing?.status === "completed") continue;
    const job = existing ?? createJob(handle, "deep-reorganize", inputHash);
    try {
      const cards = await createCardsForTranscript(handle, llm, transcript, version, true);
      const relations = await linkNewCards(handle, llm, cards);
      updateRecordingStatus(handle, transcript.recordingId, "organized");
      finishJob(handle, job.id, "completed");
      cardsCreated += cards.length;
      relationsCreated += relations;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishJob(handle, job.id, "failed", message);
      throw error;
    }
  }

  const summary = await regenerateSummary(handle, llm, tts, period, periodKey);
  return { cardsCreated, relationsCreated, summary };
}

export function latestSummaryOrNull(handle: DbHandle, period: Period, periodKey: string) {
  return getLatestSummary(handle, period, periodKey);
}

export async function deleteRecordingAndRefreshSummaries(
  handle: DbHandle,
  llm: LLMProvider,
  tts: TTSProvider,
  recordingId: string
): Promise<{
  deleted: {
    recordingId: string;
    cardsDeleted: number;
    relationsDeleted: number;
    summariesDeleted: number;
    filesDeleted: number;
  };
  summaries: Partial<Record<Period, SummaryArtifact>>;
  summaryErrors: Array<{ period: Period; message: string }>;
} | null> {
  const deleted = deleteRecordingCascade(handle, recordingId);
  if (!deleted) return null;

  await removeStoredFiles(deleted.filesToRemove);
  await removeCardMarkdownFiles(deleted.cardIds);

  const summaries: Partial<Record<Period, SummaryArtifact>> = {};
  const summaryErrors: Array<{ period: Period; message: string }> = [];
  for (const period of deleted.summaryPeriodsToRefresh) {
    try {
      summaries[period] = await regenerateStableSummary(handle, tts, period, deleted.periodKeys[period]);
    } catch (error) {
      summaryErrors.push({
        period,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    deleted: {
      recordingId: deleted.recordingId,
      cardsDeleted: deleted.cardsDeleted,
      relationsDeleted: deleted.relationsDeleted,
      summariesDeleted: deleted.summariesDeleted,
      filesDeleted: deleted.filesToRemove.length + deleted.cardIds.length
    },
    summaries,
    summaryErrors
  };
}
