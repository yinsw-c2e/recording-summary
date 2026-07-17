import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { nanoid } from "nanoid";
import { config } from "./config";
import {
  claimNextTranscriptionJob,
  completeTranscriptionJob,
  countAll,
  createAudioAsset,
  createRecording,
  createTranscriptionJob,
  failTranscriptionJob,
  getAudioAsset,
  getLatestSummary,
  getRecording,
  getTranscriptionJob,
  getTodayStats,
  getWorkerSnapshot,
  listMonthOverview,
  listRecordingsForDay,
  listSummaries,
  markTranscriptionJobTranscribing,
  openDb,
  searchCards,
  upsertWorkerHeartbeat,
  upsertTranscript,
  type DbHandle
} from "./db";
import { absoluteDataPath, dataPaths, relativeDataPath, safeExt } from "./paths";
import { dayKey, monthKey, periodKey, weekKey } from "./time";
import type { Period } from "./types";
import { createLLMProvider } from "./providers";
import { STTProvider } from "./providers/stt";
import { TTSProvider } from "./providers/tts";
import {
  completeRemoteTranscription,
  deepReorganize,
  deleteRecordingAndRefreshSummaries,
  organizeNew,
  regenerateStableSummary,
  regenerateSummary
} from "./workflows";
import {
  authRequired,
  clearSessionCookie,
  createSessionCookie,
  isAuthenticated,
  requireWorkerToken,
  verifyPassword
} from "./auth";

const periods = new Set<Period>(["day", "week", "month"]);

function isPeriod(value: string): value is Period {
  return periods.has(value as Period);
}

function textMimeForFile(filePath: string): string {
  if (filePath.endsWith(".mp3")) return "audio/mpeg";
  if (filePath.endsWith(".aiff")) return "audio/aiff";
  if (filePath.endsWith(".webm")) return "audio/webm";
  if (filePath.endsWith(".aac")) return "audio/aac";
  if (filePath.endsWith(".m4a")) return "audio/mp4";
  if (filePath.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

function dateFromDayKey(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = new Date(`${key}T04:00:00.000Z`);
  return Number.isNaN(date.getTime()) || dayKey(date) !== key ? null : date;
}

function isMonthKey(key: string): boolean {
  return /^\d{4}-\d{2}$/.test(key);
}

type ByteRange = { start: number; end: number };

function parseByteRange(value: string | undefined, size: number): ByteRange | null | "invalid" {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.split(",")[0]?.trim() ?? "");
  if (!match || size < 1) return "invalid";

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return "invalid";

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid";
    return { start: Math.max(size - suffixLength, 0), end: size - 1 };
  }

  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return "invalid";
  }

  return { start, end: Math.min(end, size - 1) };
}

