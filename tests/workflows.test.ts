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

  it("deletes one card and refreshes affected summaries without removing the source recording", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [
      { openDb, createAudioAsset, createRecording, upsertTranscript, getCardsForPeriod, getLatestSummary, getRecording },
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
    for (const id of ["delete-card-r1", "delete-card-r2"]) {
      const asset = createAudioAsset(handle, {
        kind: "recording",
        ownerId: id,
        path: `raw_audio/${id}.webm`,
        mimeType: "audio/webm"
      });
      createRecording(handle, {
        id,
        audioPath: `raw_audio/${id}.webm`,
        audioAssetId: asset.id,
        duration: 10,
        mimeType: "audio/webm"
      });
    }
    upsertTranscript(handle, {
      recordingId: "delete-card-r1",
      rawText: "我要删除这张错误卡片，它不应该继续进入总结。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/delete-card-r1.txt"
    });
    upsertTranscript(handle, {
      recordingId: "delete-card-r2",
      rawText: "保留这张手机端项目卡片，它应该继续留在总结里。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/delete-card-r2.txt"
    });

    await workflows.organizeNew(handle, llm);
    const today = dayKey(new Date());
    await workflows.regenerateStableSummary(handle, tts, "day", today);
    const cardsBeforeDelete = getCardsForPeriod(handle, "day", today);
    const deletedCard = cardsBeforeDelete.find((card) => card.sourceRecordingId === "delete-card-r1");
    const remainingCard = cardsBeforeDelete.find((card) => card.sourceRecordingId === "delete-card-r2");
    expect(deletedCard).toBeDefined();
    expect(remainingCard).toBeDefined();

    const result = await workflows.deleteThoughtCardAndRefreshSummaries(handle, tts, deletedCard!.id);

    expect(result?.deleted.cardsDeleted).toBe(1);
    expect(result?.deleted.remainingRecordingCards).toBe(0);
    expect(result?.summaryErrors).toEqual([]);
    expect(getRecording(handle, deletedCard!.sourceRecordingId)?.status).toBe("no_content");
    const remainingCards = getCardsForPeriod(handle, "day", today);
    expect(remainingCards).toHaveLength(1);
    expect(remainingCards[0]?.id).toBe(remainingCard!.id);

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
    expect(brokenRelations).toBe(0);

    const latestDay = getLatestSummary(handle, "day", today);
    expect(latestDay).not.toBeNull();
    const markdown = await fs.readFile(path.join(dataDir, latestDay!.markdownPath), "utf8");
    expect(markdown).not.toContain(deletedCard!.title);
    expect(markdown).toContain(remainingCard!.title);

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("marks a card as starred and returns starred cards first", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [
      {
        openDb,
        createAudioAsset,
        createRecording,
        upsertTranscript,
        getCardsForPeriod,
        searchCards,
        setCardReviewed,
        setCardsReviewed,
        setCardStarred
      },
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
    for (const id of ["star-r1", "star-r2"]) {
      const asset = createAudioAsset(handle, {
        kind: "recording",
        ownerId: id,
        path: `raw_audio/${id}.webm`,
        mimeType: "audio/webm"
      });
      createRecording(handle, {
        id,
        audioPath: `raw_audio/${id}.webm`,
        audioAssetId: asset.id,
        duration: 9,
        mimeType: "audio/webm"
      });
    }
    upsertTranscript(handle, {
      recordingId: "star-r1",
      rawText: "普通记录卡片，用来验证它会排在重点卡片后面。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/star-r1.txt"
    });
    upsertTranscript(handle, {
      recordingId: "star-r2",
      rawText: "重点手机体验卡片，用来验证重点筛选和搜索结果。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/star-r2.txt"
    });

    await workflows.organizeNew(handle, llm);
    const today = dayKey(new Date());
    const cardsBeforeStar = getCardsForPeriod(handle, "day", today);
    const starredTarget = cardsBeforeStar.find((card) => card.sourceRecordingId === "star-r2");
    expect(starredTarget).toBeDefined();

    const starred = setCardStarred(handle, starredTarget!.id, true);
    expect(starred?.starred).toBe(true);

    const cardsAfterStar = getCardsForPeriod(handle, "day", today);
    expect(cardsAfterStar[0]?.id).toBe(starredTarget!.id);
    expect(cardsAfterStar[0]?.starred).toBe(true);
    expect(cardsAfterStar[1]?.starred).toBe(false);

    const searchResult = searchCards(handle, "手机体验", 10)[0];
    expect(searchResult?.id).toBe(starredTarget!.id);
    expect(searchResult?.starred).toBe(true);
    expect(searchResult?.reviewed).toBe(false);

    const reviewed = setCardReviewed(handle, starredTarget!.id, true);
    expect(reviewed?.reviewed).toBe(true);
    expect(reviewed?.starred).toBe(true);

    const unstarred = setCardStarred(handle, starredTarget!.id, false);
    expect(unstarred?.starred).toBe(false);
    expect(unstarred?.reviewed).toBe(true);

    const unreviewed = setCardReviewed(handle, starredTarget!.id, false);
    expect(unreviewed?.reviewed).toBe(false);

    const reviewedCards = setCardsReviewed(handle, cardsAfterStar.map((card) => card.id), true);
    expect(reviewedCards?.map((card) => card.reviewed)).toEqual([true, true]);
    expect(reviewedCards?.find((card) => card.id === starredTarget!.id)?.starred).toBe(false);

    const missingBatch = setCardsReviewed(handle, [cardsAfterStar[0]!.id, "missing-card"], false);
    expect(missingBatch).toBeNull();
    expect(getCardsForPeriod(handle, "day", today).map((card) => card.reviewed)).toEqual([true, true]);

    const clearedCards = setCardsReviewed(handle, cardsAfterStar.map((card) => card.id), false);
    expect(clearedCards?.map((card) => card.reviewed)).toEqual([false, false]);

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("persists completed action items in day stats and prunes invalid marks after card edits", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [
      { openDb, createAudioAsset, createRecording, insertCard, getTodayStats, setActionItemCompleted, updateCard, deleteCardCascade },
      { dayKey }
    ] = await Promise.all([import("../server/db"), import("../server/time")]);

    const handle = openDb();
    const today = dayKey(new Date());
    const asset = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "action-r1",
      path: "raw_audio/action-r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "action-r1",
      audioPath: "raw_audio/action-r1.webm",
      audioAssetId: asset.id,
      duration: 8,
      mimeType: "audio/webm"
    });
    const card = insertCard(handle, {
      type: "task",
      title: "行动项状态",
      summary: "验证行动项完成状态会保存在服务端。",
      keyPoints: [],
      actions: ["买纸巾", "整理复习稿"],
      tags: ["测试"],
      sourceRecordingId: "action-r1",
      sourceTextRange: "segment-1",
      confidence: 0.9,
      version: 1,
      rawJson: { source: "test" }
    });

    expect(getTodayStats(handle, today).completedActions).toEqual({});
    expect(setActionItemCompleted(handle, card.id, 1, true)?.completedActions).toEqual({ [`${card.id}-1`]: true });
    expect(getTodayStats(handle, today).completedActions).toEqual({ [`${card.id}-1`]: true });
    expect(setActionItemCompleted(handle, card.id, 7, true)).toBeNull();

    expect(setActionItemCompleted(handle, card.id, 1, false)?.completedActions).toEqual({});
    expect(getTodayStats(handle, today).completedActions).toEqual({});

    expect(setActionItemCompleted(handle, card.id, 1, true)?.completedActions).toEqual({ [`${card.id}-1`]: true });
    updateCard(handle, card.id, {
      type: "task",
      title: "行动项状态",
      summary: "删除第二条行动项后，旧完成状态不应继续出现。",
      keyPoints: [],
      actions: ["买纸巾"],
      tags: ["测试"]
    });
    expect(getTodayStats(handle, today).completedActions).toEqual({});

    expect(setActionItemCompleted(handle, card.id, 0, true)?.completedActions).toEqual({ [`${card.id}-0`]: true });
    deleteCardCascade(handle, card.id);
    expect(getTodayStats(handle, today).completedActions).toEqual({});

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

    const {
      openDb,
      createAudioAsset,
      createRecording,
      insertCard,
      insertSummary,
      listMonthOverview,
      setCardReviewed,
      updateRecordingStatus
    } = await import("../server/db");

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
    const reviewedCard = insertCard(handle, {
      type: "knowledge",
      title: "已复习知识",
      summary: "这张卡片已经复习，不应该进入待复习数量",
      keyPoints: [],
      actions: [],
      tags: ["日期看板"],
      sourceRecordingId: "calendar-r1",
      sourceTextRange: "segment-2",
      confidence: 0.88,
      version: 1,
      rawJson: {}
    });
    setCardReviewed(handle, reviewedCard.id, true);
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
        cards: 2,
        reviewDue: 1,
        hasSummary: true,
        summaryVersion: 2
      },
      {
        dayKey: "2026-07-02",
        recordings: 1,
        pending: 1,
        cards: 0,
        reviewDue: 0,
        hasSummary: false,
        summaryVersion: null
      }
    ]);

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("searches historical cards and returns their day keys", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const { openDb, createAudioAsset, createRecording, insertCard, searchCards } = await import("../server/db");

    const handle = openDb();

    const asset1 = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "search-r1",
      path: "raw_audio/search-r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "search-r1",
      audioPath: "raw_audio/search-r1.webm",
      audioAssetId: asset1.id,
      duration: 12,
      mimeType: "audio/webm"
    });
    handle.db
      .prepare("UPDATE recordings SET created_at = ?, day_key = ?, week_key = ?, month_key = ?, status = ? WHERE id = ?")
      .run("2026-07-03T02:00:00.000Z", "2026-07-03", "2026-W27", "2026-07", "organized", "search-r1");
    insertCard(handle, {
      type: "knowledge",
      title: "咖啡萃取参数",
      summary: "记录手冲咖啡水温和研磨度的复盘方法",
      keyPoints: ["水温", "研磨度"],
      actions: [],
      tags: ["咖啡复盘"],
      sourceRecordingId: "search-r1",
      sourceTextRange: "segment-1",
      confidence: 0.9,
      version: 1,
      rawJson: {}
    });

    const asset2 = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "search-r2",
      path: "raw_audio/search-r2.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "search-r2",
      audioPath: "raw_audio/search-r2.webm",
      audioAssetId: asset2.id,
      duration: 8,
      mimeType: "audio/webm"
    });
    handle.db
      .prepare("UPDATE recordings SET created_at = ?, day_key = ?, week_key = ?, month_key = ?, status = ? WHERE id = ?")
      .run("2026-07-04T02:00:00.000Z", "2026-07-04", "2026-W27", "2026-07", "organized", "search-r2");
    insertCard(handle, {
      type: "task",
      title: "采购清单",
      summary: "整理明天要买的水果和纸巾",
      keyPoints: ["水果", "纸巾"],
      actions: ["买水果"],
      tags: ["生活"],
      sourceRecordingId: "search-r2",
      sourceTextRange: "segment-1",
      confidence: 0.9,
      version: 1,
      rawJson: {}
    });

    const results = searchCards(handle, "咖啡");
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("咖啡萃取参数");
    expect(results[0]?.dayKey).toBe("2026-07-03");
    expect(results[0]?.recordingCreatedAt).toBe("2026-07-03T02:00:00.000Z");

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("exposes transcript availability and raw text for a recording", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const { openDb, createAudioAsset, createRecording, getTranscriptForRecording, listRecordingsForDay, upsertTranscript } = await import("../server/db");

    const handle = openDb();
    const asset = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "transcript-r1",
      path: "raw_audio/transcript-r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "transcript-r1",
      audioPath: "raw_audio/transcript-r1.webm",
      audioAssetId: asset.id,
      duration: 21,
      mimeType: "audio/webm"
    });
    handle.db
      .prepare("UPDATE recordings SET created_at = ?, day_key = ?, week_key = ?, month_key = ? WHERE id = ?")
      .run("2026-07-06T02:00:00.000Z", "2026-07-06", "2026-W27", "2026-07", "transcript-r1");
    upsertTranscript(handle, {
      recordingId: "transcript-r1",
      rawText: "这是一段可以回看的原始转写文本。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/transcript-r1.txt"
    });

    const recordings = listRecordingsForDay(handle, "2026-07-06");
    expect(recordings[0]?.hasTranscript).toBe(true);
    expect(recordings[0]?.transcriptStatus).toBe("completed");
    expect(getTranscriptForRecording(handle, "transcript-r1")?.rawText).toBe("这是一段可以回看的原始转写文本。");
    expect(getTranscriptForRecording(handle, "missing")).toBeNull();

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

  it("requeues a failed remote transcription without keeping stale transcript pending", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const {
      openDb,
      createAudioAsset,
      createRecording,
      createTranscriptionJob,
      claimNextTranscriptionJob,
      failTranscriptionJob,
      getTranscriptionJob,
      getRecording,
      requeueTranscriptionJob,
      upsertTranscript
    } = await import("../server/db");

    const handle = openDb();
    const asset = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "retry-r1",
      path: "raw_audio/retry-r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "retry-r1",
      audioPath: "raw_audio/retry-r1.webm",
      audioAssetId: asset.id,
      duration: 11,
      mimeType: "audio/webm"
    });
    upsertTranscript(handle, {
      recordingId: "retry-r1",
      rawText: "旧的错误转写",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/retry-r1.txt"
    });
    const job = createTranscriptionJob(handle, "retry-r1");
    claimNextTranscriptionJob(handle, "mac-1");
    failTranscriptionJob(handle, job.id, "whisper failed", 1);

    expect(getTranscriptionJob(handle, job.id)?.status).toBe("failed");
    expect(getRecording(handle, "retry-r1")?.status).toBe("failed");

    const result = requeueTranscriptionJob(handle, "retry-r1");
    expect(result).not.toBeNull();
    expect(result).not.toBe("has_cards");
    if (result && result !== "has_cards") {
      expect(result.job.id).toBe(job.id);
      expect(result.job.status).toBe("pending");
      expect(result.job.attempts).toBe(0);
      expect(result.recording.status).toBe("transcription_queued");
    }
    expect(getRecording(handle, "retry-r1")?.error).toBeNull();
    const transcriptStatus = (handle.db
      .prepare("SELECT status FROM transcripts WHERE recording_id = ?")
      .get("retry-r1") as { status: string }).status;
    expect(transcriptStatus).toBe("failed");

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("does not requeue recordings that already produced cards", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const { openDb, createAudioAsset, createRecording, requeueTranscriptionJob, upsertTranscript, countAll } = await import("../server/db");
    const { MockLLMProvider } = await import("../server/providers/mockLlm");
    const workflows = await import("../server/workflows");

    const handle = openDb();
    const asset = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "retry-card-r1",
      path: "raw_audio/retry-card-r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "retry-card-r1",
      audioPath: "raw_audio/retry-card-r1.webm",
      audioAssetId: asset.id,
      duration: 19,
      mimeType: "audio/webm"
    });
    upsertTranscript(handle, {
      recordingId: "retry-card-r1",
      rawText: "我想做一个行动项筛选功能，默认只显示未完成事项。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/retry-card-r1.txt"
    });
    await workflows.organizeNew(handle, new MockLLMProvider());

    expect(countAll(handle).cards).toBeGreaterThan(0);
    expect(requeueTranscriptionJob(handle, "retry-card-r1")).toBe("has_cards");

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("updates an edited card and refreshes affected summaries", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [{ openDb, createAudioAsset, createRecording, getCardsForPeriod, getLatestSummary, upsertTranscript }, { MockLLMProvider }, workflows, { dayKey, weekKey, monthKey }] =
      await Promise.all([
        import("../server/db"),
        import("../server/providers/mockLlm"),
        import("../server/workflows"),
        import("../server/time")
      ]);

    const handle = openDb();
    const asset = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "edit-card-r1",
      path: "raw_audio/edit-card-r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "edit-card-r1",
      audioPath: "raw_audio/edit-card-r1.webm",
      audioAssetId: asset.id,
      duration: 12,
      mimeType: "audio/webm"
    });
    upsertTranscript(handle, {
      recordingId: "edit-card-r1",
      rawText: "我需要把卡片编辑功能做出来，保存后刷新总结。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/edit-card-r1.txt"
    });

    await workflows.organizeNew(handle, new MockLLMProvider());
    const today = dayKey(new Date());
    const card = getCardsForPeriod(handle, "day", today)[0];
    expect(card).toBeDefined();

    const result = await workflows.updateThoughtCardAndRefreshSummaries(handle, { synthesize: async () => null }, {
      cardId: card.id,
      type: "task",
      title: "人工修正后的卡片标题",
      summary: "这张卡片已经由用户确认并改成更准确的摘要。",
      keyPoints: ["用户可以改卡片", "保存后刷新总结"],
      actions: ["上线卡片编辑能力"],
      tags: ["卡片编辑", "人工确认"]
    });

    expect(result.card.title).toBe("人工修正后的卡片标题");
    expect(result.card.confidence).toBe(1);
    expect(getCardsForPeriod(handle, "day", today)[0]?.summary).toContain("更准确的摘要");
    expect(getLatestSummary(handle, "day", today)?.listeningScript).toContain("人工修正后的卡片标题");
    expect(getLatestSummary(handle, "week", weekKey(new Date()))?.listeningScript).toContain("人工修正后的卡片标题");
    expect(getLatestSummary(handle, "month", monthKey(new Date()))?.listeningScript).toContain("人工修正后的卡片标题");

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("saves a manual transcript for one recording and organizes it", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [{ openDb, createAudioAsset, createRecording, countAll, getLatestSummary, getRecording, getTranscriptForRecording }, { MockLLMProvider }, workflows, { dayKey }] =
      await Promise.all([
        import("../server/db"),
        import("../server/providers/mockLlm"),
        import("../server/workflows"),
        import("../server/time")
      ]);

    const handle = openDb();
    const asset = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "manual-transcript-r1",
      path: "raw_audio/manual-transcript-r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "manual-transcript-r1",
      audioPath: "raw_audio/manual-transcript-r1.webm",
      audioAssetId: asset.id,
      duration: 15,
      mimeType: "audio/webm"
    });

    const llm = new MockLLMProvider();
    const tts = { synthesize: async () => null };
    const result = await workflows.saveManualTranscriptAndOrganize(handle, llm, tts, {
      recordingId: "manual-transcript-r1",
      rawText: "我需要修正这条录音的转写，然后实现手机 H5 的单条录音整理入口。"
    });

    expect(result.status).toBe("completed");
    expect(result.cardsCreated).toBeGreaterThan(0);
    expect(countAll(handle).cards).toBe(result.cardsCreated);
    expect(getRecording(handle, "manual-transcript-r1")?.status).toBe("organized");
    expect(getTranscriptForRecording(handle, "manual-transcript-r1")?.rawText).toContain("单条录音整理入口");
    expect(getLatestSummary(handle, "day", dayKey(new Date()))?.listeningScript).toContain("当前保留 1 条内容");

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("rejects manual transcript edits after a recording has produced cards", async () => {
    const dataDir = path.resolve("data/test");
    await fs.rm(dataDir, { recursive: true, force: true });

    const [{ openDb, createAudioAsset, createRecording, upsertTranscript, countAll }, { MockLLMProvider }, workflows] = await Promise.all([
      import("../server/db"),
      import("../server/providers/mockLlm"),
      import("../server/workflows")
    ]);

    const handle = openDb();
    const asset = createAudioAsset(handle, {
      kind: "recording",
      ownerId: "manual-transcript-card-r1",
      path: "raw_audio/manual-transcript-card-r1.webm",
      mimeType: "audio/webm"
    });
    createRecording(handle, {
      id: "manual-transcript-card-r1",
      audioPath: "raw_audio/manual-transcript-card-r1.webm",
      audioAssetId: asset.id,
      duration: 18,
      mimeType: "audio/webm"
    });
    upsertTranscript(handle, {
      recordingId: "manual-transcript-card-r1",
      rawText: "我想实现一个已经整理后的录音保护机制。",
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: "raw_transcript/manual-transcript-card-r1.txt"
    });

    await workflows.organizeNew(handle, new MockLLMProvider());
    expect(countAll(handle).cards).toBeGreaterThan(0);

    await expect(
      workflows.saveManualTranscriptAndOrganize(handle, new MockLLMProvider(), { synthesize: async () => null }, {
        recordingId: "manual-transcript-card-r1",
        rawText: "这条已经产生卡片，不应该再通过单条修正重复整理。"
      })
    ).rejects.toThrow("already has cards");
    expect(countAll(handle).cards).toBeGreaterThan(0);

    handle.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
});
