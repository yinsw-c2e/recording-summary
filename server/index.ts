import { config } from "./config";
import { openDb } from "./db";
import { buildServer } from "./api";
import { createLLMProvider } from "./providers";
import { TTSProvider } from "./providers/tts";
import { organizeNew, regenerateSummary } from "./workflows";
import { dayKey, monthKey, weekKey } from "./time";

const handle = openDb();
const app = buildServer(handle);

let busy = false;

async function runScheduledWork(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const llm = createLLMProvider();
    const tts = new TTSProvider();
    await organizeNew(handle, llm);

    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    if (hour === 23 && minute >= 30 && minute < 40) {
      await regenerateSummary(handle, llm, tts, "day", dayKey(now));
    }
    if (now.getDay() === 0 && hour === 23 && minute >= 40 && minute < 50) {
      await regenerateSummary(handle, llm, tts, "week", weekKey(now));
    }
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (tomorrow.getMonth() !== now.getMonth() && hour === 23 && minute >= 50) {
      await regenerateSummary(handle, llm, tts, "month", monthKey(now));
    }
  } catch (error) {
    app.log.error(error);
  } finally {
    busy = false;
  }
}

setInterval(runScheduledWork, 10 * 60 * 1000).unref();

app.listen({ port: config.port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
