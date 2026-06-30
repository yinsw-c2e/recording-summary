import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

export const dataPaths = {
  root: config.dataDir,
  db: path.join(config.dataDir, "recording-summary.sqlite"),
  rawAudio: path.join(config.dataDir, "raw_audio"),
  rawTranscript: path.join(config.dataDir, "raw_transcript"),
  cards: path.join(config.dataDir, "cards"),
  summaries: path.join(config.dataDir, "summaries"),
  reviewAudio: path.join(config.dataDir, "review_audio"),
  tmp: path.join(config.dataDir, "tmp")
};

export function ensureDataDirs(): void {
  Object.values(dataPaths).forEach((target) => {
    if (target.endsWith(".sqlite")) return;
    fs.mkdirSync(target, { recursive: true });
  });
}

export function safeExt(filename: string | undefined, fallback = ".webm"): string {
  const ext = filename ? path.extname(filename).toLowerCase() : "";
  if (!ext || ext.length > 12 || /[^a-z0-9.]/.test(ext)) return fallback;
  return ext;
}

export function relativeDataPath(absPath: string): string {
  return path.relative(config.dataDir, absPath);
}

export function absoluteDataPath(storedPath: string): string {
  return path.isAbsolute(storedPath) ? storedPath : path.join(config.dataDir, storedPath);
}
