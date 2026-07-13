export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  siteUrl?: string;
  appName?: string;
  timeoutMs?: number;
}

export async function completeJson<T>(
  messages: OpenRouterMessage[],
  options: OpenRouterOptions
): Promise<T> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      "http-referer": options.siteUrl ?? "https://github.com/N-45div/SecureLore",
      "x-title": options.appName ?? "SecureLore"
    },
    body: JSON.stringify({
      model: options.model ?? "openai/gpt-4o-mini",
      messages,
      temperature: 0.1,
      response_format: {
        type: "json_object"
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter completion failed with ${response.status}: ${body}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter response did not include message content.");
  }

  return JSON.parse(content) as T;
}
