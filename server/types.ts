export type Period = "day" | "week" | "month";

export type RecordingStatus =
  | "uploaded"
  | "transcription_queued"
  | "transcribing"
  | "transcript_pending"
  | "transcribed"
  | "organizing"
  | "organized"
  | "no_content"
  | "transcript_suspect"
  | "failed";

export type JobStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type TranscriptionJobStatus =
  | "pending"
  | "claimed"
  | "transcribing"
  | "completed"
  | "failed"
  | "suspect";

export type CardType =
  | "raw_idea"
  | "project_idea"
  | "knowledge"
  | "task"
  | "question"
  | "reflection"
  | "daily_note"
  | "uncertain";

export type RelationType =
  | "continuation"
  | "duplicate"
  | "refinement"
  | "contradiction"
  | "task_followup"
  | "knowledge_link"
  | "project_link"
  | "uncertain";

export interface Recording {
  id: string;
  audioPath: string;
  audioAssetId: string;
  duration: number | null;
  mimeType: string;
  createdAt: string;
  status: RecordingStatus;
  error: string | null;
}

export interface RecordingListItem {
  id: string;
  duration: number | null;
  status: RecordingStatus;
  createdAt: string;
  audioAssetId: string;
  cardCount: number;
  hasTranscript: boolean;
  transcriptStatus: Transcript["status"] | null;
  transcriptionJobStatus: TranscriptionJobStatus | null;
  workerId: string | null;
  error: string | null;
}

export interface TranscriptionJob {
  id: string;
  recordingId: string;
  status: TranscriptionJobStatus;
  attempts: number;
  lockedBy: string | null;
  lockedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface WorkerNode {
  id: string;
  status: "online" | "offline" | "transcribing";
  currentJobId: string | null;
  lastHeartbeatAt: string;
  error: string | null;
}

export interface Transcript {
  recordingId: string;
  rawText: string;
  language: string;
  sourceTimeRanges: string;
  status: "pending" | "completed" | "failed";
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThoughtCard {
  id: string;
  type: CardType;
  title: string;
  summary: string;
  keyPoints: string[];
  actions: string[];
  tags: string[];
  sourceRecordingId: string;
  sourceTextRange: string;
  confidence: number;
  starred: boolean;
  reviewed: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type CompletedActionMap = Record<string, true>;

export interface CardSearchResult extends ThoughtCard {
  dayKey: string;
  weekKey: string;
  monthKey: string;
  recordingCreatedAt: string;
}

export interface CardRelation {
  id: string;
  fromCardId: string;
  toCardId: string;
  relationType: RelationType;
  confidence: number;
  rationale: string;
  createdAt: string;
}

export interface CardRelationView extends CardRelation {
  fromTitle: string;
  toTitle: string;
}

export interface SummaryArtifact {
  id: string;
  period: Period;
  periodKey: string;
  markdownPath: string;
  listeningScript: string;
  audioAssetId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingJob {
  id: string;
  kind: string;
  status: JobStatus;
  inputHash: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AudioAsset {
  id: string;
  kind: "recording" | "summary";
  ownerId: string;
  path: string;
  mimeType: string;
  createdAt: string;
}
