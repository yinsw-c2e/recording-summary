import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { dataPaths, ensureDataDirs } from "./paths";
import { dayKey, monthKey, weekKey } from "./time";
import type {
  AudioAsset,
  CardRelation,
  CardSearchResult,
  Period,
  ProcessingJob,
  Recording,
  RecordingListItem,
  RecordingStatus,
  SummaryArtifact,
  ThoughtCard,
  TranscriptionJob,
  TranscriptionJobStatus,
  Transcript
} from "./types";

export interface DbHandle {
  db: Database.Database;
}

export interface DeletedRecordingCascade {
  recordingId: string;
  periodKeys: Record<Period, string>;
  cardIds: string[];
  filesToRemove: string[];
  summaryPeriodsToRefresh: Period[];
  cardsDeleted: number;
  relationsDeleted: number;
  summariesDeleted: number;
  summaryAudioAssetsDeleted: number;
}

export function openDb(dbPath = dataPaths.db): DbHandle {
  ensureDataDirs();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return { db };
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audio_assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      audio_path TEXT NOT NULL,
      audio_asset_id TEXT NOT NULL,
      duration INTEGER,
      mime_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      day_key TEXT NOT NULL,
      week_key TEXT NOT NULL,
      month_key TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      recording_id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      language TEXT NOT NULL,
      source_time_ranges TEXT NOT NULL,
      status TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thought_cards (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      key_points_json TEXT NOT NULL,
      actions_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      source_recording_id TEXT NOT NULL,
      source_text_range TEXT NOT NULL,
      confidence REAL NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_relations (
      id TEXT PRIMARY KEY,
      from_card_id TEXT NOT NULL,
      to_card_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      rationale TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(from_card_id, to_card_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS summary_artifacts (
      id TEXT PRIMARY KEY,
      period TEXT NOT NULL,
      period_key TEXT NOT NULL,
      markdown_path TEXT NOT NULL,
      listening_script TEXT NOT NULL,
      audio_asset_id TEXT,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(period, period_key, version)
    );

    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      input_hash TEXT NOT NULL UNIQUE,
      error TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transcription_jobs (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      locked_by TEXT,
      locked_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS worker_nodes (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      current_job_id TEXT,
      last_heartbeat_at TEXT NOT NULL,
      error TEXT
    );
  `);

  const columns = new Set(
    (db.prepare("PRAGMA table_info(recordings)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!columns.has("day_key")) db.exec("ALTER TABLE recordings ADD COLUMN day_key TEXT NOT NULL DEFAULT ''");
  if (!columns.has("week_key")) db.exec("ALTER TABLE recordings ADD COLUMN week_key TEXT NOT NULL DEFAULT ''");
  if (!columns.has("month_key")) db.exec("ALTER TABLE recordings ADD COLUMN month_key TEXT NOT NULL DEFAULT ''");
}

function now(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(",");
}

function mapRecording(row: Record<string, unknown>): Recording {
  return {
    id: String(row.id),
    audioPath: String(row.audio_path),
    audioAssetId: String(row.audio_asset_id),
    duration: row.duration === null ? null : Number(row.duration),
    mimeType: String(row.mime_type),
    createdAt: String(row.created_at),
    status: String(row.status) as RecordingStatus,
    error: row.error === null ? null : String(row.error)
  };
}

function mapTranscriptionJob(row: Record<string, unknown>): TranscriptionJob {
  return {
    id: String(row.id),
    recordingId: String(row.recording_id),
    status: String(row.status) as TranscriptionJobStatus,
    attempts: Number(row.attempts),
    lockedBy: row.locked_by === null ? null : String(row.locked_by),
    lockedAt: row.locked_at === null ? null : String(row.locked_at),
    error: row.error === null ? null : String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at)
  };
}

function mapCard(row: Record<string, unknown>): ThoughtCard {
  return {
    id: String(row.id),
    type: String(row.type) as ThoughtCard["type"],
    title: String(row.title),
    summary: String(row.summary),
    keyPoints: parseJson<string[]>(String(row.key_points_json), []),
    actions: parseJson<string[]>(String(row.actions_json), []),
    tags: parseJson<string[]>(String(row.tags_json), []),
    sourceRecordingId: String(row.source_recording_id),
    sourceTextRange: String(row.source_text_range),
    confidence: Number(row.confidence),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapCardSearchResult(row: Record<string, unknown>): CardSearchResult {
  return {
    ...mapCard(row),
    dayKey: String(row.day_key),
    weekKey: String(row.week_key),
    monthKey: String(row.month_key),
    recordingCreatedAt: String(row.recording_created_at)
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function createAudioAsset(handle: DbHandle, input: Omit<AudioAsset, "id" | "createdAt">): AudioAsset {
  const asset: AudioAsset = { id: nanoid(), createdAt: now(), ...input };
  handle.db
    .prepare(
      `INSERT INTO audio_assets (id, kind, owner_id, path, mime_type, created_at)
       VALUES (@id, @kind, @ownerId, @path, @mimeType, @createdAt)`
    )
    .run(asset);
  return asset;
}

export function getAudioAsset(handle: DbHandle, id: string): AudioAsset | null {
  const row = handle.db.prepare("SELECT * FROM audio_assets WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    kind: String(row.kind) as AudioAsset["kind"],
    ownerId: String(row.owner_id),
    path: String(row.path),
    mimeType: String(row.mime_type),
    createdAt: String(row.created_at)
  };
}

export function createRecording(
  handle: DbHandle,
  input: Omit<Recording, "createdAt" | "status" | "error">
): Recording {
  const createdAt = now();
  const createdDate = new Date(createdAt);
  const recording: Recording = {
    ...input,
    createdAt,
    status: "uploaded",
    error: null
  };
  handle.db
    .prepare(
      `INSERT INTO recordings
       (id, audio_path, audio_asset_id, duration, mime_type, created_at, day_key, week_key, month_key, status, error)
       VALUES
       (@id, @audioPath, @audioAssetId, @duration, @mimeType, @createdAt, @dayKey, @weekKey, @monthKey, @status, @error)`
    )
    .run({
      ...recording,
      dayKey: dayKey(createdDate),
      weekKey: weekKey(createdDate),
      monthKey: monthKey(createdDate)
    });
  return recording;
}

export function getRecording(handle: DbHandle, id: string): Recording | null {
  const row = handle.db.prepare("SELECT * FROM recordings WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapRecording(row) : null;
}

export function updateRecordingStatus(handle: DbHandle, id: string, status: RecordingStatus, error: string | null = null): void {
  handle.db.prepare("UPDATE recordings SET status = ?, error = ? WHERE id = ?").run(status, error, id);
}

export function listRecordingsForDay(handle: DbHandle, day: string): RecordingListItem[] {
  const rows = handle.db
    .prepare(
      `SELECT r.id, r.duration, r.status, r.created_at, r.audio_asset_id, r.error,
              tj.status AS transcription_job_status, tj.locked_by AS worker_id,
              count(c.id) AS card_count
       FROM recordings r
       LEFT JOIN thought_cards c ON c.source_recording_id = r.id
       LEFT JOIN transcription_jobs tj ON tj.recording_id = r.id
       WHERE r.day_key = ?
       GROUP BY r.id
       ORDER BY r.created_at DESC`
    )
    .all(day) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    duration: row.duration === null ? null : Number(row.duration),
    status: String(row.status) as RecordingStatus,
    createdAt: String(row.created_at),
    audioAssetId: String(row.audio_asset_id),
    cardCount: Number(row.card_count),
    transcriptionJobStatus: row.transcription_job_status === null ? null : (String(row.transcription_job_status) as TranscriptionJobStatus),
    workerId: row.worker_id === null ? null : String(row.worker_id),
    error: row.error === null ? null : String(row.error)
  }));
}

export function createTranscriptionJob(handle: DbHandle, recordingId: string): TranscriptionJob {
  const stamp = now();
  const existing = handle.db.prepare("SELECT * FROM transcription_jobs WHERE recording_id = ?").get(recordingId) as
    | Record<string, unknown>
    | undefined;
  if (existing) return mapTranscriptionJob(existing);

  const job = {
    id: nanoid(),
    recordingId,
    status: "pending" as TranscriptionJobStatus,
    attempts: 0,
    lockedBy: null as string | null,
    lockedAt: null as string | null,
    error: null as string | null,
    createdAt: stamp,
    updatedAt: stamp,
    finishedAt: null as string | null
  };
  handle.db
    .prepare(
      `INSERT INTO transcription_jobs
       (id, recording_id, status, attempts, locked_by, locked_at, error, created_at, updated_at, finished_at)
       VALUES (@id, @recordingId, @status, @attempts, @lockedBy, @lockedAt, @error, @createdAt, @updatedAt, @finishedAt)`
    )
    .run(job);
  return job;
}

export function getTranscriptionJob(handle: DbHandle, id: string): TranscriptionJob | null {
  const row = handle.db.prepare("SELECT * FROM transcription_jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapTranscriptionJob(row) : null;
}

export function claimNextTranscriptionJob(handle: DbHandle, workerId: string): TranscriptionJob | null {
  const transaction = handle.db.transaction(() => {
    const row = handle.db
      .prepare(
        `SELECT *
         FROM transcription_jobs
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;
    if (!row) return null;
    const stamp = now();
    handle.db
      .prepare(
        `UPDATE transcription_jobs
         SET status = 'claimed', attempts = attempts + 1, locked_by = ?, locked_at = ?, updated_at = ?, error = NULL
         WHERE id = ? AND status = 'pending'`
      )
      .run(workerId, stamp, stamp, String(row.id));
    handle.db.prepare("UPDATE recordings SET status = 'transcribing', error = NULL WHERE id = ?").run(String(row.recording_id));
    return getTranscriptionJob(handle, String(row.id));
  });
  return transaction() as TranscriptionJob | null;
}

export function markTranscriptionJobTranscribing(handle: DbHandle, id: string, workerId: string): TranscriptionJob | null {
  const stamp = now();
  handle.db
    .prepare(
      `UPDATE transcription_jobs
       SET status = 'transcribing', locked_by = ?, locked_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('claimed', 'transcribing')`
    )
    .run(workerId, stamp, stamp, id);
  const job = getTranscriptionJob(handle, id);
  if (job) updateRecordingStatus(handle, job.recordingId, "transcribing");
  return job;
}

export function completeTranscriptionJob(handle: DbHandle, id: string): TranscriptionJob | null {
  const stamp = now();
  handle.db
    .prepare(
      `UPDATE transcription_jobs
       SET status = 'completed', updated_at = ?, finished_at = ?, error = NULL
       WHERE id = ?`
    )
    .run(stamp, stamp, id);
  return getTranscriptionJob(handle, id);
}

export function markTranscriptionJobSuspect(handle: DbHandle, id: string, message: string): TranscriptionJob | null {
  const stamp = now();
  handle.db
    .prepare(
      `UPDATE transcription_jobs
       SET status = 'suspect', updated_at = ?, finished_at = ?, error = ?
       WHERE id = ?`
    )
    .run(stamp, stamp, message, id);
  const job = getTranscriptionJob(handle, id);
  if (job) updateRecordingStatus(handle, job.recordingId, "transcript_suspect", message);
  return job;
}

export function failTranscriptionJob(handle: DbHandle, id: string, message: string, maxAttempts = 3): TranscriptionJob | null {
  const transaction = handle.db.transaction(() => {
    const job = getTranscriptionJob(handle, id);
    if (!job) return null;
    const stamp = now();
    const finalStatus: TranscriptionJobStatus = job.attempts >= maxAttempts ? "failed" : "pending";
    handle.db
      .prepare(
        `UPDATE transcription_jobs
         SET status = ?, locked_by = NULL, locked_at = NULL, error = ?, updated_at = ?, finished_at = ?
         WHERE id = ?`
      )
      .run(finalStatus, message, stamp, finalStatus === "failed" ? stamp : null, id);
    updateRecordingStatus(handle, job.recordingId, finalStatus === "failed" ? "failed" : "transcription_queued", message);
    return getTranscriptionJob(handle, id);
  });
  return transaction() as TranscriptionJob | null;
}

export function upsertWorkerHeartbeat(
  handle: DbHandle,
  input: { id: string; status: "online" | "offline" | "transcribing"; currentJobId?: string | null; error?: string | null }
): void {
  const stamp = now();
  handle.db
    .prepare(
      `INSERT INTO worker_nodes (id, status, current_job_id, last_heartbeat_at, error)
       VALUES (@id, @status, @currentJobId, @stamp, @error)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         current_job_id = excluded.current_job_id,
         last_heartbeat_at = excluded.last_heartbeat_at,
         error = excluded.error`
    )
    .run({
      id: input.id,
      status: input.status,
      currentJobId: input.currentJobId ?? null,
      stamp,
      error: input.error ?? null
    });
}

export function getWorkerSnapshot(handle: DbHandle): {
  queue: Record<TranscriptionJobStatus, number>;
  workers: Array<{ id: string; status: string; currentJobId: string | null; lastHeartbeatAt: string; error: string | null }>;
} {
  const queueRows = handle.db
    .prepare("SELECT status, count(*) AS n FROM transcription_jobs GROUP BY status")
    .all() as Array<Record<string, unknown>>;
  const queue = {
    pending: 0,
    claimed: 0,
    transcribing: 0,
    completed: 0,
    failed: 0,
    suspect: 0
  } satisfies Record<TranscriptionJobStatus, number>;
  for (const row of queueRows) {
    const status = String(row.status) as TranscriptionJobStatus;
    if (status in queue) queue[status] = Number(row.n);
  }

  const workers = handle.db
    .prepare("SELECT * FROM worker_nodes ORDER BY last_heartbeat_at DESC")
    .all() as Array<Record<string, unknown>>;
  return {
    queue,
    workers: workers.map((row) => ({
      id: String(row.id),
      status: String(row.status),
      currentJobId: row.current_job_id === null ? null : String(row.current_job_id),
      lastHeartbeatAt: String(row.last_heartbeat_at),
      error: row.error === null ? null : String(row.error)
    }))
  };
}

export function deleteRecordingCascade(handle: DbHandle, id: string): DeletedRecordingCascade | null {
  const transaction = handle.db.transaction((recordingId: string) => {
    const recording = handle.db.prepare("SELECT * FROM recordings WHERE id = ?").get(recordingId) as
      | Record<string, unknown>
      | undefined;
    if (!recording) return null;

    const periodKeys: Record<Period, string> = {
      day: String(recording.day_key),
      week: String(recording.week_key),
      month: String(recording.month_key)
    };
    const files = new Set<string>();
    const addFile = (value: unknown) => {
      if (typeof value === "string" && value.trim()) files.add(value);
    };

    addFile(recording.audio_path);

    const recordingAssetRows = handle.db
      .prepare("SELECT path FROM audio_assets WHERE id = ? OR (kind = 'recording' AND owner_id = ?)")
      .all(String(recording.audio_asset_id), recordingId) as Array<Record<string, unknown>>;
    recordingAssetRows.forEach((row) => addFile(row.path));

    const transcriptRows = handle.db
      .prepare("SELECT path FROM transcripts WHERE recording_id = ?")
      .all(recordingId) as Array<Record<string, unknown>>;
    transcriptRows.forEach((row) => addFile(row.path));

    const cardRows = handle.db
      .prepare("SELECT id FROM thought_cards WHERE source_recording_id = ?")
      .all(recordingId) as Array<{ id: string }>;
    const cardIds = cardRows.map((row) => row.id);

    const summaryRows = cardIds.length
      ? (handle.db
          .prepare(
            `SELECT s.id, s.period, s.markdown_path, s.audio_asset_id, a.path AS audio_path
             FROM summary_artifacts s
             LEFT JOIN audio_assets a ON a.id = s.audio_asset_id
             WHERE (s.period = 'day' AND s.period_key = @day)
                OR (s.period = 'week' AND s.period_key = @week)
                OR (s.period = 'month' AND s.period_key = @month)`
          )
          .all(periodKeys) as Array<Record<string, unknown>>)
      : [];
    const summaryPeriodsToRefresh = [
      ...new Set(
        summaryRows
          .map((row) => String(row.period))
          .filter((period): period is Period => period === "day" || period === "week" || period === "month")
      )
    ];
    summaryRows.forEach((row) => {
      addFile(row.markdown_path);
      addFile(row.audio_path);
    });

    let relationsDeleted = 0;
    if (cardIds.length) {
      relationsDeleted = handle.db
        .prepare(
          `DELETE FROM card_relations
           WHERE from_card_id IN (${placeholders(cardIds)})
              OR to_card_id IN (${placeholders(cardIds)})`
        )
        .run(...cardIds, ...cardIds).changes;
    }

    const cardsDeleted = handle.db.prepare("DELETE FROM thought_cards WHERE source_recording_id = ?").run(recordingId).changes;
    handle.db.prepare("DELETE FROM transcripts WHERE recording_id = ?").run(recordingId);
    handle.db.prepare("DELETE FROM recordings WHERE id = ?").run(recordingId);

    const summariesDeleted = summaryRows.length
      ? handle.db
          .prepare(
            `DELETE FROM summary_artifacts
             WHERE (period = 'day' AND period_key = @day)
                OR (period = 'week' AND period_key = @week)
                OR (period = 'month' AND period_key = @month)`
          )
          .run(periodKeys).changes
      : 0;

    const summaryAudioAssetIds = summaryRows
      .map((row) => row.audio_asset_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    let summaryAudioAssetsDeleted = 0;
    if (summaryAudioAssetIds.length) {
      summaryAudioAssetsDeleted = handle.db
        .prepare(`DELETE FROM audio_assets WHERE id IN (${placeholders(summaryAudioAssetIds)})`)
        .run(...summaryAudioAssetIds).changes;
    }
    handle.db.prepare("DELETE FROM audio_assets WHERE id = ? OR (kind = 'recording' AND owner_id = ?)").run(
      String(recording.audio_asset_id),
      recordingId
    );

    return {
      recordingId,
      periodKeys,
      cardIds,
      filesToRemove: [...files],
      summaryPeriodsToRefresh,
      cardsDeleted,
      relationsDeleted,
      summariesDeleted,
      summaryAudioAssetsDeleted
    };
  });

  return transaction(id) as DeletedRecordingCascade | null;
}

export function upsertTranscript(
  handle: DbHandle,
  input: Omit<Transcript, "createdAt" | "updatedAt">
): Transcript {
  const stamp = now();
  const transcript: Transcript = { ...input, createdAt: stamp, updatedAt: stamp };
  handle.db
    .prepare(
      `INSERT INTO transcripts
       (recording_id, raw_text, language, source_time_ranges, status, path, created_at, updated_at)
       VALUES (@recordingId, @rawText, @language, @sourceTimeRanges, @status, @path, @createdAt, @updatedAt)
       ON CONFLICT(recording_id) DO UPDATE SET
         raw_text = excluded.raw_text,
         language = excluded.language,
         source_time_ranges = excluded.source_time_ranges,
         status = excluded.status,
         path = excluded.path,
         updated_at = excluded.updated_at`
    )
    .run(transcript);
  return transcript;
}

export function getPendingTranscripts(handle: DbHandle): Array<Transcript & { recordingCreatedAt: string }> {
  const rows = handle.db
    .prepare(
      `SELECT t.*, r.created_at AS recording_created_at
       FROM transcripts t
       JOIN recordings r ON r.id = t.recording_id
       WHERE t.status = 'completed'
         AND NOT EXISTS (
           SELECT 1 FROM thought_cards c
           WHERE c.source_recording_id = t.recording_id
             AND c.version = 1
         )
       ORDER BY r.created_at ASC`
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    recordingId: String(row.recording_id),
    rawText: String(row.raw_text),
    language: String(row.language),
    sourceTimeRanges: String(row.source_time_ranges),
    status: String(row.status) as Transcript["status"],
    path: String(row.path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    recordingCreatedAt: String(row.recording_created_at)
  }));
}

export function getTranscriptsForPeriod(handle: DbHandle, period: Period, key: string): Array<Transcript & { recordingCreatedAt: string }> {
  const rows = handle.db
    .prepare(
      `SELECT t.*, r.created_at AS recording_created_at
       FROM transcripts t
       JOIN recordings r ON r.id = t.recording_id
       WHERE t.status = 'completed'
         AND ${
           period === "day"
             ? "r.day_key = @key"
             : period === "month"
               ? "r.month_key = @key"
               : "r.week_key = @key"
         }
       ORDER BY r.created_at ASC`
    )
    .all({ key }) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    recordingId: String(row.recording_id),
    rawText: String(row.raw_text),
    language: String(row.language),
    sourceTimeRanges: String(row.source_time_ranges),
    status: String(row.status) as Transcript["status"],
    path: String(row.path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    recordingCreatedAt: String(row.recording_created_at)
  }));
}

