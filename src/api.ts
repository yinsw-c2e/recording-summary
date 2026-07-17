export type Period = "day" | "week" | "month";

export interface ThoughtCard {
  id: string;
  type: string;
  title: string;
  summary: string;
  keyPoints: string[];
  actions: string[];
  tags: string[];
  confidence: number;
  sourceRecordingId: string;
  sourceTextRange: string;
  starred: boolean;
  reviewed: boolean;
}

export interface CardSearchResult extends ThoughtCard {
  dayKey: string;
  weekKey: string;
  monthKey: string;
  recordingCreatedAt: string;
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
}

export interface RecordingListItem {
  id: string;
  duration: number | null;
  status: string;
  createdAt: string;
  audioAssetId: string;
  cardCount: number;
  hasTranscript: boolean;
  transcriptStatus: string | null;
  transcriptionJobStatus: string | null;
  workerId: string | null;
  error: string | null;
}

export interface RecordingTranscript {
  recordingId: string;
  rawText: string;
  language: string;
  sourceTimeRanges: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManualTranscriptOrganizeResult {
  recordingId: string;
  status: "completed" | "no_content";
  cardsCreated: number;
  relationsCreated: number;
  summary: SummaryArtifact | null;
}

export interface CardEditInput {
  type: string;
  title: string;
  summary: string;
  keyPoints: string[];
  actions: string[];
  tags: string[];
}

export interface CardEditResult {
  card: ThoughtCard;
  summaries: Partial<Record<Period, SummaryArtifact>>;
}

export interface CardDeleteResult {
  deleted: {
    cardId: string;
    recordingId: string;
    cardsDeleted: number;
    relationsDeleted: number;
    summariesDeleted: number;
    filesDeleted: number;
    remainingRecordingCards: number;
  };
  summaries: Partial<Record<Period, SummaryArtifact>>;
  summaryErrors: Array<{ period: Period; message: string }>;
}

export interface WorkerSnapshot {
  queue: Record<string, number>;
  workers: Array<{
    id: string;
    status: string;
    currentJobId: string | null;
    lastHeartbeatAt: string;
    error: string | null;
  }>;
}

export interface TodayResponse {
  keys: Record<Period, string>;
  stats: {
    recordings: number;
    pending: number;
    organized: number;
    cards: ThoughtCard[];
  };
  recordings: RecordingListItem[];
  summaries: Record<Period, SummaryArtifact | null>;
  provider: string;
  sttMode: string;
  worker: WorkerSnapshot;
}

export type DayDashboardResponse = TodayResponse;

export interface MonthDayOverview {
  dayKey: string;
  recordings: number;
  pending: number;
  cards: number;
  hasSummary: boolean;
  summaryVersion: number | null;
}

export interface MonthOverviewResponse {
  month: string;
  days: MonthDayOverview[];
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error || response.statusText);
  }
  return response.json() as Promise<T>;
}

export function getToday(): Promise<TodayResponse> {
  return json<TodayResponse>("/api/today");
}

export function getDayDashboard(key: string): Promise<DayDashboardResponse> {
  return json<DayDashboardResponse>(`/api/day?key=${encodeURIComponent(key)}`);
}

export function getMonthOverview(month: string): Promise<MonthOverviewResponse> {
  return json<MonthOverviewResponse>(`/api/month?month=${encodeURIComponent(month)}`);
}

export function searchCards(query: string): Promise<{ query: string; results: CardSearchResult[] }> {
  return json<{ query: string; results: CardSearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=20`);
}

export function getAuthStatus(): Promise<{ authRequired: boolean; authenticated: boolean }> {
  return json("/api/auth/status");
}

export function login(password: string): Promise<{ ok: boolean }> {
  return json("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
}

export function logout(): Promise<{ ok: boolean }> {
  return json("/api/auth/logout", { method: "POST" });
}

export async function uploadRecording(blob: Blob, duration: number, transcript: string): Promise<{ recording: { id: string; status: string } }> {
  const form = new FormData();
  const ext = blob.type.includes("mp4") || blob.type.includes("aac") ? "m4a" : "webm";
  form.append("audio", blob, `recording.${ext}`);
  form.append("duration", String(Math.round(duration)));
  if (transcript.trim()) form.append("transcript", transcript.trim());
  return json("/api/recordings", { method: "POST", body: form });
}

export function attachTranscript(recordingId: string, text: string): Promise<{ ok: boolean }> {
  return json(`/api/recordings/${recordingId}/transcript`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
}

export function getRecordingTranscript(recordingId: string): Promise<RecordingTranscript> {
  return json(`/api/recordings/${recordingId}/transcript`);
}

export function updateThoughtCard(cardId: string, input: CardEditInput): Promise<CardEditResult> {
  return json(`/api/cards/${cardId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function deleteThoughtCard(cardId: string): Promise<CardDeleteResult> {
  return json(`/api/cards/${cardId}`, { method: "DELETE" });
}

export function setThoughtCardStarred(cardId: string, starred: boolean): Promise<{ card: ThoughtCard }> {
  return json(`/api/cards/${cardId}/star`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ starred })
  });
}

export function setThoughtCardReviewed(cardId: string, reviewed: boolean): Promise<{ card: ThoughtCard }> {
  return json(`/api/cards/${cardId}/reviewed`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewed })
  });
}

export function setThoughtCardsReviewed(cardIds: string[], reviewed: boolean): Promise<{ cards: ThoughtCard[] }> {
  return json("/api/cards/reviewed/bulk", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardIds, reviewed })
  });
}

export function saveTranscriptAndOrganize(recordingId: string, text: string): Promise<ManualTranscriptOrganizeResult> {
  return json(`/api/recordings/${recordingId}/transcript/organize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
}

export function deleteRecording(recordingId: string): Promise<unknown> {
  return json(`/api/recordings/${recordingId}`, { method: "DELETE" });
}

export function retryTranscription(recordingId: string): Promise<unknown> {
  return json(`/api/recordings/${recordingId}/retry-transcription`, { method: "POST" });
}

export function organizeNew(): Promise<{ processed: number; skipped: number; cardsCreated: number; relationsCreated: number }> {
  return json("/api/process/organize-new", { method: "POST" });
}

export function finishLatest(): Promise<{ organized: unknown; summary: SummaryArtifact }> {
  return json("/api/process/finish-latest", { method: "POST" });
}

export function regenerateSummary(period: Period, key: string): Promise<{ summary: SummaryArtifact }> {
  return json(`/api/summaries/${period}/${encodeURIComponent(key)}/regenerate`, { method: "POST" });
}

export function deepReorganize(period: Period, key: string): Promise<unknown> {
  return json(`/api/summaries/${period}/${encodeURIComponent(key)}/deep-reorganize`, { method: "POST" });
}

export async function getSummaryMarkdown(summaryId: string): Promise<string> {
  const response = await fetch(`/api/summary/${summaryId}/markdown`);
  if (!response.ok) throw new Error(response.statusText);
  return response.text();
}

export function audioUrl(audioAssetId: string): string {
  return `/api/audio/${audioAssetId}`;
}
