import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Clipboard,
  Trash2,
  FileAudio,
  FileText,
  ListChecks,
  Loader2,
  LogOut,
  Mic,
  Pencil,
  Volume2,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Square,
  Waves
} from "lucide-react";
import {
  actionItemFilters,
  countActionItemFilters,
  matchesActionItemFilter,
  orderActionItems,
  type ActionItemFilter
} from "./actionItems";
import {
  attachTranscript,
  audioUrl,
  deepReorganize,
  deleteRecording,
  deleteThoughtCard,
  finishLatest,
  getAuthStatus,
  getDayDashboard,
  getMonthOverview,
  getRecordingTranscript,
  getSummaryMarkdown,
  getToday,
  login,
  logout,
  organizeNew,
  regenerateSummary,
  retryTranscription,
  searchCards,
  saveTranscriptAndOrganize,
  setThoughtCardReviewed,
  setThoughtCardStarred,
  updateThoughtCard,
  uploadRecording,
  type Period,
  type CardSearchResult,
  type MonthDayOverview,
  type RecordingListItem,
  type RecordingTranscript,
  type SummaryArtifact,
  type ThoughtCard,
  type TodayResponse
} from "./api";
import {
  countRecordingFilters,
  matchesRecordingFilter,
  processingStatuses,
  recordingFilters,
  type RecordingFilter
} from "./recordingFilters";
import {
  buildFocusExportMarkdown,
  buildFocusListeningScript,
  buildReviewDueListeningScript,
  markdownList,
  type CompletedActions,
  type FocusActionItem
} from "./focusArtifacts";

const periodLabels: Record<Period, string> = {
  day: "日",
  week: "周",
  month: "月"
};

const typeLabels: Record<string, string> = {
  raw_idea: "灵感记录",
  project_idea: "项目想法",
  knowledge: "知识",
  task: "任务",
  question: "问题",
  reflection: "反思",
  daily_note: "记录",
  uncertain: "待确认"
};

type SpeechSource = "summary" | "focus" | "review_due";
type CopySource = "focus" | "summary" | `card:${string}` | `card-source:${string}` | `transcript:${string}`;
type StatusTone = "pending" | "active" | "done" | "warning" | "danger" | "muted";
type CardDraft = {
  type: string;
  title: string;
  summary: string;
  keyPoints: string;
  actions: string;
  tags: string;
};

const cardTypeOrder = ["task", "project_idea", "raw_idea", "knowledge", "question", "reflection", "daily_note", "uncertain"];
const completedActionsStorageKey = "recording-summary.completed-actions.v1";
const recordingMimeCandidates = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
  "audio/webm;codecs=opus",
  "audio/webm"
];

const speechRates = [1, 1.25, 1.5, 1.75, 2];

function preferredRecordingMimeType(): string {
  return recordingMimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function monthFromDay(key: string): string {
  return key.slice(0, 7);
}

function monthLabel(month: string): string {
  const [year, value] = month.split("-");
  return `${year}年${Number(value)}月`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(year, value - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftDayKey(key: string, delta: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysForMonth(month: string): Array<{ key: string; day: number; offset: number }> {
  const [year, value] = month.split("-").map(Number);
  if (!year || !value) return [];
  const days = new Date(year, value, 0).getDate();
  const first = new Date(year, value - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: days }, (_, index) => ({
    key: `${month}-${String(index + 1).padStart(2, "0")}`,
    day: index + 1,
    offset: index === 0 ? offset : 0
  }));
}

function formatSeconds(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    uploaded: "已上传",
    transcription_queued: "等待 Mac",
    transcribing: "Mac 转写中",
    transcript_pending: "待转写",
    transcribed: "待整理",
    organizing: "AI 整理中",
    organized: "已整理",
    no_content: "无有效内容",
    transcript_suspect: "转写异常",
    failed: "失败"
  };
  return labels[status] ?? status;
}

function transcriptStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "待处理",
    completed: "已完成",
    failed: "已失效"
  };
  return labels[status] ?? status;
}

function statusTone(status: string): StatusTone {
  if (["organized"].includes(status)) return "done";
  if (["transcribing", "organizing"].includes(status)) return "active";
  if (["uploaded", "transcription_queued", "transcript_pending", "transcribed"].includes(status)) return "pending";
  if (["no_content", "transcript_suspect"].includes(status)) return "warning";
  if (status === "failed") return "danger";
  return "muted";
}

function statusHelp(status: string, workerOnline: boolean): string {
  const labels: Record<string, string> = {
    uploaded: "录音已保存，正在进入转写队列。",
    transcription_queued: workerOnline ? "已排队，Mac Worker 会自动领取转写。" : "已排队；Mac 当前离线，恢复在线后会自动转写。",
    transcribing: "Mac 正在调用本地 Whisper 转写，完成后会回传云端。",
    transcript_pending: "等待转写文本；如果使用手动转写，可在下方补充。",
    transcribed: "转写已完成，下一步会交给 AI 拆分卡片和更新总结。",
    organizing: "AI 正在清洗口语、拆分卡片并刷新总结。",
    organized: "已生成卡片并参与总结。",
    no_content: "这段没有提取到有效想法；如果你认为识别错了，可以重新转写或补充手动转写。",
    transcript_suspect: "转写结果疑似异常，可以重新交给 Mac 转写，也可以补充手动转写。",
    failed: "处理失败；如果原录音还在，可以重新交给 Mac 转写，也可以删除。"
  };
  return labels[status] ?? "状态已记录。";
}

function canRetryTranscription(item: RecordingListItem, sttMode: string | undefined): boolean {
  return (
    sttMode === "remote-worker" &&
    item.cardCount === 0 &&
    ["failed", "transcript_suspect", "no_content"].includes(item.status)
  );
}

function canEditTranscript(item: RecordingListItem): boolean {
  return item.cardCount === 0 && !["uploaded", "transcription_queued", "transcribing", "organizing"].includes(item.status);
}

function listToText(items: string[]): string {
  return items.join("\n");
}

function textToLines(value: string): string[] {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function textToTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n，、]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function draftFromCard(card: ThoughtCard): CardDraft {
  return {
    type: card.type,
    title: card.title,
    summary: card.summary,
    keyPoints: listToText(card.keyPoints),
    actions: listToText(card.actions),
    tags: listToText(card.tags)
  };
}

function readCompletedActions(): CompletedActions {
  if (typeof window === "undefined") return {};
  try {
    const payload = window.localStorage.getItem(completedActionsStorageKey);
    if (!payload) return {};
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === true)) as CompletedActions;
  } catch {
    return {};
  }
}

function cardMarkdown(card: ThoughtCard, completedActions: CompletedActions = {}): string {
  return [
    `# ${card.title}`,
    "",
    `- 类型：${typeLabels[card.type] ?? card.type}`,
    `- 重点：${card.starred ? "是" : "否"}`,
    `- 已复习：${card.reviewed ? "是" : "否"}`,
    `- 置信度：${Math.round(card.confidence * 100)}%`,
    `- 来源录音：${card.sourceRecordingId}`,
    `- 来源片段：${card.sourceTextRange}`,
    "",
    "## 摘要",
    card.summary,
    "",
    "## 关键点",
    ...markdownList(card.keyPoints, "暂无关键点"),
    "",
    "## 行动项",
    ...markdownList(card.actions.map((action, index) => `[${completedActions[`${card.id}-${index}`] ? "x" : " "}] ${action}`), "暂无行动项"),
    "",
    "## 标签",
    ...markdownList(card.tags, "暂无标签")
  ].join("\n");
}

function cardSourceMarkdown(card: ThoughtCard, transcript: RecordingTranscript): string {
  return [
    `# ${card.title} 来源`,
    "",
    `- 来源录音：${card.sourceRecordingId}`,
    `- 来源片段：${card.sourceTextRange}`,
    `- 转写状态：${transcript.status}`,
    `- 语言：${transcript.language || "未知"}`,
    "",
    "## 原始转写",
    transcript.rawText
  ].join("\n");
}

