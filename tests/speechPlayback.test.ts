import { describe, expect, it } from "vitest";
import {
  canToggleSpeechPause,
  speechPauseButtonLabel,
  speechStartButtonLabel,
  speechStatusText,
  type SpeechPlaybackState
} from "../src/speechPlayback";

describe("speech playback labels", () => {
  it("shows idle state before speech starts", () => {
    const idle: SpeechPlaybackState = { source: null, paused: false };

    expect(speechStatusText(idle)).toBe("未朗读");
    expect(speechPauseButtonLabel(idle)).toBe("暂停朗读");
    expect(canToggleSpeechPause(idle)).toBe(false);
  });

  it("uses the active source for stop and pause labels", () => {
    const playing: SpeechPlaybackState = { source: "summary", paused: false };

    expect(speechStatusText(playing)).toBe("总结朗读中");
    expect(speechStartButtonLabel("summary", playing, 1.5)).toBe("停止总结");
    expect(speechStartButtonLabel("focus", playing, 1.5)).toBe("朗读重点 1.5x");
    expect(speechPauseButtonLabel(playing)).toBe("暂停朗读");
    expect(canToggleSpeechPause(playing)).toBe(true);
  });

  it("switches the pause control to resume when paused", () => {
    const paused: SpeechPlaybackState = { source: "review_due", paused: true };

    expect(speechStatusText(paused)).toBe("待复习已暂停");
    expect(speechPauseButtonLabel(paused)).toBe("继续朗读");
  });
});