export function buildServer(handle: DbHandle = openDb()) {
  const app = Fastify({ logger: true });
  const llm = createLLMProvider();
  const stt = new STTProvider();
  const tts = new TTSProvider();

  app.register(cors, { origin: config.clientOrigin });
  app.register(multipart, {
    limits: {
      fileSize: 1024 * 1024 * 250
    }
  });

  if (fs.existsSync(path.resolve("dist"))) {
    app.register(staticFiles, {
      root: path.resolve("dist"),
      prefix: "/"
    });
  }

  app.addHook("preHandler", async (request, reply) => {
    const url = request.url;
    if (url.startsWith("/api/worker")) {
      requireWorkerToken(request, reply);
      return;
    }
    if (!url.startsWith("/api")) return;
    if (url.startsWith("/api/auth") || url.startsWith("/api/health")) return;
    if (!isAuthenticated(request)) {
      reply.code(401).send({ error: "authentication required" });
    }
  });

  app.get("/api/auth/status", async (request) => ({
    authRequired: authRequired(),
    authenticated: isAuthenticated(request)
  }));

  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { password?: string };
    if (!verifyPassword(body.password ?? "")) return reply.code(401).send({ error: "invalid password" });
    reply.header("set-cookie", createSessionCookie());
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.header("set-cookie", clearSessionCookie());
    return { ok: true };
  });

  app.get("/api/health", async () => ({
    ok: true,
    provider: llm.name,
    sttMode: config.sttMode,
    data: countAll(handle)
  }));

  app.post("/api/recordings", async (request, reply) => {
    const parts = request.parts();
    let audioPath = "";
    let mimeType = "audio/webm";
    let manualTranscript = "";
    let duration: number | null = null;
    const recordingId = nanoid();

    for await (const part of parts) {
      if (part.type === "file") {
        const ext = safeExt(part.filename, ".webm");
        mimeType = part.mimetype || textMimeForFile(ext);
        audioPath = path.join(dataPaths.rawAudio, `${recordingId}${ext}`);
        await pipeline(part.file, fs.createWriteStream(audioPath));
      } else {
        const value = String(part.value ?? "");
        if (part.fieldname === "transcript") manualTranscript = value;
        if (part.fieldname === "duration") duration = Number.isFinite(Number(value)) ? Number(value) : null;
      }
    }

    if (!audioPath) {
      return reply.code(400).send({ error: "audio file is required" });
    }

    const audioAsset = createAudioAsset(handle, {
      kind: "recording",
      ownerId: recordingId,
      path: relativeDataPath(audioPath),
      mimeType
    });
    const recording = createRecording(handle, {
      id: recordingId,
      audioPath: relativeDataPath(audioPath),
      audioAssetId: audioAsset.id,
      duration,
      mimeType
    });

    if (config.sttMode === "remote-worker" && !manualTranscript.trim()) {
      createTranscriptionJob(handle, recordingId);
      handle.db.prepare("UPDATE recordings SET status = 'transcription_queued' WHERE id = ?").run(recordingId);
      return { recording: { ...recording, status: "transcription_queued" }, audioAsset };
    }

    const transcription = await stt.transcribe(audioPath, manualTranscript);
    if (transcription) {
      const correctedText = await llm.correctTranscript({ rawText: transcription.text });
      await fsp.writeFile(absoluteDataPath(transcription.path), correctedText, "utf8");
      upsertTranscript(handle, {
        recordingId,
        rawText: correctedText,
        language: transcription.language,
        sourceTimeRanges: "full",
        status: "completed",
        path: transcription.path
      });
      handle.db.prepare("UPDATE recordings SET status = 'transcribed' WHERE id = ?").run(recordingId);
    } else {
      handle.db.prepare("UPDATE recordings SET status = 'transcript_pending' WHERE id = ?").run(recordingId);
    }

    return { recording: { ...recording, status: transcription ? "transcribed" : "transcript_pending" }, audioAsset };
  });

  app.post("/api/recordings/:id/transcript", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const body = request.body as { text?: string };
    const text = body.text?.trim();
    if (!text) return reply.code(400).send({ error: "text is required" });
    const transcriptPath = path.join(dataPaths.rawTranscript, `${id}.txt`);
    await fsp.writeFile(transcriptPath, text, "utf8");
    upsertTranscript(handle, {
      recordingId: id,
      rawText: text,
      language: "zh",
      sourceTimeRanges: "full",
      status: "completed",
      path: relativeDataPath(transcriptPath)
    });
    handle.db.prepare("UPDATE recordings SET status = 'transcribed' WHERE id = ?").run(id);
    return { ok: true };
  });

  app.post("/api/worker/heartbeat", async (request) => {
    const body = request.body as { workerId?: string; status?: "online" | "offline" | "transcribing"; currentJobId?: string | null; error?: string | null };
    const workerId = body.workerId?.trim() || "mac-whisper-worker";
    upsertWorkerHeartbeat(handle, {
      id: workerId,
      status: body.status ?? "online",
      currentJobId: body.currentJobId ?? null,
      error: body.error ?? null
    });
    return { ok: true, snapshot: getWorkerSnapshot(handle) };
  });

  app.post("/api/worker/claim", async (request) => {
    const body = request.body as { workerId?: string };
    const workerId = body.workerId?.trim() || "mac-whisper-worker";
    upsertWorkerHeartbeat(handle, { id: workerId, status: "online" });
    const job = claimNextTranscriptionJob(handle, workerId);
    if (!job) return { job: null, snapshot: getWorkerSnapshot(handle) };
    const recording = getRecording(handle, job.recordingId);
    if (!recording) return { job: null, snapshot: getWorkerSnapshot(handle) };
    return {
      job,
      recording: {
        id: recording.id,
        duration: recording.duration,
        mimeType: recording.mimeType,
        createdAt: recording.createdAt,
        audioUrl: `/api/worker/jobs/${job.id}/audio`
      },
      snapshot: getWorkerSnapshot(handle)
    };
  });

  app.post("/api/worker/jobs/:id/start", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const body = request.body as { workerId?: string };
    const workerId = body.workerId?.trim() || "mac-whisper-worker";
    const job = markTranscriptionJobTranscribing(handle, id, workerId);
    if (!job) return reply.code(404).send({ error: "job not found" });
    upsertWorkerHeartbeat(handle, { id: workerId, status: "transcribing", currentJobId: id });
    return { job };
  });

  app.get("/api/worker/jobs/:id/audio", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const job = getTranscriptionJob(handle, id);
    if (!job) return reply.code(404).send({ error: "job not found" });
    const recording = getRecording(handle, job.recordingId);
    if (!recording) return reply.code(404).send({ error: "recording not found" });
    const asset = getAudioAsset(handle, recording.audioAssetId);
    if (!asset) return reply.code(404).send({ error: "audio not found" });
    const filePath = absoluteDataPath(asset.path);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "audio file missing" });
    reply.header("content-type", asset.mimeType || textMimeForFile(filePath));
    return reply.send(fs.createReadStream(filePath));
  });

  app.post("/api/worker/jobs/:id/complete", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const body = request.body as { workerId?: string; text?: string; language?: string };
    const text = body.text?.trim();
    if (!text) return reply.code(400).send({ error: "text is required" });
    const result = await completeRemoteTranscription(handle, llm, tts, { jobId: id, rawText: text, language: body.language ?? "zh" });
    if (body.workerId) upsertWorkerHeartbeat(handle, { id: body.workerId, status: "online", currentJobId: null });
    return result;
  });

  app.post("/api/worker/jobs/:id/fail", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const body = request.body as { workerId?: string; error?: string };
    const job = failTranscriptionJob(handle, id, body.error?.trim() || "worker failed");
    if (!job) return reply.code(404).send({ error: "job not found" });
    if (body.workerId) upsertWorkerHeartbeat(handle, { id: body.workerId, status: "online", currentJobId: null, error: job.error });
    return { job };
  });

  app.delete("/api/recordings/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const result = await deleteRecordingAndRefreshSummaries(handle, llm, tts, id);
    if (!result) return reply.code(404).send({ error: "recording not found" });
    return result;
  });

  app.get("/api/today", async () => {
    const now = new Date();
    const keys = {
      day: dayKey(now),
      week: weekKey(now),
      month: monthKey(now)
    };
    const stats = getTodayStats(handle, keys.day);
    const recordings = listRecordingsForDay(handle, keys.day);
    const summaries = {
      day: getLatestSummary(handle, "day", keys.day),
      week: getLatestSummary(handle, "week", keys.week),
      month: getLatestSummary(handle, "month", keys.month)
    };
    return { keys, stats, recordings, summaries, provider: llm.name, sttMode: config.sttMode, worker: getWorkerSnapshot(handle) };
  });

  app.get("/api/day", async (request, reply) => {
    const key = String((request.query as { key?: string }).key ?? dayKey(new Date()));
    const date = dateFromDayKey(key);
    if (!date) return reply.code(400).send({ error: "key must be YYYY-MM-DD" });
    const keys = {
      day: key,
      week: weekKey(date),
      month: monthKey(date)
    };
    const stats = getTodayStats(handle, keys.day);
    const recordings = listRecordingsForDay(handle, keys.day);
    const summaries = {
      day: getLatestSummary(handle, "day", keys.day),
      week: getLatestSummary(handle, "week", keys.week),
      month: getLatestSummary(handle, "month", keys.month)
    };
    return { keys, stats, recordings, summaries, provider: llm.name, sttMode: config.sttMode, worker: getWorkerSnapshot(handle) };
  });

  app.get("/api/month", async (request, reply) => {
    const month = String((request.query as { month?: string }).month ?? monthKey(new Date()));
    if (!isMonthKey(month)) return reply.code(400).send({ error: "month must be YYYY-MM" });
    return { month, days: listMonthOverview(handle, month) };
  });

  app.get("/api/search", async (request, reply) => {
    const query = String((request.query as { q?: string }).q ?? "").trim();
    const limit = Number((request.query as { limit?: string }).limit ?? 20);
    if (!query) return { query, results: [] };
    if (query.length > 80) return reply.code(400).send({ error: "q is too long" });
    return { query, results: searchCards(handle, query, Number.isFinite(limit) ? limit : 20) };
  });

  app.post("/api/process/organize-new", async () => organizeNew(handle, llm));

  app.post("/api/process/finish-latest", async () => {
    const organized = await organizeNew(handle, llm);
    const today = dayKey(new Date());
    const summary = await regenerateStableSummary(handle, tts, "day", today);
    return { organized, summary };
  });

  app.get("/api/summaries", async (request, reply) => {
    const period = String((request.query as { period?: string }).period ?? "day");
    if (!isPeriod(period)) return reply.code(400).send({ error: "period must be day, week, or month" });
    return { summaries: listSummaries(handle, period) };
  });

  app.post("/api/summaries/:period/:key/regenerate", async (request, reply) => {
    const params = request.params as { period: string; key: string };
    if (!isPeriod(params.period)) return reply.code(400).send({ error: "invalid period" });
    return { summary: await regenerateSummary(handle, llm, tts, params.period, params.key) };
  });

  app.post("/api/summaries/:period/:key/deep-reorganize", async (request, reply) => {
    const params = request.params as { period: string; key: string };
    if (!isPeriod(params.period)) return reply.code(400).send({ error: "invalid period" });
    return deepReorganize(handle, llm, tts, params.period, params.key);
  });

  app.get("/api/audio/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const asset = getAudioAsset(handle, id);
    if (!asset) return reply.code(404).send({ error: "audio not found" });
    const filePath = absoluteDataPath(asset.path);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "audio file missing" });
    const stat = fs.statSync(filePath);
    const mimeType = asset.mimeType || textMimeForFile(filePath);
    const range = parseByteRange(request.headers.range, stat.size);

    reply.header("accept-ranges", "bytes");
    reply.header("content-type", mimeType);
    reply.header("cache-control", "private, max-age=0");

    if (range === "invalid") {
      return reply.code(416).header("content-range", `bytes */${stat.size}`).send();
    }

    if (range) {
      const contentLength = range.end - range.start + 1;
      reply.code(206);
      reply.header("content-range", `bytes ${range.start}-${range.end}/${stat.size}`);
      reply.header("content-length", String(contentLength));
      return reply.send(fs.createReadStream(filePath, { start: range.start, end: range.end }));
    }

    reply.header("content-length", String(stat.size));
    return reply.send(fs.createReadStream(filePath));
  });

  app.get("/api/summary/:id/markdown", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const row = handle.db.prepare("SELECT markdown_path FROM summary_artifacts WHERE id = ?").get(id) as
      | { markdown_path: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: "summary not found" });
    const filePath = absoluteDataPath(row.markdown_path);
    reply.header("content-type", "text/markdown; charset=utf-8");
    return reply.send(await fsp.readFile(filePath, "utf8"));
  });

  app.get("/api/keys", async () => {
    const now = new Date();
    return {
      day: periodKey("day", now),
      week: periodKey("week", now),
      month: periodKey("month", now)
    };
  });

  return app;
}
