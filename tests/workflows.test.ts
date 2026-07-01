import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("organizing workflow", () => {
  it("keeps loose ideas as recordable raw idea cards", async () => {
    const { MockLLMProvider } = await import("../server/providers/mockLlm");
    const llm = new MockLLMProvider();

    const result = await llm.organizeTranscript({
      recordingId: "idea-1",
      rawText: "我突然想到一个 idea，番茄工作法可以和散步记录结合，先记录一下。",
      createdAt: new Date().toISOString(),
      version: 1
    });

    expect(result.items[0]?.type).toBe("raw_idea");
    expect(result.items[0]?.actions).toEqual([]);
  });

  it("organizes incrementally, links related cards, and generates summaries", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [{ openDb, createAudioAsset, createRecording, upsertTranscript, countAll }, { MockLLMProvider }, workflows, { dayKey }] =
      await Promise.all([
        import("../server/db"),
        import("../server/providers/mockLlm"),
        import("../server/workflows"),
        import("../server/time")
      ]);

    const handle = openDb();
    const llm = new MockLLMProvider();
    const tts = { synthesize: async () => null };

    const asset1 = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "r1",
      path: "raw_audio/r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "r1",
      audioPath: "raw_audio/r1.webm",
      audioAssetId: asset1.id,
      duration: 12,
      mimeType: "audio/webm"
    });
    upsertTranscript(handle, {
      recordingId: "r1",
      rawText: "我想做一个语音整理软件，主要功能是录音之后自动拆分想法并生成总结。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/r1.txt"
    });

    const first = await workflows.organizeNew(handle, llm);
    expect(first.processed).toBe(1);
    expect(first.cardsCreated).toBeGreaterThan(0);
    const afterFirst = countAll(handle);

    const repeat = await workflows.organizeNew(handle, llm);
    expect(repeat.processed).toBe(0);
    expect(countAll(handle).cards).toBe(afterFirst.cards);

    const asset2 = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "r2",
      path: "raw_audio/r2.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "r2",
      audioPath: "raw_audio/r2.webm",
      audioAssetId: asset2.id,
      duration: 10,
      mimeType: "audio/webm"
    });
    upsertTranscript(handle, {
      recordingId: "r2",
      rawText: "这个软件后续要做手机端，还要用 AI 整理和播放复习音频。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/r2.txt"
    });

    const second = await workflows.organizeNew(handle, llm);
    expect(second.processed).toBe(1);
    expect(second.relationsCreated).toBeGreaterThan(0);

    const summary = await workflows.regenerateSummary(handle, llm, tts, "day", dayKey(new Date()));
    expect(summary.period).toBe("day");
    expect(summary.audioAssetId).toBeNull();
    expect(summary.version).toBe(1);

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("keeps existing summary blocks stable when a separate recording is added", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [{ openDb, createAudioAsset, createRecording, upsertTranscript, getLatestSummary }, { MockLLMProvider }, workflows, { dayKey }] =
      await Promise.all([
        import("../server/db"),
        import("../server/providers/mockLlm"),
        import("../server/workflows"),
        import("../server/time")
      ]);

    const handle = openDb();
    const llm = new MockLLMProvider();
    const tts = { synthesize: async () => null };
    const today = dayKey(new Date());

    const asset1 = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "r1",
      path: "raw_audio/r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "r1",
      audioPath: "raw_audio/r1.webm",
      audioAssetId: asset1.id,
      duration: 12,
      mimeType: "audio/webm"
    });
    upsertTranscript(handle, {
      recordingId: "r1",
      rawText: "需要明天整理采购清单，这是一个明确行动项。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/r1.txt"
    });

    await workflows.organizeNew(handle, llm);
    await workflows.regenerateStableSummary(handle, tts, "day", today);
    const firstSummary = getLatestSummary(handle, "day", today);
    const firstMarkdown = await fs.readFile(path.join(dataDir, firstSummary!.markdownPath), "utf8");
    expect(firstMarkdown).toContain("需要明天整理采购清单");

    const asset2 = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "r2",
      path: "raw_audio/r2.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "r2",
      audioPath: "raw_audio/r2.webm",
      audioAssetId: asset2.id,
      duration: 10,
      mimeType: "audio/webm"
    });
    upsertTranscript(handle, {
      recordingId: "r2",
      rawText: "我突然想到一个 idea，周末可以记录一次咖啡口味，先记录一下。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/r2.txt"
    });

    await workflows.organizeNew(handle, llm);
    await workflows.regenerateStableSummary(handle, tts, "day", today);
    const latestSummary = getLatestSummary(handle, "day", today);
    const latestMarkdown = await fs.readFile(path.join(dataDir, latestSummary!.markdownPath), "utf8");
    expect(latestMarkdown).toContain("需要明天整理采购清单");
    expect(latestMarkdown).toContain("周末可以记录一次咖啡口味");
    expect(latestMarkdown).toContain("未重新调用 AI 改写未变化内容");

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("deletes a recording and rebuilds affected summaries from remaining cards", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [{ openDb, createAudioAsset, createRecording, upsertTranscript, countAll, getLatestSummary }, { MockLLMProvider }, workflows, { dayKey }] =
      await Promise.all([
        import("../server/db"),
        import("../server/providers/mockLlm"),
        import("../server/workflows"),
        import("../server/time")
      ]);

    const handle = openDb();
    const llm = new MockLLMProvider();
    const tts = { synthesize: async () => null };
    await fs.writeFile(path.join(dataDir, "raw_audio", "r1.webm"), "r1");
    await fs.writeFile(path.join(dataDir, "raw_audio", "r2.webm"), "r2");

    const asset1 = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "r1",
      path: "raw_audio/r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "r1",
      audioPath: "raw_audio/r1.webm",
      audioAssetId: asset1.id,
      duration: 12,
      mimeType: "audio/webm"
    });
    upsertTranscript(handle, {
      recordingId: "r1",
      rawText: "我想做一个语音整理软件，主要功能是录音之后自动拆分想法并生成总结。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/r1.txt"
    });

    await workflows.organizeNew(handle, llm);

    const asset2 = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "r2",
      path: "raw_audio/r2.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "r2",
      audioPath: "raw_audio/r2.webm",
      audioAssetId: asset2.id,
      duration: 10,
      mimeType: "audio/webm"
    });
    upsertTranscript(handle, {
      recordingId: "r2",
      rawText: "这个软件后续要做手机端，还要用 AI 整理和播放复习音频。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/r2.txt"
    });

    await workflows.organizeNew(handle, llm);
    await workflows.regenerateSummary(handle, llm, tts, "day", dayKey(new Date()));

    const llmThatMustNotBeUsed = {
      name: "must-not-use",
      correctTranscript: async () => {
        throw new Error("LLM should not run during deletion repair");
      },
      organizeTranscript: async () => {
        throw new Error("LLM should not run during deletion repair");
      },
      linkCards: async () => {
        throw new Error("LLM should not run during deletion repair");
      },
      checkQuality: async () => {
        throw new Error("LLM should not run during deletion repair");
      },
      writeSummary: async () => {
        throw new Error("LLM should not run during deletion repair");
      },
      writeListeningScript: async () => {
        throw new Error("LLM should not run during deletion repair");
      }
    };

    const result = await workflows.deleteRecordingAndRefreshSummaries(handle, llmThatMustNotBeUsed, tts, "r1");
    expect(result?.deleted.cardsDeleted).toBeGreaterThan(0);
    expect(result?.summaryErrors).toEqual([]);
    expect(countAll(handle).recordings).toBe(1);

    const deletedCards = (handle.db.prepare("SELECT count(*) AS n FROM thought_cards WHERE source_recording_id = 'r1'").get() as { n: number }).n;
    const remainingCards = (handle.db.prepare("SELECT count(*) AS n FROM thought_cards WHERE source_recording_id = 'r2'").get() as { n: number }).n;
    const brokenRelations = (
      handle.db
        .prepare(
          `SELECT count(*) AS n
           FROM card_relations r
           LEFT JOIN thought_cards f ON f.id = r.from_card_id
           LEFT JOIN thought_cards t ON t.id = r.to_card_id
           WHERE f.id IS NULL OR t.id IS NULL`
        )
        .get() as { n: number }
    ).n;
    expect(deletedCards).toBe(0);
    expect(remainingCards).toBeGreaterThan(0);
    expect(brokenRelations).toBe(0);
    await expect(fs.stat(path.join(dataDir, "raw_audio", "r1.webm"))).rejects.toThrow();

    const latestDay = getLatestSummary(handle, "day", dayKey(new Date()));
    expect(latestDay).not.toBeNull();
    const markdown = await fs.readFile(path.join(dataDir, latestDay!.markdownPath), "utf8");
    expect(markdown).not.toContain("语音整理软件");
    expect(markdown).toContain("手机端");

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("deletes a failed recording without rebuilding summaries it never affected", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [
      { openDb, createAudioAsset, createRecording, upsertTranscript, updateRecordingStatus, countAll, getLatestSummary },
      { MockLLMProvider },
      workflows,
      { dayKey }
    ] = await Promise.all([
      import("../server/db"),
      import("../server/providers/mockLlm"),
      import("../server/workflows"),
      import("../server/time")
    ]);

    const handle = openDb();
    const llm = new MockLLMProvider();
    const tts = { synthesize: async () => null };
    await fs.writeFile(path.join(dataDir, "raw_audio", "r1.webm"), "r1");
    await fs.writeFile(path.join(dataDir, "raw_audio", "failed.webm"), "failed");

    const asset1 = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "r1",
      path: "raw_audio/r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "r1",
      audioPath: "raw_audio/r1.webm",
      audioAssetId: asset1.id,
      duration: 12,
      mimeType: "audio/webm"
    });
    upsertTranscript(handle, {
      recordingId: "r1",
      rawText: "这个软件后续要做手机端，还要用 AI 整理和播放复习音频。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/r1.txt"
    });
    await workflows.organizeNew(handle, llm);
    await workflows.regenerateSummary(handle, llm, tts, "day", dayKey(new Date()));

    const summaryBefore = getLatestSummary(handle, "day", dayKey(new Date()));
    const summaryCountBefore = countAll(handle).summaries;

    const failedAsset = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "failed",
      path: "raw_audio/failed.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "failed",
      audioPath: "raw_audio/failed.webm",
      audioAssetId: failedAsset.id,
      duration: 3,
      mimeType: "audio/webm"
    });
    updateRecordingStatus(handle, "failed", "failed", "bad audio");

    const result = await workflows.deleteRecordingAndRefreshSummaries(handle, llm, tts, "failed");
    expect(result?.deleted.cardsDeleted).toBe(0);
    expect(result?.deleted.summariesDeleted).toBe(0);
    expect(result?.summaries).toEqual({});
    expect(result?.summaryErrors).toEqual([]);
    expect(countAll(handle).summaries).toBe(summaryCountBefore);
    expect(getLatestSummary(handle, "day", dayKey(new Date()))?.id).toBe(summaryBefore?.id);
    await expect(fs.stat(path.join(dataDir, "raw_audio", "failed.webm"))).rejects.toThrow();

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("builds month overview for the calendar board", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const { openDb, createAudioAsset, createRecording, insertCard, insertSummary, listMonthOverview, updateRecordingStatus } = await import(
      "../server/db"
    );

    const handle = openDb();

    const asset1 = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "calendar-r1",
      path: "raw_audio/calendar-r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "calendar-r1",
      audioPath: "raw_audio/calendar-r1.webm",
      audioAssetId: asset1.id,
      duration: 12,
      mimeType: "audio/webm"
    });
    handle.db
      .prepare("UPDATE recordings SET created_at = ?, day_key = ?, week_key = ?, month_key = ?, status = ? WHERE id = ?")
      .run("2026-07-01T02:00:00.000Z", "2026-07-01", "2026-W27", "2026-07", "organized", "calendar-r1");
    insertCard(handle, {
      type: "raw_idea",
      title: "月历看板",
      summary: "点击日期后查看当天内容",
      keyPoints: ["点击日期后查看当天内容"],
      actions: [],
      tags: ["日期看板"],
      sourceRecordingId: "calendar-r1",
      sourceTextRange: "segment-1",
      confidence: 0.9,
      version: 1,
      rawJson: {}
    });
    insertSummary(handle, {
      id: "summary-calendar-1",
      period: "day",
      periodKey: "2026-07-01",
      markdownPath: "summaries/day/2026-07-01-v2.md",
      listeningScript: "7月1日总结",
      audioAssetId: null,
      version: 2
    });

    const asset2 = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "calendar-r2",
      path: "raw_audio/calendar-r2.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "calendar-r2",
      audioPath: "raw_audio/calendar-r2.webm",
      audioAssetId: asset2.id,
      duration: 8,
      mimeType: "audio/webm"
    });
    handle.db
      .prepare("UPDATE recordings SET created_at = ?, day_key = ?, week_key = ?, month_key = ? WHERE id = ?")
      .run("2026-07-02T02:00:00.000Z", "2026-07-02", "2026-W27", "2026-07", "calendar-r2");
    updateRecordingStatus(handle, "calendar-r2", "transcribed");

    expect(listMonthOverview(handle, "2026-07")).toEqual([
      {
        dayKey: "2026-07-01",
        recordings: 1,
        pending: 0,
        cards: 1,
        hasSummary: true,
        summaryVersion: 2
      },
      {
        dayKey: "2026-07-02",
        recordings: 1,
        pending: 1,
        cards: 0,
        hasSummary: false,
        summaryVersion: null
      }
    ]);

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("claims a remote transcription job once and completes it into cards", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [
      { openDb, createAudioAsset, createRecording, createTranscriptionJob, claimNextTranscriptionJob, getTranscriptionJob, countAll },
      { MockLLMProvider },
      workflows
    ] = await Promise.all([
      import("../server/db"),
      import("../server/providers/mockLlm"),
      import("../server/workflows")
    ]);

    const handle = openDb();
    const asset = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "remote-r1",
      path: "raw_audio/remote-r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "remote-r1",
      audioPath: "raw_audio/remote-r1.webm",
      audioAssetId: asset.id,
      duration: 18,
      mimeType: "audio/webm"
    });
    const queued = createTranscriptionJob(handle, "remote-r1");
    expect(queued.status).toBe("pending");

    const claimed = claimNextTranscriptionJob(handle, "mac-1");
    expect(claimed?.id).toBe(queued.id);
    expect(claimNextTranscriptionJob(handle, "mac-2")).toBeNull();

    const result = await workflows.completeRemoteTranscription(handle, new MockLLMProvider(), { synthesize: async () => null }, {
      jobId: queued.id,
      rawText: "我突然想到一个 idea，做一个手机端语音记录工具，先记录下来。",
      language: "zh"
    });

    expect(result.status).toBe("completed");
    expect(result.cardsCreated).toBeGreaterThan(0);
    expect(getTranscriptionJob(handle, queued.id)?.status).toBe("completed");
    expect(countAll(handle).cards).toBeGreaterThan(0);

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("marks suspicious remote transcription as suspect without cards", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [
      { openDb, createAudioAsset, createRecording, createTranscriptionJob, getTranscriptionJob, countAll },
      { MockLLMProvider },
      workflows
    ] = await Promise.all([
      import("../server/db"),
      import("../server/providers/mockLlm"),
      import("../server/workflows")
    ]);

    const handle = openDb();
    const asset = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "suspect-r1",
      path: "raw_audio/suspect-r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "suspect-r1",
      audioPath: "raw_audio/suspect-r1.webm",
      audioAssetId: asset.id,
      duration: 60,
      mimeType: "audio/webm"
    });
    const job = createTranscriptionJob(handle, "suspect-r1");

    const result = await workflows.completeRemoteTranscription(handle, new MockLLMProvider(), { synthesize: async () => null }, {
      jobId: job.id,
      rawText: "请不吝点赞、订阅、转发、打赏支持明镜与点点栏目。请不吝点赞、订阅、转发、打赏支持明镜与点点栏目。",
      language: "zh"
    });

    expect(result.status).toBe("suspect");
    expect(result.cardsCreated).toBe(0);
    expect(getTranscriptionJob(handle, job.id)?.status).toBe("suspect");
    expect(countAll(handle).cards).toBe(0);

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
});
