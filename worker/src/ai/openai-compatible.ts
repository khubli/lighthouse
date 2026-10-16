// Classification through any OpenAI-compatible chat API: OpenRouter (any model
// it carries, free ones included), OpenAI itself, or anything that speaks the
// same protocol (Groq, Together, a local Ollama...) at OPENAI_BASE_URL.
import { CLASSIFY_SYSTEM, classifyPrompt } from "./prompt.ts";

export interface OpenAICompatibleEnv {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

export async function classifyWithOpenAICompatible(
  text: string,
  provider: "openrouter" | "openai",
  env: OpenAICompatibleEnv,
): Promise<Record<string, unknown> | null> {
  const openrouter = provider === "openrouter";
  const base = openrouter ? OPENROUTER_BASE_URL : (env.OPENAI_BASE_URL?.trim() || OPENAI_BASE_URL).replace(/\/+$/, "");
  const key = openrouter ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY;
  const model = openrouter ? env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini" : env.OPENAI_MODEL?.trim();
  if (!model) throw new Error("OPENAI_MODEL is not set");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // A local server (Ollama) needs no key, so none is sent rather than an empty one.
  if (key) headers.Authorization = `Bearer ${key}`;
  if (openrouter) {
    headers["HTTP-Referer"] = "https://github.com/khubli/lighthouse";
    headers["X-Title"] = "Lighthouse";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers,
      // No response_format: several free models reject it. The answer is parsed
      // leniently below and validated by the caller.
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM },
          { role: "user", content: classifyPrompt(text) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${provider} answered ${res.status}`);
    const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return parseJsonObject(body.choices?.[0]?.message?.content ?? "");
  } finally {
    clearTimeout(timer);
  }
}

/** The first JSON object in a reply, tolerating code fences and chatter around it. */
function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
