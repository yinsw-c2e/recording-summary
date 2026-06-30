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
  transcriptionJobStatus: string | null;
  workerId: string | null;
  error: string | null;
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
  const ext = blob.type.includes("mp4") ? "m4a" : "webm";
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

export function deleteRecording(recordingId: string): Promise<unknown> {
  return json(`/api/recordings/${recordingId}`, { method: "DELETE" });
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
