export type RecordingFilter = "all" | "open" | "needs_review" | "organized";

export interface RecordingStatusLike {
  status: string;
}

export const recordingFilters: Array<{ key: RecordingFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "open", label: "待处理" },
  { key: "needs_review", label: "异常" },
  { key: "organized", label: "已整理" }
];

export const processingStatuses = new Set([
  "uploaded",
  "transcription_queued",
  "transcribing",
  "transcript_pending",
  "transcribed",
  "organizing"
]);

export const reviewStatuses = new Set(["no_content", "transcript_suspect", "failed"]);

export function matchesRecordingFilter(recording: RecordingStatusLike, filter: RecordingFilter): boolean {
  if (filter === "all") return true;
  if (filter === "open") return processingStatuses.has(recording.status);
  if (filter === "needs_review") return reviewStatuses.has(recording.status);
  return recording.status === "organized";
}

export function countRecordingFilters(recordings: RecordingStatusLike[]): Record<RecordingFilter, number> {
  return {
    all: recordings.length,
    open: recordings.filter((item) => matchesRecordingFilter(item, "open")).length,
    needs_review: recordings.filter((item) => matchesRecordingFilter(item, "needs_review")).length,
    organized: recordings.filter((item) => matchesRecordingFilter(item, "organized")).length
  };
}
