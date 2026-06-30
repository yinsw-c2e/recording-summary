import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  Clock,
  Trash2,
  FileAudio,
  Loader2,
  LogOut,
  Mic,
  Volume2,
  RefreshCw,
  RotateCcw,
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
  getSummaryMarkdown,
  getToday,
  login,
  logout,
  organizeNew,
  regenerateSummary,
  uploadRecording,
  type Period,
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

const recordingMimeCandidates = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
  "audio/webm;codecs=opus",
  "audio/webm"
];

const processingStatuses = new Set(["transcription_queued", "transcribing", "transcript_pending", "transcribed", "organizing"]);

function preferredRecordingMimeType(): string {
  return recordingMimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
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
  const [audioErrors, setAudioErrors] = useState<Record<string, boolean>>({});
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);

  const selectedSummary: SummaryArtifact | null = today?.summaries[selectedPeriod] ?? null;
  const selectedKey = today?.keys[selectedPeriod] ?? "";
  const cards = today?.stats.cards ?? [];
  const recordings = today?.recordings ?? [];
  const worker = today?.worker;

  async function refresh() {
    try {
      const next = await getToday();
      setToday(next);
      setAuthenticated(true);
    } catch (err) {
      if (err instanceof Error && err.message.includes("authentication required")) {
        setAuthenticated(false);
        return;
      }
      throw err;
    }
  }

  useEffect(() => {
    getAuthStatus()
      .then(async (status) => {
        setAuthRequired(status.authRequired);
        setAuthenticated(status.authenticated);
        setAuthChecked(true);
        if (status.authenticated) await refresh();
      })
      .catch((err) => {
        setAuthChecked(true);
        setError(err.message);
      });
  }, []);

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
      refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, recordings]);

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
        if (["transcription_queued", "transcribing", "transcript_pending"].includes(result.recording.status)) {
          await refresh();
          return;
        }
        await finishLatest();
        if (manualTranscript.trim()) {
          setManualTranscript("");
        }
        await refresh();
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
      await refresh();
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
  }

  function speakSummary() {
    if (!selectedSummary?.listeningScript || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(selectedSummary.listeningScript);
    utterance.lang = "zh-CN";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
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

      <section className="recordings-panel">
        <div className="section-title">
          <FileAudio size={18} />
          <h2>今日录音</h2>
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
            <button disabled={!selectedSummary?.listeningScript || !("speechSynthesis" in window)} onClick={speaking ? stopSpeaking : speakSummary}>
              <Volume2 size={16} />
              {speaking ? "停止朗读" : "朗读总结"}
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
          <h2>今日卡片</h2>
        </div>
        <div className="card-list">
          {cards.length ? cards.map((card) => <ThoughtCardItem key={card.id} card={card} />) : <div className="empty-card">暂无卡片</div>}
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
