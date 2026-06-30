import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { config } from "./config";

const whisperPrompt = "以下是普通话中文口语录音。";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function api<T>(route: string, init: RequestInit = {}): Promise<T> {
  if (!config.workerToken) throw new Error("WORKER_TOKEN is required for the Mac worker.");
  const response = await fetch(new URL(route, config.workerServerUrl), {
    ...init,
    headers: {
      authorization: `Bearer ${config.workerToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(payload.error || response.statusText);
  }
  return response.json() as Promise<T>;
}

async function heartbeat(status: "online" | "offline" | "transcribing", currentJobId: string | null = null, error: string | null = null): Promise<void> {
  await api("/api/worker/heartbeat", {
    method: "POST",
    body: JSON.stringify({ workerId: config.workerId, status, currentJobId, error })
  });
}

async function downloadAudio(audioUrl: string, targetPath: string): Promise<void> {
  if (!config.workerToken) throw new Error("WORKER_TOKEN is required for the Mac worker.");
  const response = await fetch(new URL(audioUrl, config.workerServerUrl), {
    headers: { authorization: `Bearer ${config.workerToken}` }
  });
  if (!response.ok) throw new Error(`audio download failed: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetPath, buffer);
}

async function prepareAudio(inputPath: string, workDir: string): Promise<string> {
  if (!(await commandExists("ffmpeg"))) return inputPath;
  const wavPath = path.join(workDir, "normalized.wav");
  await run("ffmpeg", ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", "-vn", wavPath]);
  return wavPath;
}

async function transcribe(audioPath: string, outputDir: string): Promise<string> {
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
  const outputPath = path.join(outputDir, `${path.basename(audioPath, path.extname(audioPath))}.txt`);
  return (await fs.readFile(outputPath, "utf8")).trim();
}

async function processOne(): Promise<boolean> {
  const claimed = await api<{
    job: null | { id: string };
    recording?: { id: string; audioUrl: string; mimeType: string };
  }>("/api/worker/claim", {
    method: "POST",
    body: JSON.stringify({ workerId: config.workerId })
  });
  if (!claimed.job || !claimed.recording) return false;

  const jobId = claimed.job.id;
  const workDir = path.join(config.workerTempDir, `${jobId}-${nanoid(6)}`);
  await fs.mkdir(workDir, { recursive: true });
  await heartbeat("transcribing", jobId);

  try {
    await api(`/api/worker/jobs/${jobId}/start`, {
      method: "POST",
      body: JSON.stringify({ workerId: config.workerId })
    });
    const ext = claimed.recording.mimeType.includes("mp4") ? ".m4a" : ".webm";
    const rawAudio = path.join(workDir, `audio${ext}`);
    await downloadAudio(claimed.recording.audioUrl, rawAudio);
    const normalizedAudio = await prepareAudio(rawAudio, workDir);
    const text = await transcribe(normalizedAudio, workDir);
    await api(`/api/worker/jobs/${jobId}/complete`, {
      method: "POST",
      body: JSON.stringify({ workerId: config.workerId, text, language: "zh" })
    });
    await heartbeat("online");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await api(`/api/worker/jobs/${jobId}/fail`, {
      method: "POST",
      body: JSON.stringify({ workerId: config.workerId, error: message })
    }).catch(() => undefined);
    await heartbeat("online", null, message).catch(() => undefined);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return true;
}

async function main(): Promise<void> {
  await fs.mkdir(config.workerTempDir, { recursive: true });
  process.on("SIGTERM", () => {
    heartbeat("offline").finally(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    heartbeat("offline").finally(() => process.exit(0));
  });

  await heartbeat("online");
  for (;;) {
    const worked = await processOne().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await heartbeat("online", null, message).catch(() => undefined);
      return false;
    });
    if (!worked) await sleep(config.workerPollMs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

