import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { dataPaths, relativeDataPath } from "../paths";

export interface TTSResult {
  path: string;
  mimeType: string;
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

export class TTSProvider {
  async synthesize(text: string, basename = nanoid()): Promise<TTSResult | null> {
    const hasSay = await commandExists("say");
    if (!hasSay || !text.trim()) return null;

    const textPath = path.join(dataPaths.tmp, `${basename}.txt`);
    const aiffPath = path.join(dataPaths.reviewAudio, `${basename}.aiff`);
    const mp3Path = path.join(dataPaths.reviewAudio, `${basename}.mp3`);
    await fs.writeFile(textPath, text, "utf8");
    await run("say", ["-o", aiffPath, "-f", textPath]);

    if (await commandExists("ffmpeg")) {
      await run("ffmpeg", ["-y", "-i", aiffPath, "-codec:a", "libmp3lame", "-q:a", "4", mp3Path]);
      await fs.rm(aiffPath, { force: true });
      return { path: relativeDataPath(mp3Path), mimeType: "audio/mpeg" };
    }

    return { path: relativeDataPath(aiffPath), mimeType: "audio/aiff" };
  }
}
