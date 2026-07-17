import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Trash2,
  FileAudio,
  ListChecks,
  Loader2,
  LogOut,
  Mic,
  Volume2,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Waves
} from "lucide-react";
import {
  attachTranscript,
  audioUrl,
  deepReorganize,
  deleteRecording,
  finishLatest,
  getAuthStatus,
  getDayDashboard,
  getMonthOverview,
  getSummaryMarkdown,
  getToday,
  login,
  logout,
  organizeNew,
  regenerateSummary,
  searchCards,
  uploadRecording,
  type Period,
  type CardSearchResult,
  type MonthDayOverview,
  type RecordingListItem,
  type SummaryArtifact,
  type ThoughtCard,
  type TodayResponse
} from "./api";

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

const cardTypeOrder = ["task", "project_idea", "raw_idea", "knowledge", "question", "reflection", "daily_note", "uncertain"];
const recordingMimeCandidates = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
  "audio/webm;codecs=opus",
  "audio/webm"
];

const processingStatuses = new Set(["transcription_queued", "transcribing", "transcript_pending", "transcribed", "organizing"]);
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
  const [speaking, setSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(1.5);
  const [audioErrors, setAudioErrors] = useState<Record<string, boolean>>({});
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const [selectedDayData, setSelectedDayData] = useState<TodayResponse | null>(null);
  const [visibleMonth, setVisibleMonth] = useState("");
  const [monthOverview, setMonthOverview] = useState<MonthDayOverview[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CardSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [cardTypeFilter, setCardTypeFilter] = useState("all");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const dayContentRef = useRef<HTMLDivElement | null>(null);

  const activeData = selectedDayData ?? today;
  const selectedSummary: SummaryArtifact | null = activeData?.summaries[selectedPeriod] ?? null;
  const selectedKey = activeData?.keys[selectedPeriod] ?? "";
  const cards = activeData?.stats.cards ?? [];
  const recordings = activeData?.recordings ?? [];
  const worker = today?.worker;
  const todayDayKey = today?.keys.day ?? todayKey();
  const overviewByDay = useMemo(() => new Map(monthOverview.map((item) => [item.dayKey, item])), [monthOverview]);
  const calendarDays = useMemo(() => daysForMonth(visibleMonth || monthFromDay(todayDayKey)), [visibleMonth, todayDayKey]);
  const actionItems = useMemo(
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
    () => (cardTypeFilter === "all" ? cards : cards.filter((card) => card.type === cardTypeFilter)),
    [cards, cardTypeFilter]
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
    if (options.scrollToContent) scrollToDayContent();
  }

  function navigateDay(delta: number) {
    selectDay(shiftDayKey(selectedDayKey || todayDayKey, delta), { scrollToContent: true });
  }

  function jumpToSearchResult(day: string) {
    selectDay(day);
    window.setTimeout(() => {
      document.querySelector(".cards-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
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
    setSpeaking(false);
    setAuthenticated(false);
    setToday(null);
    setSelectedDayData(null);
    setSelectedDayKey("");
    setVisibleMonth("");
    setMonthOverview([]);
    setSearchQuery("");
    setSearchResults([]);
    setSearchBusy(false);
    setCardTypeFilter("all");
  }

  function speakSummary(rate = speechRate) {
    if (!selectedSummary?.listeningScript || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(selectedSummary.listeningScript);
    utterance.lang = "zh-CN";
    utterance.rate = rate;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  function changeSpeechRate(rate: number) {
    setSpeechRate(rate);
    if (speaking) {
      window.speechSynthesis?.cancel();
      window.setTimeout(() => speakSummary(rate), 0);
    }
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }

  const statusLine = useMemo(() => {
    if (!today) return "加载中";
    return `今日 ${today.stats.recordings} 段录音 · ${today.stats.pending} 段待处理 · ${today.stats.organized} 张卡片`;
  }, [today]);
  const providerLabel = today?.provider === "mock" ? "本地测试模式" : today?.provider ?? "local";
  const workerOnline = worker?.workers.some((item) => Date.now() - new Date(item.lastHeartbeatAt).getTime() < 60_000) ?? false;
  const busyText =
    busy === "delete"
      ? "正在删除并重建总结"
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
        <div className="day-switcher" aria-label="日期切换">
          <button type="button" aria-label="上一天" onClick={() => navigateDay(-1)}>
            <ChevronLeft size={17} />
            <span>上一天</span>
          </button>
          <strong>{selectedDayKey || todayDayKey}</strong>
          <button type="button" aria-label="下一天" onClick={() => navigateDay(1)}>
            <span>下一天</span>
            <ChevronRight size={17} />
          </button>
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
            const isSelected = selectedDayKey === day.key;
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

      <section className="focus-panel">
        <div className="section-title">
          <ListChecks size={18} />
          <h2>{selectedDayKey === todayDayKey ? "今日重点" : `${selectedDayKey} 重点`}</h2>
        </div>
        <div className="focus-metrics">
          <div>
            <span>{cards.length}</span>
            <small>卡片</small>
          </div>
          <div>
            <span>{actionItems.length}</span>
            <small>行动项</small>
          </div>
          <div>
            <span>{reviewCards.length}</span>
            <small>待确认</small>
          </div>
        </div>
        <div className="focus-block">
          <strong>行动项</strong>
          {actionItems.length ? (
            <div className="action-list">
              {actionItems.slice(0, 6).map((item) => (
                <div key={item.id} className="action-item">
                  <span>{item.action}</span>
                  <small>
                    {typeLabels[item.type] ?? item.type} · {item.title}
                  </small>
                </div>
              ))}
              {actionItems.length > 6 ? <small className="more-count">还有 {actionItems.length - 6} 个行动项</small> : null}
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
          <h2>{selectedDayKey === todayDayKey ? "今日录音" : `${selectedDayKey} 录音`}</h2>
        </div>
        <div className="recording-list">
          {recordings.length ? (
            recordings.map((item) => (
              <article className="recording-item" key={item.id}>
                <div className="recording-info">
                  <span>{formatDateTime(item.createdAt)}</span>
                  <small>
                    {statusLabel(item.status)} · {item.duration === null ? "--:--" : formatSeconds(item.duration)} · {item.cardCount} 张卡片
                  </small>
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
              </article>
            ))
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
              onClick={speaking ? stopSpeaking : () => speakSummary()}
            >
              <Volume2 size={16} />
              {speaking ? "停止朗读" : `朗读总结 ${speechRate}x`}
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
          <h2>{selectedDayKey === todayDayKey ? "今日卡片" : `${selectedDayKey} 卡片`}</h2>
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
            filteredCards.map((card) => <ThoughtCardItem key={card.id} card={card} />)
          ) : (
            <div className="empty-card">{cards.length ? "当前分类暂无卡片" : "暂无卡片"}</div>
          )}
        </div>
      </section>
    </main>
  );
}

function ThoughtCardItem({ card }: { card: ThoughtCard }) {
  return (
    <article className="thought-card">
      <div className="card-head">
        <span>{typeLabels[card.type] ?? card.type}</span>
        <small>{Math.round(card.confidence * 100)}%</small>
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
      <div className="tags">
        {card.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    </article>
  );
}