export function insertCard(handle: DbHandle, input: Omit<ThoughtCard, "id" | "createdAt" | "updatedAt"> & { rawJson: unknown }): ThoughtCard {
  const stamp = now();
  const card = {
    id: nanoid(),
    type: input.type,
    title: input.title,
    summary: input.summary,
    keyPoints: input.keyPoints,
    actions: input.actions,
    tags: input.tags,
    sourceRecordingId: input.sourceRecordingId,
    sourceTextRange: input.sourceTextRange,
    confidence: input.confidence,
    version: input.version,
    createdAt: stamp,
    updatedAt: stamp,
    rawJson: input.rawJson
  };
  handle.db
    .prepare(
      `INSERT INTO thought_cards
       (id, type, title, summary, key_points_json, actions_json, tags_json, source_recording_id,
        source_text_range, confidence, version, created_at, updated_at, raw_json)
       VALUES
       (@id, @type, @title, @summary, @keyPointsJson, @actionsJson, @tagsJson, @sourceRecordingId,
        @sourceTextRange, @confidence, @version, @createdAt, @updatedAt, @rawJsonText)`
    )
    .run({
      ...card,
      keyPointsJson: JSON.stringify(card.keyPoints),
      actionsJson: JSON.stringify(card.actions),
      tagsJson: JSON.stringify(card.tags),
      rawJsonText: JSON.stringify(card.rawJson)
    });
  return {
    id: card.id,
    type: card.type,
    title: card.title,
    summary: card.summary,
    keyPoints: card.keyPoints,
    actions: card.actions,
    tags: card.tags,
    sourceRecordingId: card.sourceRecordingId,
    sourceTextRange: card.sourceTextRange,
    confidence: card.confidence,
    version: card.version,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt
  };
}

