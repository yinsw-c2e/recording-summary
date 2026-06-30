import "dotenv/config";
import path from "node:path";
import process from "node:process";

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  port: Number(env("PORT", "8787")),
  clientOrigin: env("CLIENT_ORIGIN", "http://localhost:5173"),
  publicBaseUrl: env("PUBLIC_BASE_URL", "http://localhost:8787"),
  dataDir: path.resolve(env("DATA_DIR", "./data")),
  timeZone: env("TIME_ZONE", "Asia/Shanghai"),
  appPassword: env("APP_PASSWORD"),
  sessionSecret: env("SESSION_SECRET", env("APP_PASSWORD") ? "" : "dev-session-secret"),
  workerToken: env("WORKER_TOKEN"),
  sttMode: env("STT_MODE", "local"),
  llmProvider: env("LLM_PROVIDER", env("DEEPSEEK_API_KEY") ? "deepseek" : "mock"),
  deepseek: {
    apiKey: env("DEEPSEEK_API_KEY"),
    baseUrl: env("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
    model: env("DEEPSEEK_MODEL", "deepseek-v4-flash"),
    proModel: env("DEEPSEEK_PRO_MODEL", "deepseek-v4-pro")
  },
  whisperBin: env("WHISPER_BIN", "whisper"),
  whisperModel: env("WHISPER_MODEL", "base"),
  whisperModelDir: path.resolve(env("WHISPER_MODEL_DIR", "./data/whisper_models")),
  workerId: env("WORKER_ID", "mac-whisper-worker"),
  workerServerUrl: env("WORKER_SERVER_URL", env("PUBLIC_BASE_URL", "http://localhost:8787")),
  workerPollMs: Number(env("WORKER_POLL_MS", "5000")),
  workerTempDir: path.resolve(env("WORKER_TEMP_DIR", "./data/worker_tmp")),
  ttsProvider: env("TTS_PROVIDER", "macos-say")
};

export type AppConfig = typeof config;
