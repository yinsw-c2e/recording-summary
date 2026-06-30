import { config } from "../config";
import { DeepSeekProvider } from "./deepseek";
import type { LLMProvider } from "./llm";
import { MockLLMProvider } from "./mockLlm";

export function createLLMProvider(): LLMProvider {
  if (config.llmProvider === "deepseek") return new DeepSeekProvider();
  return new MockLLMProvider();
}