export function insertRelation(handle: DbHandle, input: Omit<CardRelation, "id" | "createdAt">): CardRelation {
  const relation: CardRelation = { ...input, id: nanoid(), createdAt: now() };
  handle.db
    .prepare(
      `INSERT OR IGNORE INTO card_relations
       (id, from_card_id, to_card_id, relation_type, confidence, rationale, created_at)
       VALUES (@id, @fromCardId, @toCardId, @relationType, @confidence, @rationale, @createdAt)`
    )
    .run(relation);
  return relation;
}

export function getRecentCards(handle: DbHandle, limit = 100): ThoughtCard[] {
  const rows = handle.db
    .prepare("SELECT * FROM thought_cards ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(mapCard);
}

export function getNextCardVersionForRecording(handle: DbHandle, recordingId: string): number {
  const row = handle.db
    .prepare("SELECT max(version) AS version FROM thought_cards WHERE source_recording_id = ?")
    .get(recordingId) as { version: number | null };
  return (row.version ?? 0) + 1;
}

export function getCardsForPeriod(handle: DbHandle, period: Period, key: string): ThoughtCard[] {
  const rows = handle.db
    .prepare(
      `SELECT c.*
       FROM thought_cards c
       JOIN recordings r ON r.id = c.source_recording_id
       WHERE ${
         period === "day"
           ? "r.day_key = @key"
           : period === "month"
             ? "r.month_key = @key"
             : "r.week_key = @key"
       }
       ORDER BY c.created_at ASC`
    )
    .all({ key }) as Array<Record<string, unknown>>;
  return rows.map(mapCard);
}

export function searchCards(handle: DbHandle, query: string, limit = 20): CardSearchResult[] {
  const normalized = query.trim();
  if (!normalized) return [];

  const pattern = `%${escapeLike(normalized)}%`;
  const rows = handle.db
    .prepare(
      `SELECT c.*,
              r.day_key,
              r.week_key,
              r.month_key,
              r.created_at AS recording_created_at
       FROM thought_cards c
       JOIN recordings r ON r.id = c.source_recording_id
       WHERE c.version = 1
         AND (
           c.title LIKE @pattern ESCAPE '\\'
           OR c.summary LIKE @pattern ESCAPE '\\'
           OR c.key_points_json LIKE @pattern ESCAPE '\\'
           OR c.actions_json LIKE @pattern ESCAPE '\\'
           OR c.tags_json LIKE @pattern ESCAPE '\\'
         )
       ORDER BY r.created_at DESC, c.created_at DESC
       LIMIT @limit`
    )
    .all({ pattern, limit: Math.max(1, Math.min(limit, 50)) }) as Array<Record<string, unknown>>;

  return rows.map(mapCardSearchResult);
}

export function getRelationsForCards(handle: DbHandle, cardIds: string[]): Array<{
  fromTitle: string;
  toTitle: string;
  relationType: string;
  rationale: string;
}> {
  if (!cardIds.length) return [];
  const placeholders = cardIds.map(() => "?").join(",");
  const rows = handle.db
    .prepare(
      `SELECT f.title AS from_title, t.title AS to_title, r.relation_type, r.rationale
       FROM card_relations r
       JOIN thought_cards f ON f.id = r.from_card_id
       JOIN thought_cards t ON t.id = r.to_card_id
       WHERE r.from_card_id IN (${placeholders}) OR r.to_card_id IN (${placeholders})
       ORDER BY r.created_at ASC`
    )
    .all(...cardIds, ...cardIds) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    fromTitle: String(row.from_title),
    toTitle: String(row.to_title),
    relationType: String(row.relation_type),
    rationale: String(row.rationale)
  }));
}