export function App() {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("day");
  const [summaryMarkdown, setSummaryMarkdown] = useState("");
  const [manualTranscript, setManualTranscript] = useState("");
  const [lastRecordingId, setLastRecordingId] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [speechSource, setSpeechSource] = useState<SpeechSource | null>(null);
  const [speechRate, setSpeechRate] = useState(1.5);
  const [copiedSource, setCopiedSource] = useState<CopySource | null>(null);
  const [audioErrors, setAudioErrors] = useState<Record<string, boolean>>({});
  const [transcripts, setTranscripts] = useState<Record<string, RecordingTranscript>>({});
  const [openTranscriptId, setOpenTranscriptId] = useState("");
  const [transcriptLoadingId, setTranscriptLoadingId] = useState("");
  const [editingTranscriptId, setEditingTranscriptId] = useState("");
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [editingCardId, setEditingCardId] = useState("");
  const [openCardSourceId, setOpenCardSourceId] = useState("");
  const [cardSourceLoadingId, setCardSourceLoadingId] = useState("");
  const [cardDraft, setCardDraft] = useState<CardDraft>(() => ({
    type: "daily_note",
    title: "",
    summary: "",
    keyPoints: "",
    actions: "",
    tags: ""
  }));
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const [selectedDayData, setSelectedDayData] = useState<TodayResponse | null>(null);
  const [visibleMonth, setVisibleMonth] = useState("");
  const [monthOverview, setMonthOverview] = useState<MonthDayOverview[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CardSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [cardTypeFilter, setCardTypeFilter] = useState("all");
  const [recordingFilter, setRecordingFilter] = useState<RecordingFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionItemFilter>("open");
  const [completedActions, setCompletedActions] = useState<CompletedActions>(() => readCompletedActions());
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const dayContentRef = useRef<HTMLDivElement | null>(null);
  const speechRunRef = useRef(0);

  const todayDayKeyValue = today?.keys.day ?? todayKey();
  const activeDay = selectedDayKey || todayDayKeyValue;
  const isSelectedToday = activeDay === todayDayKeyValue;
  const canGoNextDay = activeDay < todayDayKeyValue;
  const previousDay = shiftDayKey(activeDay, -1);
  const nextDay = shiftDayKey(activeDay, 1);
  const activeDayLabel = isSelectedToday ? `今天 ${activeDay}` : activeDay;
  const selectedDayDataMatches = selectedDayData?.keys.day === activeDay;
  const activeData = selectedDayDataMatches ? selectedDayData : isSelectedToday ? today : null;
  const selectedSummary: SummaryArtifact | null = activeData?.summaries[selectedPeriod] ?? null;
  const selectedKey = activeData?.keys[selectedPeriod] ?? "";
  const cards = activeData?.stats.cards ?? [];
  const recordings = activeData?.recordings ?? [];
  const worker = today?.worker;
  const todayDayKey = todayDayKeyValue;
  const overviewByDay = useMemo(() => new Map(monthOverview.map((item) => [item.dayKey, item])), [monthOverview]);
  const selectedDayOverview = overviewByDay.get(activeDay);
  const selectedDaySnapshot = useMemo(() => {
    const daySummary = activeData?.summaries.day;
    const summaryVersion = daySummary?.version ?? selectedDayOverview?.summaryVersion ?? null;
    const hasDaySummary = Boolean(daySummary || selectedDayOverview?.hasSummary);
    return {
      recordings: activeData?.stats.recordings ?? selectedDayOverview?.recordings ?? 0,
      pending: activeData?.stats.pending ?? selectedDayOverview?.pending ?? 0,
      cards: activeData?.stats.cards.length ?? selectedDayOverview?.cards ?? 0,
      summaryLabel: summaryVersion ? `v${summaryVersion}` : hasDaySummary ? "已生成" : "未生成"
    };
  }, [activeData, selectedDayOverview]);
  const dayDataLoading = authenticated && Boolean(activeDay) && !activeData;
  const calendarDays = useMemo(() => daysForMonth(visibleMonth || monthFromDay(todayDayKey)), [visibleMonth, todayDayKey]);
  const actionItems = useMemo<FocusActionItem[]>(
    () =>
      cards.flatMap((card) =>
        card.actions.map((action, index) => ({
          id: `${card.id}-${index}`,
          action,
          title: card.title,
          type: card.type
        }))
      ),
    [cards]
  );
  const reviewCards = useMemo(() => cards.filter((card) => card.type === "question" || card.type === "uncertain"), [cards]);
  const starredCards = useMemo(() => cards.filter((card) => card.starred), [cards]);
  const starredCardCount = starredCards.length;
  const reviewDueCards = useMemo(() => cards.filter((card) => !card.reviewed), [cards]);
  const reviewedCardCount = cards.length - reviewDueCards.length;
  const cardTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    cards.forEach((card) => counts.set(card.type, (counts.get(card.type) ?? 0) + 1));
    return counts;
  }, [cards]);
  const visibleCardTypes = useMemo(
    () => cardTypeOrder.filter((type) => cardTypeCounts.has(type)).concat(
      Array.from(cardTypeCounts.keys()).filter((type) => !cardTypeOrder.includes(type))
    ),
    [cardTypeCounts]
  );
  const filteredCards = useMemo(
    () =>
      cardTypeFilter === "all"
        ? cards
        : cardTypeFilter === "starred"
          ? cards.filter((card) => card.starred)
          : cardTypeFilter === "review_due"
            ? cards.filter((card) => !card.reviewed)
            : cardTypeFilter === "reviewed"
              ? cards.filter((card) => card.reviewed)
              : cards.filter((card) => card.type === cardTypeFilter),
    [cards, cardTypeFilter]
  );
  const recordingFilterCounts = useMemo(() => countRecordingFilters(recordings), [recordings]);
  const filteredRecordings = useMemo(
    () => recordings.filter((item) => matchesRecordingFilter(item, recordingFilter)),
    [recordingFilter, recordings]
  );
  const completedActionCount = useMemo(
    () => actionItems.filter((item) => completedActions[item.id]).length,
    [actionItems, completedActions]
  );
  const orderedActionItems = useMemo(() => orderActionItems(actionItems, completedActions), [actionItems, completedActions]);
  const actionFilterCounts = useMemo(() => countActionItemFilters(actionItems, completedActions), [actionItems, completedActions]);
  const visibleActionItems = useMemo(
    () => orderedActionItems.filter((item) => matchesActionItemFilter(item, completedActions, actionFilter)),
    [actionFilter, completedActions, orderedActionItems]
  );
  const focusListeningScript = useMemo(
    () =>
      buildFocusListeningScript({
        day: activeDay,
        cards,
        actionItems,
        completedActions,
        completedActionCount,
        reviewCards
      }),
    [actionItems, activeDay, cards, completedActionCount, completedActions, reviewCards]
  );
  const reviewDueListeningScript = useMemo(
    () =>
      buildReviewDueListeningScript({
        day: activeDay,
        cards,
        typeLabels
      }),
    [activeDay, cards]
  );
  const focusExportMarkdown = useMemo(
    () =>
      buildFocusExportMarkdown({
        day: activeDay,
        cards,
        actionItems,
        completedActions,
        completedActionCount,
        reviewCards,
        typeLabels
      }),
    [actionItems, activeDay, cards, completedActionCount, completedActions, reviewCards]
  );

  async function refresh(): Promise<TodayResponse | null> {
    try {
      const next = await getToday();
      setToday(next);
      setAuthenticated(true);
      return next;
    } catch (err) {
      if (err instanceof Error && err.message.includes("authentication required")) {
        setAuthenticated(false);
        return null;
      }
      throw err;
    }
  }

  async function refreshSelectedDay(day = selectedDayKey): Promise<TodayResponse | null> {
    if (!day) return null;
    const next = await getDayDashboard(day);
    setSelectedDayData(next);
    return next;
  }

  async function refreshVisibleMonth(month = visibleMonth): Promise<void> {
    if (!month) return;
    const next = await getMonthOverview(month);
    setMonthOverview(next.days);
  }

  function scrollToDayContent() {
    window.setTimeout(() => {
      dayContentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function selectDay(day: string, options: { scrollToContent?: boolean } = {}) {
    setSelectedDayKey(day);
    setVisibleMonth(monthFromDay(day));
    setSelectedPeriod("day");
    setCardTypeFilter("all");
    setRecordingFilter("all");
    setActionFilter("open");
    setOpenTranscriptId("");
    setEditingTranscriptId("");
    setTranscriptDraft("");
    setEditingCardId("");
    setOpenCardSourceId("");
    setCardSourceLoadingId("");
    if (options.scrollToContent) scrollToDayContent();
  }

  function navigateDay(delta: number) {
    const nextDay = shiftDayKey(activeDay, delta);
    if (delta > 0 && nextDay > todayDayKeyValue) return;
    selectDay(nextDay, { scrollToContent: true });
  }

  function jumpToToday() {
    selectDay(todayDayKey, { scrollToContent: true });
  }

  function jumpToSearchResult(day: string) {
    selectDay(day);
    window.setTimeout(() => {
      document.querySelector(".cards-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function toggleActionDone(id: string) {
    setCompletedActions((current) => {
      const next = { ...current };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      return next;
    });
  }

  useEffect(() => {
    getAuthStatus()
      .then(async (status) => {
        setAuthRequired(status.authRequired);
        setAuthenticated(status.authenticated);
        setAuthChecked(true);
        if (status.authenticated) {
          const next = await refresh();
          if (next) {
            setSelectedDayKey(next.keys.day);
            setSelectedDayData(next);
            setVisibleMonth(next.keys.month);
          }
        }
      })
      .catch((err) => {
        setAuthChecked(true);
        setError(err.message);
      });
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(completedActionsStorageKey, JSON.stringify(completedActions));
    } catch {
      // Ignore private-mode or quota failures; the checkbox state still works for this session.
    }
  }, [completedActions]);

  useEffect(() => {
    if (!authenticated || !selectedDayKey) return;
    refreshSelectedDay(selectedDayKey).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [authenticated, selectedDayKey]);

  useEffect(() => {
    if (!authenticated || !visibleMonth) return;
    refreshVisibleMonth(visibleMonth).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [authenticated, visibleMonth]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!authenticated || !query) {
      setSearchResults([]);
      setSearchBusy(false);
      return;
    }

    let cancelled = false;
    setSearchBusy(true);
    const timer = window.setTimeout(() => {
      searchCards(query)
        .then((payload) => {
          if (!cancelled) setSearchResults(payload.results);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setSearchBusy(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authenticated, searchQuery]);

  useEffect(() => {
    if (!selectedSummary) {
      setSummaryMarkdown("");
      return;
    }
    getSummaryMarkdown(selectedSummary.id)
      .then(setSummaryMarkdown)
      .catch(() => setSummaryMarkdown(""));
  }, [selectedSummary?.id]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!authenticated || !recordings.some((item) => processingStatuses.has(item.status))) return;
    const timer = window.setInterval(() => {
      Promise.all([refresh(), refreshSelectedDay(), refreshVisibleMonth()]).catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      );
    }, 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, recordings, selectedDayKey, visibleMonth]);

  async function startRecording() {
    setError("");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = preferredRecordingMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    startedAtRef.current = Date.now();
    setElapsed(0);
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      setBusy("upload");
      try {
        const result = await uploadRecording(blob, Math.floor((Date.now() - startedAtRef.current) / 1000), manualTranscript);
        setLastRecordingId(result.recording.id);
        const next = await refresh();
        if (next) {
          setSelectedDayKey(next.keys.day);
          setSelectedDayData(next);
          setVisibleMonth(next.keys.month);
          await refreshVisibleMonth(next.keys.month);
        }
        if (["transcription_queued", "transcribing", "transcript_pending"].includes(result.recording.status)) {
          return;
        }
        await finishLatest();
        if (manualTranscript.trim()) {
          setManualTranscript("");
        }
        await refreshSelectedDay(next?.keys.day);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    };
    recorder.start();
    setRecording(true);
  }

  function stopRecording() {
    setRecording(false);
    recorderRef.current?.stop();
  }

  async function runAction(label: string, action: () => Promise<unknown>) {
    setError("");
    setBusy(label);
    try {
      await action();
      await refresh();
      await refreshSelectedDay();
      await refreshVisibleMonth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function removeRecording(recording: RecordingListItem) {
    const confirmed = window.confirm("确定删除这段录音？未进入卡片的录音只会删除文件；已进入卡片的录音会稳定修复受影响总结。");
    if (!confirmed) return;
    await runAction("delete", () => deleteRecording(recording.id));
  }

  async function toggleTranscript(recording: RecordingListItem) {
    if (openTranscriptId === recording.id) {
      setOpenTranscriptId("");
      if (editingTranscriptId === recording.id) {
        setEditingTranscriptId("");
        setTranscriptDraft("");
      }
      return;
    }

    setOpenTranscriptId(recording.id);
    setEditingTranscriptId("");
    setTranscriptDraft("");
    if (transcripts[recording.id]) return;

    setError("");
    setTranscriptLoadingId(recording.id);
    try {
      const transcript = await getRecordingTranscript(recording.id);
      setTranscripts((current) => ({ ...current, [recording.id]: transcript }));
    } catch (err) {
      setOpenTranscriptId("");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscriptLoadingId("");
    }
  }

  async function startEditingTranscript(recording: RecordingListItem) {
    if (!canEditTranscript(recording)) return;

    setOpenTranscriptId(recording.id);
    setEditingTranscriptId(recording.id);
    setError("");

    const cached = transcripts[recording.id];
    if (cached) {
      setTranscriptDraft(cached.rawText);
      return;
    }

    if (!recording.hasTranscript) {
      setTranscriptDraft("");
      return;
    }

    setTranscriptLoadingId(recording.id);
    try {
      const transcript = await getRecordingTranscript(recording.id);
      setTranscripts((current) => ({ ...current, [recording.id]: transcript }));
      setTranscriptDraft(transcript.rawText);
    } catch (err) {
      setOpenTranscriptId("");
      setEditingTranscriptId("");
      setTranscriptDraft("");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscriptLoadingId("");
    }
  }

  async function saveTranscriptEdit(recording: RecordingListItem) {
    const text = transcriptDraft.trim();
    if (!text) {
      setError("转写文本不能为空。");
      return;
    }

    await runAction("transcript", async () => {
      await saveTranscriptAndOrganize(recording.id, text);
      const transcript = await getRecordingTranscript(recording.id);
      setTranscripts((current) => ({ ...current, [recording.id]: transcript }));
      setOpenTranscriptId(recording.id);
      setEditingTranscriptId("");
      setTranscriptDraft("");
    });
  }

  function startEditingCard(card: ThoughtCard) {
    setEditingCardId(card.id);
    setOpenCardSourceId("");
    setCardDraft(draftFromCard(card));
    setError("");
  }

  async function saveCardEdit(card: ThoughtCard) {
    const title = cardDraft.title.trim();
    const summary = cardDraft.summary.trim();
    if (!title || !summary) {
      setError("卡片标题和摘要不能为空。");
      return;
    }

    await runAction("card-edit", async () => {
      await updateThoughtCard(card.id, {
        type: cardDraft.type,
        title,
        summary,
        keyPoints: textToLines(cardDraft.keyPoints),
        actions: textToLines(cardDraft.actions),
        tags: textToTags(cardDraft.tags)
      });
      setEditingCardId("");
    });
  }

  async function removeCard(card: ThoughtCard) {
    const confirmed = window.confirm("确定删除这张卡片？原始录音和转写会保留，只会移除这张卡片并刷新受影响总结。");
    if (!confirmed) return;

    await runAction("card-delete", async () => {
      await deleteThoughtCard(card.id);
      if (editingCardId === card.id) setEditingCardId("");
      if (openCardSourceId === card.id) setOpenCardSourceId("");
    });
  }

  async function toggleCardStar(card: ThoughtCard) {
    await runAction("card-star", async () => {
      await setThoughtCardStarred(card.id, !card.starred);
    });
  }

  async function toggleCardReviewed(card: ThoughtCard) {
    await runAction("card-review", async () => {
      await setThoughtCardReviewed(card.id, !card.reviewed);
    });
  }

  async function toggleCardSource(card: ThoughtCard) {
    if (openCardSourceId === card.id) {
      setOpenCardSourceId("");
      return;
    }

    setOpenCardSourceId(card.id);
    setEditingCardId("");
    if (transcripts[card.sourceRecordingId]) return;

    setError("");
    setCardSourceLoadingId(card.id);
    try {
      const transcript = await getRecordingTranscript(card.sourceRecordingId);
      setTranscripts((current) => ({ ...current, [card.sourceRecordingId]: transcript }));
    } catch (err) {
      setOpenCardSourceId("");
      setError(err instanceof Error ? `读取卡片来源失败：${err.message}` : String(err));
    } finally {
      setCardSourceLoadingId("");
    }
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy("login");
    try {
      await login(password);
      setPassword("");
      setAuthenticated(true);
      const next = await refresh();
      if (next) {
        setSelectedDayKey(next.keys.day);
        setSelectedDayData(next);
        setVisibleMonth(next.keys.month);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    await logout();
    window.speechSynthesis?.cancel();
    setSpeechSource(null);
    setAuthenticated(false);
    setToday(null);
    setSelectedDayData(null);
    setSelectedDayKey("");
    setOpenTranscriptId("");
    setEditingTranscriptId("");
    setTranscriptDraft("");
    setTranscripts({});
    setEditingCardId("");
    setVisibleMonth("");
    setMonthOverview([]);
    setSearchQuery("");
    setSearchResults([]);
    setSearchBusy(false);
    setCardTypeFilter("all");
    setActionFilter("open");
    setOpenTranscriptId("");
    setTranscriptLoadingId("");
    setTranscripts({});
    setOpenCardSourceId("");
    setCardSourceLoadingId("");
    setCopiedSource(null);
  }

  async function copyText(text: string, source: CopySource) {
    if (!text.trim()) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!copied) throw new Error("copy command failed");
      }
      setCopiedSource(source);
      window.setTimeout(() => {
        setCopiedSource((current) => (current === source ? null : current));
      }, 1600);
    } catch {
      setError("当前浏览器不允许直接复制，请手动选中文字复制。");
    }
  }

  function speakText(text: string, source: SpeechSource, rate = speechRate) {
    if (!text || !("speechSynthesis" in window)) return;
    const runId = speechRunRef.current + 1;
    speechRunRef.current = runId;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = rate;
    utterance.onend = () => {
      if (speechRunRef.current === runId) setSpeechSource(null);
    };
    utterance.onerror = () => {
      if (speechRunRef.current === runId) setSpeechSource(null);
    };
    setSpeechSource(source);
    window.speechSynthesis.speak(utterance);
  }

  function speakSummary(rate = speechRate) {
    if (!selectedSummary?.listeningScript) return;
    speakText(selectedSummary.listeningScript, "summary", rate);
  }

  function speakFocus(rate = speechRate) {
    speakText(focusListeningScript, "focus", rate);
  }

  function speakReviewDue(rate = speechRate) {
    speakText(reviewDueListeningScript, "review_due", rate);
  }

  function changeSpeechRate(rate: number) {
    setSpeechRate(rate);
    if (speechSource) {
      const currentSource = speechSource;
      window.speechSynthesis?.cancel();
      window.setTimeout(() => {
        if (currentSource === "summary") speakSummary(rate);
        if (currentSource === "focus") speakFocus(rate);
        if (currentSource === "review_due") speakReviewDue(rate);
      }, 0);
    }
  }

  function stopSpeaking() {
    speechRunRef.current += 1;
    window.speechSynthesis?.cancel();
    setSpeechSource(null);
  }

  const statusLine = useMemo(() => {
    if (!today) return "加载中";
    return `今日 ${today.stats.recordings} 段录音 · ${today.stats.pending} 段待处理 · ${today.stats.organized} 张卡片`;
  }, [today]);
  const providerLabel = today?.provider === "mock" ? "本地测试模式" : today?.provider ?? "local";
  const workerOnline = worker?.workers.some((item) => Date.now() - new Date(item.lastHeartbeatAt).getTime() < 60_000) ?? false;
  const recordingPipelineHint = useMemo(() => {
    const queued = recordings.filter((item) => ["uploaded", "transcription_queued", "transcript_pending"].includes(item.status)).length;
    const transcribing = recordings.filter((item) => item.status === "transcribing").length;
    const organizing = recordings.filter((item) => ["transcribed", "organizing"].includes(item.status)).length;
    const failed = recordings.filter((item) => item.status === "failed").length;
    const suspect = recordings.filter((item) => ["no_content", "transcript_suspect"].includes(item.status)).length;

    if (transcribing || organizing) {
      const parts = [
        queued ? `等待 ${queued}` : "",
        transcribing ? `Mac 转写 ${transcribing}` : "",
        organizing ? `AI 整理 ${organizing}` : ""
      ].filter(Boolean);
      return {
        tone: "active" as StatusTone,
        text: `当前有 ${queued + transcribing + organizing} 段录音未完成：${parts.join(" · ")}。完成后卡片和总结会自动刷新。`,
        spinning: true
      };
    }

    if (queued) {
      return {
        tone: workerOnline ? "pending" as StatusTone : "warning" as StatusTone,
        text: workerOnline
          ? `还有 ${queued} 段等待 Mac 转写；排队期间可以继续录音。`
          : `还有 ${queued} 段等待 Mac 转写；Mac 离线时会先排队，恢复在线后自动处理。`,
        spinning: false
      };
    }

    if (failed || suspect) {
      const parts = [
        failed ? `失败 ${failed}` : "",
        suspect ? `异常或无有效内容 ${suspect}` : ""
      ].filter(Boolean);
      return {
        tone: failed ? "danger" as StatusTone : "warning" as StatusTone,
        text: `有 ${failed + suspect} 段录音需要确认：${parts.join(" · ")}。下方每条录音会说明下一步。`,
        spinning: false
      };
    }

    return null;
  }, [recordings, workerOnline]);
  const busyText =
    busy === "delete"
      ? "正在删除并重建总结"
      : busy === "retry-transcription"
        ? "正在重新排队转写"
        : busy
          ? "转写、整理并生成总结中"
          : recording
            ? "正在记录"
            : "准备就绪";

  if (!authChecked) {
    return <main className="app-shell"><div className="loading-card">加载中</div></main>;
  }

  if (authRequired && !authenticated) {
    return (
      <main className="app-shell login-shell">
        <form className="login-card" onSubmit={submitLogin}>
          <Mic size={34} />
          <h1>语音想法整理</h1>
          <p>输入访问密码后继续使用。</p>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="访问密码"
            autoFocus
          />
          <button disabled={busy !== null || !password.trim()} type="submit">
            {busy === "login" ? <Loader2 className="spin" size={17} /> : <Check size={17} />}
            登录
          </button>
          {error ? <span className="login-error">{error}</span> : null}
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <h1>语音想法整理</h1>
          <p>{statusLine}</p>
        </div>
        <div className="provider-pill">
          <Sparkles size={16} />
          {providerLabel}
        </div>
        {authRequired ? (
          <button className="icon-button" type="button" aria-label="退出登录" title="退出登录" onClick={() => signOut().catch((err) => setError(err.message))}>
            <LogOut size={17} />
          </button>
        ) : null}
      </section>

      {today?.provider === "mock" ? (
        <div className="notice-line">
          <AlertCircle size={18} />
          <span>当前未接入 DeepSeek，整理和总结只是本地测试效果；填入 API key 后才会启用真正 AI 提炼。</span>
        </div>
      ) : null}

      <section className="record-panel">
        <button
          className={`record-button ${recording ? "is-recording" : ""}`}
          onClick={() => (recording ? stopRecording() : startRecording().catch((err) => setError(err.message)))}
          disabled={busy !== null}
          aria-label={recording ? "停止记录" : "开始记录"}
        >
          {recording ? <Square size={38} fill="currentColor" /> : <Mic size={42} />}
          <span>{recording ? "停止记录" : "开始记录"}</span>
          <small>{recording ? formatSeconds(elapsed) : "一键录音"}</small>
        </button>

        <div className="record-state">
          {busy ? <Loader2 className="spin" size={18} /> : recording ? <Waves size={18} /> : <Check size={18} />}
          <span>{busyText}</span>
        </div>
      </section>

      {error ? (
        <div className="error-line">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="worker-panel">
        <div>
          <strong>Mac 转写节点</strong>
          <span>{workerOnline ? "在线" : "离线"} · 待转写 {worker?.queue.pending ?? 0} · 转写中 {worker?.queue.transcribing ?? 0}</span>
        </div>
        <small>{today?.sttMode === "remote-worker" ? "手机上传后由 Mac Whisper large-v3 转写" : "本机转写模式"}</small>
      </section>

      {recordingPipelineHint ? (
        <div className={`processing-hint ${recordingPipelineHint.tone}`}>
          {recordingPipelineHint.spinning ? <Loader2 className="spin" size={16} /> : <AlertCircle size={16} />}
          <span>{recordingPipelineHint.text}</span>
        </div>
      ) : null}

      <section className="search-panel">
        <div className="section-title">
          <Search size={18} />
          <h2>快速搜索</h2>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索历史想法、任务、知识"
          />
          {searchBusy ? <Loader2 className="spin" size={15} /> : null}
        </label>
        {searchQuery.trim() ? (
          <div className="search-results">
            {searchResults.length ? (
              searchResults.map((result) => (
                <button
                  type="button"
                  className="search-result"
                  key={result.id}
                  onClick={() => jumpToSearchResult(result.dayKey)}
                >
                  <span>
                    {result.dayKey} · {typeLabels[result.type] ?? result.type}
                  </span>
                  <strong>{result.title}</strong>
                  <small>{result.summary}</small>
                </button>
              ))
            ) : searchBusy ? (
              <div className="empty-card compact">搜索中</div>
            ) : (
              <div className="empty-card compact">没有找到匹配卡片</div>
            )}
          </div>
        ) : null}
      </section>

      <section className="day-board">
        <div className="section-title">
          <CalendarDays size={18} />
          <h2>日期看板</h2>
        </div>
        <div className="day-switcher" aria-label="日期切换" data-active-day={activeDay}>
          <button type="button" aria-label={`查看上一天 ${previousDay}`} title={`定位到 ${previousDay}`} onClick={() => navigateDay(-1)}>
            <ChevronLeft size={17} />
            <span>上一天</span>
          </button>
          <strong>{activeDayLabel}</strong>
          <button
            type="button"
            aria-label={`查看下一天 ${nextDay}`}
            title={canGoNextDay ? `定位到 ${nextDay}` : "已经是今天"}
            disabled={!canGoNextDay}
            onClick={() => navigateDay(1)}
          >
            <span>下一天</span>
            <ChevronRight size={17} />
          </button>
        </div>
        <div className="selected-day-strip" aria-live="polite">
          <span>
            {dayDataLoading ? <Loader2 className="spin" size={14} /> : <CalendarDays size={14} />}
            {dayDataLoading ? "正在加载这一天" : isSelectedToday ? "正在看今天" : "正在看历史日期"}
          </span>
          <button type="button" disabled={isSelectedToday} onClick={jumpToToday}>
            回到今天
          </button>
        </div>
        <div className="day-overview" aria-label="所选日期概览">
          <span>
            <strong>{selectedDaySnapshot.recordings}</strong>
            录音
          </span>
          <span className={selectedDaySnapshot.pending ? "warn" : ""}>
            <strong>{selectedDaySnapshot.pending}</strong>
            待处理
          </span>
          <span>
            <strong>{selectedDaySnapshot.cards}</strong>
            卡片
          </span>
          <span>
            <strong>{selectedDaySnapshot.summaryLabel}</strong>
            总结
          </span>
        </div>
        <div className="month-toolbar">
          <button type="button" onClick={() => setVisibleMonth((month) => shiftMonth(month || monthFromDay(todayDayKey), -1))}>
            上月
          </button>
          <strong>{monthLabel(visibleMonth || monthFromDay(todayDayKey))}</strong>
          <button type="button" onClick={() => setVisibleMonth((month) => shiftMonth(month || monthFromDay(todayDayKey), 1))}>
            下月
          </button>
        </div>
        <div className="calendar-grid calendar-weekdays">
          {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {calendarDays.map((day) => {
            const overview = overviewByDay.get(day.key);
            const isSelected = activeDay === day.key;
            const isToday = todayDayKey === day.key;
            const hasContent = Boolean(overview?.recordings || overview?.cards || overview?.hasSummary);
            const detail = [
              overview?.recordings ? `${overview.recordings}录` : "",
              overview?.pending ? `${overview.pending}待` : "",
              overview?.cards ? `${overview.cards}卡` : "",
              overview?.summaryVersion ? `v${overview.summaryVersion}` : ""
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                type="button"
                key={day.key}
                data-day-key={day.key}
                aria-label={`${day.key}${detail ? ` ${detail}` : ""}`}
                aria-pressed={isSelected}
                className={`calendar-day ${hasContent ? "has-content" : ""} ${isSelected ? "active" : ""} ${isToday ? "today" : ""}`}
                style={day.offset ? { gridColumnStart: day.offset + 1 } : undefined}
                onClick={() => selectDay(day.key, { scrollToContent: true })}
              >
                <span>{day.day}</span>
                <small>{detail}</small>
              </button>
            );
          })}
        </div>
      </section>

      <div className="day-content-anchor" ref={dayContentRef} aria-hidden="true" />

      <nav className="content-day-nav" aria-label="当前内容日期切换" data-active-day={activeDay}>
        <button type="button" aria-label={`查看上一天内容 ${previousDay}`} title={`定位到 ${previousDay}`} onClick={() => navigateDay(-1)}>
          <ChevronLeft size={18} />
          <span>上一天</span>
        </button>
        <div>
          <small>当前内容</small>
          <strong>{activeDayLabel}</strong>
        </div>
        <button
          type="button"
          aria-label={`查看下一天内容 ${nextDay}`}
          title={canGoNextDay ? `定位到 ${nextDay}` : "已经是今天"}
          disabled={!canGoNextDay}
          onClick={() => navigateDay(1)}
        >
          <span>下一天</span>
          <ChevronRight size={18} />
        </button>
      </nav>

      <section className="focus-panel">
        <div className="section-title">
          <ListChecks size={18} />
          <h2>{isSelectedToday ? "今日重点" : `${activeDay} 重点`}</h2>
        </div>
        <div className="focus-metrics">
          <div>
            <span>{cards.length}</span>
            <small>卡片</small>
          </div>
          <div>
            <span>{starredCards.length}</span>
            <small>重点</small>
          </div>
          <div>
            <span>{reviewDueCards.length}</span>
            <small>待复习</small>
          </div>
          <div>
            <span>{actionItems.length ? `${completedActionCount}/${actionItems.length}` : 0}</span>
            <small>行动项</small>
          </div>
          <div>
            <span>{reviewCards.length}</span>
            <small>待确认</small>
          </div>
        </div>
        <div className="focus-actions">
          <button
            className="focus-speech"
            type="button"
            disabled={!focusListeningScript || !("speechSynthesis" in window)}
            onClick={speechSource === "focus" ? stopSpeaking : () => speakFocus()}
          >
            <Volume2 size={16} />
            {speechSource === "focus" ? "停止朗读" : `朗读重点 ${speechRate}x`}
          </button>
          <button
            className="focus-speech review-due-speech"
            type="button"
            disabled={!reviewDueListeningScript || !("speechSynthesis" in window)}
            onClick={speechSource === "review_due" ? stopSpeaking : () => speakReviewDue()}
          >
            <Volume2 size={16} />
            {speechSource === "review_due" ? "停止待复习" : `朗读待复习 ${speechRate}x`}
          </button>
          <button
            className="copy-button"
            type="button"
            disabled={!focusExportMarkdown}
            onClick={() => copyText(focusExportMarkdown, "focus")}
          >
            {copiedSource === "focus" ? <Check size={16} /> : <Clipboard size={16} />}
            {copiedSource === "focus" ? "已复制" : "复制重点"}
          </button>
        </div>
        {reviewDueCards.length ? (
          <div className="focus-block review-due-focus">
            <div className="focus-block-head with-action">
              <strong>待复习</strong>
              <button
                type="button"
                onClick={() => {
                  setCardTypeFilter("review_due");
                  document.querySelector(".cards-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                查看全部
              </button>
            </div>
            <div className="review-due-list">
              {reviewDueCards.slice(0, 3).map((card) => (
                <article key={card.id} className="review-due-item">
                  <div>
                    <strong>{card.title}</strong>
                    <small>
                      {card.starred ? "重点 · " : ""}{typeLabels[card.type] ?? card.type}
                    </small>
                  </div>
                  <p>{card.summary}</p>
                </article>
              ))}
              {reviewDueCards.length > 3 ? <small className="more-count">还有 {reviewDueCards.length - 3} 张待复习卡片</small> : null}
            </div>
          </div>
        ) : null}
        {starredCards.length ? (
          <div className="focus-block starred-focus">
            <div className="focus-block-head with-action">
              <strong>已标重点</strong>
              <button
                type="button"
                onClick={() => {
                  setCardTypeFilter("starred");
                  document.querySelector(".cards-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                查看全部
              </button>
            </div>
            <div className="starred-card-list">
              {starredCards.slice(0, 3).map((card) => (
                <article key={card.id} className="starred-card-item">
                  <div>
                    <strong>{card.title}</strong>
                    <small>{typeLabels[card.type] ?? card.type} · {Math.round(card.confidence * 100)}%</small>
                  </div>
                  <p>{card.summary}</p>
                </article>
              ))}
              {starredCards.length > 3 ? <small className="more-count">还有 {starredCards.length - 3} 张重点卡片</small> : null}
            </div>
          </div>
        ) : null}
        <div className="focus-block">
          <div className="focus-block-head">
            <strong>行动项</strong>
            {actionItems.length ? (
              <div className="action-filter" aria-label="行动项筛选">
                {actionItemFilters.map((filter) => (
                  <button
                    type="button"
                    key={filter.key}
                    className={actionFilter === filter.key ? "active" : ""}
                    aria-pressed={actionFilter === filter.key}
                    onClick={() => setActionFilter(filter.key)}
                  >
                    {filter.label} {actionFilterCounts[filter.key]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {actionItems.length ? (
            <div className="action-list">
              {visibleActionItems.slice(0, 6).map((item) => (
                <label key={item.id} className={`action-item ${completedActions[item.id] ? "done" : ""}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(completedActions[item.id])}
                    onChange={() => toggleActionDone(item.id)}
                  />
                  <span>{item.action}</span>
                  <small>
                    {typeLabels[item.type] ?? item.type} · {item.title}
                  </small>
                </label>
              ))}
              {visibleActionItems.length > 6 ? <small className="more-count">还有 {visibleActionItems.length - 6} 个行动项</small> : null}
              {!visibleActionItems.length ? (
                <div className="empty-card compact">{actionFilter === "done" ? "暂无已完成行动项" : "没有未完成行动项"}</div>
              ) : null}
            </div>
          ) : (
            <div className="empty-card compact">暂无明确行动项</div>
          )}
        </div>
        {reviewCards.length ? (
          <div className="focus-block">
            <strong>待确认</strong>
            <div className="review-list">
              {reviewCards.slice(0, 3).map((card) => (
                <span key={card.id}>{card.title}</span>
              ))}
              {reviewCards.length > 3 ? <small className="more-count">还有 {reviewCards.length - 3} 个待确认</small> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="recordings-panel">
        <div className="section-title">
          <FileAudio size={18} />
          <h2>{isSelectedToday ? "今日录音" : `${activeDay} 录音`}</h2>
        </div>
        {recordings.length ? (
          <div className="recording-filter" aria-label="录音状态筛选">
            {recordingFilters.map((filter) => (
              <button
                type="button"
                key={filter.key}
                className={recordingFilter === filter.key ? "active" : ""}
                aria-pressed={recordingFilter === filter.key}
                onClick={() => setRecordingFilter(filter.key)}
              >
                {filter.label} {recordingFilterCounts[filter.key]}
              </button>
            ))}
          </div>
        ) : null}
        <div className="recording-list">
          {filteredRecordings.length ? (
            filteredRecordings.map((item) => {
              const tone = statusTone(item.status);
              return (
                <article className="recording-item" key={item.id}>
                  <div className="recording-info">
                    <div className="recording-title-row">
                      <span>{formatDateTime(item.createdAt)}</span>
                      <strong className={`recording-status ${tone}`}>{statusLabel(item.status)}</strong>
                    </div>
                    <small>
                      {item.duration === null ? "--:--" : formatSeconds(item.duration)} · {item.cardCount} 张卡片
                    </small>
                    <p>{statusHelp(item.status, workerOnline)}</p>
                    {item.error ? <em>{item.error}</em> : null}
                  </div>
                  <audio
                    controls
                    src={audioUrl(item.audioAssetId)}
                    onCanPlay={() => setAudioErrors((current) => ({ ...current, [item.id]: false }))}
                    onError={() => setAudioErrors((current) => ({ ...current, [item.id]: true }))}
                  />
                  {audioErrors[item.id] ? (
                    <div className="audio-warning">当前浏览器不能播放这段原始录音格式；转写和总结不受影响。</div>
                  ) : null}
                  <div className="recording-controls">
                    {item.hasTranscript ? (
                      <button
                        className="transcript-button"
                        type="button"
                        disabled={transcriptLoadingId === item.id}
                        onClick={() => toggleTranscript(item)}
                      >
                        {transcriptLoadingId === item.id ? <Loader2 className="spin" size={15} /> : <FileText size={15} />}
                        {openTranscriptId === item.id ? "收起转写" : "查看转写"}
                      </button>
                    ) : null}
                    {!item.hasTranscript && canEditTranscript(item) ? (
                      <button
                        className="transcript-button"
                        type="button"
                        disabled={busy !== null || transcriptLoadingId === item.id}
                        onClick={() => startEditingTranscript(item)}
                      >
                        <FileText size={15} />
                        补充转写
                      </button>
                    ) : null}
                    {canRetryTranscription(item, today?.sttMode) ? (
                      <button
                        className="retry-button"
                        type="button"
                        disabled={busy !== null}
                        onClick={() => runAction("retry-transcription", () => retryTranscription(item.id))}
                      >
                        <RefreshCw size={15} />
                        重新转写
                      </button>
                    ) : null}
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label="删除录音"
                      title="删除录音"
                      disabled={busy !== null}
                      onClick={() => removeRecording(item).catch((err) => setError(err.message))}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                  {openTranscriptId === item.id ? (
                    <div className="recording-transcript">
                      {transcriptLoadingId === item.id ? (
                        <div className="empty-card compact">正在读取转写</div>
                      ) : editingTranscriptId === item.id ? (
                        <div className="transcript-editor">
                          <textarea
                            value={transcriptDraft}
                            onChange={(event) => setTranscriptDraft(event.target.value)}
                            placeholder="粘贴或修正这段录音的转写文本，保存后会只整理这一条录音"
                          />
                          <div className="transcript-editor-actions">
                            <button
                              className="copy-button"
                              type="button"
                              disabled={busy !== null}
                              onClick={() => {
                                setEditingTranscriptId("");
                                setTranscriptDraft("");
                                if (!item.hasTranscript) setOpenTranscriptId("");
                              }}
                            >
                              取消
                            </button>
                            <button
                              className="speech-main"
                              type="button"
                              disabled={busy !== null || !transcriptDraft.trim()}
                              onClick={() => saveTranscriptEdit(item)}
                            >
                              {busy === "transcript" ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
                              保存并整理
                            </button>
                          </div>
                        </div>
                      ) : transcripts[item.id] ? (
                        <>
                          <div className="transcript-meta">
                            <span>{transcriptStatusLabel(transcripts[item.id].status)}</span>
                            <span>{transcripts[item.id].language || "未知语言"}</span>
                            {canEditTranscript(item) ? (
                              <button
                                className="transcript-edit-button"
                                type="button"
                                disabled={busy !== null}
                                onClick={() => startEditingTranscript(item)}
                              >
                                修正转写
                              </button>
                            ) : null}
                            <button
                              className="copy-button"
                              type="button"
                              onClick={() => copyText(transcripts[item.id].rawText, `transcript:${item.id}`)}
                            >
                              {copiedSource === `transcript:${item.id}` ? <Check size={15} /> : <Clipboard size={15} />}
                              {copiedSource === `transcript:${item.id}` ? "已复制" : "复制转写"}
                            </button>
                          </div>
                          <pre>{transcripts[item.id].rawText}</pre>
                        </>
                      ) : (
                        <div className="empty-card compact">暂无转写文本</div>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : recordings.length ? (
            <div className="empty-card">当前筛选下没有录音</div>
          ) : (
            <div className="empty-card">暂无录音</div>
          )}
        </div>
      </section>

      <section className="summary-panel">
        <div className="section-title">
          <CalendarDays size={18} />
          <h2>周期总结</h2>
        </div>
        <div className="period-tabs" role="tablist">
          {(Object.keys(periodLabels) as Period[]).map((period) => (
            <button
              key={period}
              className={selectedPeriod === period ? "active" : ""}
              onClick={() => setSelectedPeriod(period)}
            >
              {periodLabels[period]}
            </button>
          ))}
        </div>

        <div className="summary-card">
          <div className="summary-meta">
            <span>{selectedKey || "暂无周期"}</span>
            <span>{selectedSummary ? `v${selectedSummary.version}` : "未生成"}</span>
          </div>
          {selectedSummary?.audioAssetId ? (
            <audio controls src={audioUrl(selectedSummary.audioAssetId)} />
          ) : (
            <div className="empty-audio">
              <FileAudio size={18} />
              <span>暂无复习音频</span>
            </div>
          )}
          <div className="speech-actions">
            <div className="speech-rate" aria-label="朗读倍速">
              {speechRates.map((rate) => (
                <button
                  type="button"
                  key={rate}
                  className={speechRate === rate ? "active" : ""}
                  aria-pressed={speechRate === rate}
                  onClick={() => changeSpeechRate(rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>
            <button
              className="speech-main"
              disabled={!selectedSummary?.listeningScript || !("speechSynthesis" in window)}
              onClick={speechSource === "summary" ? stopSpeaking : () => speakSummary()}
            >
              <Volume2 size={16} />
              {speechSource === "summary" ? "停止朗读" : `朗读总结 ${speechRate}x`}
            </button>
            <button
              className="copy-button"
              type="button"
              disabled={!summaryMarkdown.trim()}
              onClick={() => copyText(summaryMarkdown, "summary")}
            >
              {copiedSource === "summary" ? <Check size={16} /> : <Clipboard size={16} />}
              {copiedSource === "summary" ? "已复制" : "复制总结"}
            </button>
          </div>
          <pre className="summary-markdown">{summaryMarkdown || "暂无总结内容"}</pre>
        </div>
      </section>

      <section className="actions-panel">
        <button onClick={() => runAction("organize", organizeNew)} disabled={busy !== null}>
          <RefreshCw size={16} />
          整理新内容
        </button>
        <button
          onClick={() => runAction("summary", () => regenerateSummary(selectedPeriod, selectedKey))}
          disabled={busy !== null || !selectedKey}
        >
          <Clock size={16} />
          重新生成总结
        </button>
        <button
          onClick={() => runAction("deep", () => deepReorganize(selectedPeriod, selectedKey))}
          disabled={busy !== null || !selectedKey}
        >
          <RotateCcw size={16} />
          深度重新整理
        </button>
      </section>

      <section className="transcript-panel">
        <textarea
          value={manualTranscript}
          onChange={(event) => setManualTranscript(event.target.value)}
          placeholder="可选：没有本地 Whisper 时，在这里粘贴转写文本"
        />
        <button
          disabled={!lastRecordingId || !manualTranscript.trim() || busy !== null}
          onClick={() =>
            runAction("transcript", async () => {
              await attachTranscript(lastRecordingId, manualTranscript);
              await finishLatest();
              setManualTranscript("");
            })
          }
        >
          <FileAudio size={16} />
          补充最近录音转写
        </button>
      </section>

      <section className="cards-panel">
        <div className="section-title">
          <Sparkles size={18} />
          <h2>{isSelectedToday ? "今日卡片" : `${activeDay} 卡片`}</h2>
        </div>
        {cards.length ? (
          <div className="card-filter" aria-label="卡片分类筛选">
            <button
              type="button"
              className={cardTypeFilter === "all" ? "active" : ""}
              aria-pressed={cardTypeFilter === "all"}
              onClick={() => setCardTypeFilter("all")}
            >
              全部 {cards.length}
            </button>
            {starredCardCount || cardTypeFilter === "starred" ? (
              <button
                type="button"
                className={cardTypeFilter === "starred" ? "active starred-filter" : "starred-filter"}
                aria-pressed={cardTypeFilter === "starred"}
                onClick={() => setCardTypeFilter("starred")}
              >
                重点 {starredCardCount}
              </button>
            ) : null}
            {reviewDueCards.length || cardTypeFilter === "review_due" ? (
              <button
                type="button"
                className={cardTypeFilter === "review_due" ? "active review-filter" : "review-filter"}
                aria-pressed={cardTypeFilter === "review_due"}
                onClick={() => setCardTypeFilter("review_due")}
              >
                待复习 {reviewDueCards.length}
              </button>
            ) : null}
            {reviewedCardCount || cardTypeFilter === "reviewed" ? (
              <button
                type="button"
                className={cardTypeFilter === "reviewed" ? "active reviewed-filter" : "reviewed-filter"}
                aria-pressed={cardTypeFilter === "reviewed"}
                onClick={() => setCardTypeFilter("reviewed")}
              >
                已复习 {reviewedCardCount}
              </button>
            ) : null}
            {visibleCardTypes.map((type) => (
              <button
                type="button"
                key={type}
                className={cardTypeFilter === type ? "active" : ""}
                aria-pressed={cardTypeFilter === type}
                onClick={() => setCardTypeFilter(type)}
              >
                {typeLabels[type] ?? type} {cardTypeCounts.get(type)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="card-list">
          {filteredCards.length ? (
            filteredCards.map((card) => (
              <ThoughtCardItem
                key={card.id}
                card={card}
                copied={copiedSource === `card:${card.id}`}
                sourceCopied={copiedSource === `card-source:${card.id}`}
                onCopy={() => copyText(cardMarkdown(card, completedActions), `card:${card.id}`)}
                onCopySource={() => {
                  const transcript = transcripts[card.sourceRecordingId];
                  if (transcript) copyText(cardSourceMarkdown(card, transcript), `card-source:${card.id}`);
                }}
                isEditing={editingCardId === card.id}
                draft={cardDraft}
                busy={busy}
                sourceOpen={openCardSourceId === card.id}
                sourceLoading={cardSourceLoadingId === card.id}
                sourceTranscript={transcripts[card.sourceRecordingId] ?? null}
                onStartEdit={() => startEditingCard(card)}
                onDraftChange={setCardDraft}
                onCancelEdit={() => setEditingCardId("")}
                onSaveEdit={() => saveCardEdit(card)}
                onDelete={() => removeCard(card)}
                onToggleStar={() => toggleCardStar(card)}
                onToggleReviewed={() => toggleCardReviewed(card)}
                onToggleSource={() => toggleCardSource(card)}
              />
            ))
          ) : (
            <div className="empty-card">{cards.length ? "当前分类暂无卡片" : "暂无卡片"}</div>
          )}
        </div>
      </section>
    </main>
  );
}

function ThoughtCardItem({
  card,
  copied,
  sourceCopied,
  onCopy,
  onCopySource,
  isEditing,
  draft,
  busy,
  sourceOpen,
  sourceLoading,
  sourceTranscript,
  onStartEdit,
  onDraftChange,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onToggleStar,
  onToggleReviewed,
  onToggleSource
}: {
  card: ThoughtCard;
  copied: boolean;
  sourceCopied: boolean;
  onCopy: () => void;
  onCopySource: () => void;
  isEditing: boolean;
  draft: CardDraft;
  busy: string | null;
  sourceOpen: boolean;
  sourceLoading: boolean;
  sourceTranscript: RecordingTranscript | null;
  onStartEdit: () => void;
  onDraftChange: (draft: CardDraft) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onToggleStar: () => void;
  onToggleReviewed: () => void;
  onToggleSource: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const updateDraft = (patch: Partial<CardDraft>) => onDraftChange({ ...draft, ...patch });

  if (isEditing) {
    return (
      <article className="thought-card card-editing">
        <div className="card-head">
          <span>编辑卡片</span>
          <small>人工确认</small>
        </div>
        <div className="card-editor">
          <label>
            <span>分类</span>
            <select value={draft.type} onChange={(event) => updateDraft({ type: event.target.value })}>
              {cardTypeOrder.map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type] ?? type}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>标题</span>
            <input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} />
          </label>
          <label>
            <span>摘要</span>
            <textarea value={draft.summary} onChange={(event) => updateDraft({ summary: event.target.value })} />
          </label>
          <label>
            <span>关键点（一行一条）</span>
            <textarea value={draft.keyPoints} onChange={(event) => updateDraft({ keyPoints: event.target.value })} />
          </label>
          <label>
            <span>行动项（一行一条）</span>
            <textarea value={draft.actions} onChange={(event) => updateDraft({ actions: event.target.value })} />
          </label>
          <label>
            <span>标签（一行或逗号分隔）</span>
            <textarea value={draft.tags} onChange={(event) => updateDraft({ tags: event.target.value })} />
          </label>
        </div>
        <div className="card-editor-actions">
          <button type="button" className="card-toggle" disabled={busy !== null} onClick={onCancelEdit}>
            取消
          </button>
          <button type="button" className="copy-button primary" disabled={busy !== null} onClick={onSaveEdit}>
            {busy === "card-edit" ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
            保存卡片
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="thought-card">
      <div className="card-head">
        <span>{typeLabels[card.type] ?? card.type}</span>
        <small>{card.reviewed ? "已复习 · " : ""}{card.starred ? "重点 · " : ""}{Math.round(card.confidence * 100)}%</small>
      </div>
      <h3>{card.title}</h3>
      <p>{card.summary}</p>
      {card.actions.length ? (
        <div className="mini-list">
          {card.actions.slice(0, 3).map((action) => (
            <span key={action}>{action}</span>
          ))}
        </div>
      ) : null}
      {expanded ? (
        <div className="card-details">
          <div>
            <strong>关键点</strong>
            <div className="detail-list">
              {card.keyPoints.length ? card.keyPoints.map((point) => <span key={point}>{point}</span>) : <span>暂无关键点</span>}
            </div>
          </div>
          <div>
            <strong>行动项</strong>
            <div className="detail-list">
              {card.actions.length ? card.actions.map((action) => <span key={action}>{action}</span>) : <span>暂无行动项</span>}
            </div>
          </div>
        </div>
      ) : null}
      <div className="tags">
        {card.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      {sourceOpen ? (
        <div className="card-source">
          <div className="card-source-head">
            <strong>来源转写</strong>
            {sourceTranscript ? (
              <button type="button" className="copy-button compact" onClick={onCopySource}>
                {sourceCopied ? <Check size={15} /> : <Clipboard size={15} />}
                {sourceCopied ? "已复制" : "复制来源"}
              </button>
            ) : null}
          </div>
          <div className="source-meta">
            <span>录音 {card.sourceRecordingId}</span>
            <span>片段 {card.sourceTextRange}</span>
          </div>
          {sourceLoading ? (
            <div className="source-loading">
              <Loader2 className="spin" size={15} />
              正在读取来源转写
            </div>
          ) : sourceTranscript ? (
            <pre>{sourceTranscript.rawText}</pre>
          ) : (
            <div className="source-loading">暂无来源转写</div>
          )}
        </div>
      ) : null}
      <div className="card-actions">
        <button type="button" className={`card-toggle ${expanded ? "expanded" : ""}`} onClick={() => setExpanded((current) => !current)}>
          <ChevronRight size={16} />
          {expanded ? "收起" : "展开"}
        </button>
        <button type="button" className={`card-toggle ${sourceOpen ? "active" : ""}`} disabled={busy !== null} onClick={onToggleSource}>
          {sourceLoading ? <Loader2 className="spin" size={16} /> : <FileText size={16} />}
          {sourceOpen ? "收起来源" : "来源"}
        </button>
        <button type="button" className={`card-toggle ${card.starred ? "starred" : ""}`} disabled={busy !== null} onClick={onToggleStar}>
          <Star size={16} fill={card.starred ? "currentColor" : "none"} />
          {card.starred ? "已重点" : "重点"}
        </button>
        <button type="button" className={`card-toggle ${card.reviewed ? "reviewed" : ""}`} disabled={busy !== null} onClick={onToggleReviewed}>
          <CheckCircle size={16} fill={card.reviewed ? "currentColor" : "none"} />
          {card.reviewed ? "已复习" : "待复习"}
        </button>
        <button type="button" className="card-toggle" disabled={busy !== null} onClick={onStartEdit}>
          <Pencil size={16} />
          编辑
        </button>
        <button type="button" className="card-toggle danger" disabled={busy !== null} onClick={onDelete}>
          {busy === "card-delete" ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
          删除
        </button>
        <button type="button" className="copy-button" onClick={onCopy}>
          {copied ? <Check size={16} /> : <Clipboard size={16} />}
          {copied ? "已复制" : "复制卡片"}
        </button>
      </div>
    </article>
  );
}
