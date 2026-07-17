export type SpeechSource = "summary" | "focus" | "review_due";

export interface SpeechPlaybackState {
  source: SpeechSource | null;
  paused: boolean;
}

export const speechSourceLabels: Record<SpeechSource, string> = {
  summary: "总结",
  focus: "重点",
  review_due: "待复习"
};

export function speechStatusText(state: SpeechPlaybackState): string {
  if (!state.source) return "未朗读";
  return state.paused ? `${speechSourceLabels[state.source]}已暂停` : `${speechSourceLabels[state.source]}朗读中`;
}

export function speechStartButtonLabel(source: SpeechSource, state: SpeechPlaybackState, rate: number): string {
  return state.source === source ? `停止${speechSourceLabels[source]}` : `朗读${speechSourceLabels[source]} ${rate}x`;
}

export function speechPauseButtonLabel(state: SpeechPlaybackState): string {
  if (!state.source) return "暂停朗读";
  return state.paused ? "继续朗读" : "暂停朗读";
}

export function canToggleSpeechPause(state: SpeechPlaybackState): boolean {
  return Boolean(state.source);
}