export function getTodayStats(handle: DbHandle, day: string): {
  recordings: number;
  pending: number;
  organized: number;
  cards: ThoughtCard[];
} {
  const recordings = Number(
    (handle.db.prepare("SELECT count(*) AS n FROM recordings WHERE day_key = ?").get(day) as { n: number }).n
  );
  const pending = Number(
    (
      handle.db
        .prepare(
          `SELECT count(*) AS n
           FROM recordings r
           LEFT JOIN thought_cards c ON c.source_recording_id = r.id AND c.version = 1
           WHERE r.day_key = ?
             AND (
               r.status IN ('uploaded', 'transcription_queued', 'transcribing', 'transcript_pending', 'organizing')
               OR (r.status = 'transcribed' AND c.id IS NULL)
             )`
        )
        .get(day) as { n: number }
    ).n
  );
  const cards = getCardsForPeriod(handle, "day", day);
  return { recordings, pending, organized: cards.length, cards };
}

export function listMonthOverview(
  handle: DbHandle,
  month: string
): Array<{ dayKey: string; recordings: number; pending: number; cards: number; hasSummary: boolean; summaryVersion: number | null }> {
  const rows = handle.db
    .prepare(
      `SELECT r.day_key AS dayKey,
              count(DISTINCT r.id) AS recordings,
              count(DISTINCT CASE
                WHEN r.status IN ('uploaded', 'transcription_queued', 'transcribing', 'transcript_pending', 'organizing')
                  OR (r.status = 'transcribed' AND c.id IS NULL)
                THEN r.id
              END) AS pending
       FROM recordings r
       LEFT JOIN thought_cards c ON c.source_recording_id = r.id AND c.version = 1
       WHERE r.month_key = ?
       GROUP BY r.day_key`
    )
    .all(month) as Array<Record<string, unknown>>;

  const byDay = new Map<
    string,
    { dayKey: string; recordings: number; pending: number; cards: number; hasSummary: boolean; summaryVersion: number | null }
  >();

  for (const row of rows) {
    const day = String(row.dayKey);
    byDay.set(day, {
      dayKey: day,
      recordings: Number(row.recordings),
      pending: Number(row.pending ?? 0),
      cards: 0,
      hasSummary: false,
      summaryVersion: null
    });
  }

  const cardRows = handle.db
    .prepare(
      `SELECT r.day_key AS dayKey, count(c.id) AS cards
       FROM recordings r
       JOIN thought_cards c ON c.source_recording_id = r.id AND c.version = 1
       WHERE r.month_key = ?
       GROUP BY r.day_key`
    )
    .all(month) as Array<Record<string, unknown>>;

  for (const row of cardRows) {
    const day = String(row.dayKey);
    const current = byDay.get(day) ?? { dayKey: day, recordings: 0, pending: 0, cards: 0, hasSummary: false, summaryVersion: null };
    current.cards = Number(row.cards);
    byDay.set(day, current);
  }

  const summaryRows = handle.db
    .prepare(
      `SELECT period_key AS dayKey, max(version) AS version
       FROM summary_artifacts
       WHERE period = 'day' AND substr(period_key, 1, 7) = ?
       GROUP BY period_key`
    )
    .all(month) as Array<Record<string, unknown>>;

  for (const row of summaryRows) {
    const day = String(row.dayKey);
    const current = byDay.get(day) ?? { dayKey: day, recordings: 0, pending: 0, cards: 0, hasSummary: false, summaryVersion: null };
    current.hasSummary = true;
    current.summaryVersion = row.version === null ? null : Number(row.version);
    byDay.set(day, current);
  }

  return Array.from(byDay.values()).sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

export function getLatestSummary(handle: DbHandle, period: Period, key: string): SummaryArtifact | null {
  const row = handle.db
    .prepare(
      `SELECT * FROM summary_artifacts
       WHERE period = ? AND period_key = ?
       ORDER BY version DESC
       LIMIT 1`
    )
    .get(period, key) as Record<string, unknown> | undefined;
  return row ? mapSummary(row) : null;
}

export function listSummaries(handle: DbHandle, period: Period): SummaryArtifact[] {
  const rows = handle.db
    .prepare(
      `SELECT *
       FROM summary_artifacts
       WHERE period = ?
       ORDER BY period_key DESC, version DESC`
    )
    .all(period) as Array<Record<string, unknown>>;
  return rows.map(mapSummary);
}

function mapSummary(row: Record<string, unknown>): SummaryArtifact {
  return {
    id: String(row.id),
    period: String(row.period) as Period,
    periodKey: String(row.period_key),
    markdownPath: String(row.markdown_path),
    listeningScript: String(row.listening_script),
    audioAssetId: row.audio_asset_id === null ? null : String(row.audio_asset_id),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function nextSummaryVersion(handle: DbHandle, period: Period, key: string): number {
  const row = handle.db
    .prepare("SELECT max(version) AS version FROM summary_artifacts WHERE period = ? AND period_key = ?")
    .get(period, key) as { version: number | null };
  return (row.version ?? 0) + 1;
}

export function insertSummary(handle: DbHandle, input: Omit<SummaryArtifact, "createdAt" | "updatedAt">): SummaryArtifact {
  const stamp = now();
  const artifact: SummaryArtifact = { ...input, createdAt: stamp, updatedAt: stamp };
  handle.db
    .prepare(
      `INSERT INTO summary_artifacts
       (id, period, period_key, markdown_path, listening_script, audio_asset_id, version, created_at, updated_at)
       VALUES (@id, @period, @periodKey, @markdownPath, @listeningScript, @audioAssetId, @version, @createdAt, @updatedAt)`
    )
    .run(artifact);
  return artifact;
}

export function getJobByHash(handle: DbHandle, inputHash: string): ProcessingJob | null {
  const row = handle.db.prepare("SELECT * FROM processing_jobs WHERE input_hash = ?").get(inputHash) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    kind: String(row.kind),
    status: String(row.status) as ProcessingJob["status"],
    inputHash: String(row.input_hash),
    error: row.error === null ? null : String(row.error),
    createdAt: String(row.created_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at)
  };
}

export function createJob(handle: DbHandle, kind: string, inputHash: string): ProcessingJob {
  const job: ProcessingJob = {
    id: nanoid(),
    kind,
    status: "running",
    inputHash,
    error: null,
    createdAt: now(),
    finishedAt: null
  };
  handle.db
    .prepare(
      `INSERT INTO processing_jobs (id, kind, status, input_hash, error, created_at, finished_at)
       VALUES (@id, @kind, @status, @inputHash, @error, @createdAt, @finishedAt)`
    )
    .run(job);
  return job;
}

export function finishJob(handle: DbHandle, id: string, status: ProcessingJob["status"], error: string | null = null): void {
  handle.db
    .prepare("UPDATE processing_jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?")
    .run(status, error, now(), id);
}

export function countAll(handle: DbHandle): { recordings: number; cards: number; summaries: number } {
  const recordings = (handle.db.prepare("SELECT count(*) AS n FROM recordings").get() as { n: number }).n;
  const cards = (handle.db.prepare("SELECT count(*) AS n FROM thought_cards").get() as { n: number }).n;
  const summaries = (handle.db.prepare("SELECT count(*) AS n FROM summary_artifacts").get() as { n: number }).n;
  return { recordings, cards, summaries };
}
