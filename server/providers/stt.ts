import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { Converter } from "opencc-js";
import { config } from "../config";
import { dataPaths, relativeDataPath } from "../paths";

export interface STTResult {
  text: string;
  language: string;
  path: string;
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("which", [command]);
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

const traditionalToSimplified = Converter({ from: "tw", to: "cn" });
const whisperPrompt = "以下是普通话中文口语录音。";

function normalizeTranscript(text: string): string {
  return traditionalToSimplified(text)
    .replace(/\s+/g, " ")
    .replace(/\s+([，。！？；：])/g, "$1")
    .trim();
}

function isLikelyPromptEcho(text: string): boolean {
  const compact = text.replace(/[^\p{Letter}\p{Number}]/gu, "");
  if (!compact) return true;
  return (
    compact.includes("普通话中文口语录音") ||
    compact.includes("避免繁体字") ||
    compact.includes("保留真实含义") ||
    compact === "语录音"
  );
}

export class STTProvider {
  async transcribe(audioPath: string, manualTranscript?: string): Promise<STTResult | null> {
    const cleanText = manualTranscript ? normalizeTranscript(manualTranscript) : "";
    const transcriptPath = path.join(dataPaths.rawTranscript, `${nanoid()}.txt`);
    if (cleanText) {
      await fs.writeFile(transcriptPath, cleanText, "utf8");
      return { text: cleanText, language: "zh", path: relativeDataPath(transcriptPath) };
    }

    const hasWhisper = await commandExists(config.whisperBin);
    if (!hasWhisper) return null;

    const outputDir = path.join(dataPaths.tmp, `whisper-${nanoid()}`);
    await fs.mkdir(outputDir, { recursive: true });
    await run(config.whisperBin, [
      audioPath,
      "--language",
      "zh",
      "--model",
      config.whisperModel,
      "--model_dir",
      config.whisperModelDir,
      "--output_format",
      "txt",
      "--initial_prompt",
      whisperPrompt,
      "--output_dir",
      outputDir
    ]);
    const baseName = path.basename(audioPath, path.extname(audioPath));
    const outputPath = path.join(outputDir, `${baseName}.txt`);
    const text = normalizeTranscript(await fs.readFile(outputPath, "utf8"));
    if (isLikelyPromptEcho(text)) return null;
    await fs.writeFile(transcriptPath, text, "utf8");
    return { text, language: "zh", path: relativeDataPath(transcriptPath) };
  }
}
