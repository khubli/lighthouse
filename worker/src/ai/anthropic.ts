// Classification with Claude, through Anthropic's SDK, using the operator's own
// API key (ANTHROPIC_API_KEY).
import Anthropic from "@anthropic-ai/sdk";
import { CLASSIFY_SYSTEM, EXTRACTION_SCHEMA, classifyPrompt } from "./prompt.ts";

export interface AnthropicEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

// Models that take server-side refusal fallbacks. "default" lets Anthropic pick
// the substitute by refusal category, so there is no model list to maintain.
// Other models reject the parameter, so it is sent only to these.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/** The model's JSON answer, or null when it declined or ran out of room. Throws on API errors. */
export async function classifyWithClaude(text: string, env: AnthropicEnv): Promise<Record<string, unknown> | null> {
  // One retry, and a timeout a person waiting on Save will tolerate: past it the
  // rules-based classifier takes over, which is better than a hung button.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 1 });
  const model = env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
  const response = await client.beta.messages.create({
    model,
    max_tokens: 4096,
    system: CLASSIFY_SYSTEM,
    messages: [{ role: "user", content: classifyPrompt(text) }],
    // A short classification: low effort is enough, and the schema guarantees
    // the shape of the JSON that comes back.
    output_config: { effort: "low", format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    console.error(`Claude classification stopped: ${response.stop_reason}`);
    return null;
  }
  const answer = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  return JSON.parse(answer) as Record<string, unknown>;
}
