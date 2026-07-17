export type NextStepKind = "recording_review" | "recording_open" | "review_due" | "action" | "confirm" | "ready" | "empty";

export interface NextStepInput {
  reviewRecordingCount: number;
  openRecordingCount: number;
  reviewDueCount: number;
  openActionCount: number;
  confirmCount: number;
  cardCount: number;
  recordingCount: number;
}

export function selectNextStep(input: NextStepInput): NextStepKind {
  if (input.reviewRecordingCount > 0) return "recording_review";
  if (input.openRecordingCount > 0) return "recording_open";
  if (input.confirmCount > 0) return "confirm";
  if (input.reviewDueCount > 0) return "review_due";
  if (input.openActionCount > 0) return "action";
  if (input.cardCount > 0) return "ready";
  return "empty";
}
