import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent } from "eve";

const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  headers: {
    "HTTP-Referer": "https://github.com/N-45div/SecureLore",
    "X-Title": "SecureLore"
  }
});

export default defineAgent({
  model: openrouter(process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini"),
  modelContextWindowTokens: 128_000,
  compaction: {
    modelContextWindowTokens: 128_000,
    thresholdPercent: 0.85
  },
  reasoning: "medium"
});
