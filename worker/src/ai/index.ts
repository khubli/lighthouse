// Bring your own key: the model that classifies a save is whichever provider's
// key is set, or the one AI_PROVIDER names when several are. With none, the
// caller uses the built-in rules (heuristicExtract), so the app works with no
// AI at all, and any failure here lands there too.
import { type AnthropicEnv, classifyWithClaude } from "./anthropic.ts";
import { type OpenAICompatibleEnv, classifyWithOpenAICompatible } from "./openai-compatible.ts";

export interface AiEnv extends AnthropicEnv, OpenAICompatibleEnv {
  AI_PROVIDER?: string;
}

export type AiProvider = "anthropic" | "openrouter" | "openai";
const ORDER: AiProvider[] = ["anthropic", "openrouter", "openai"];

export function chooseProvider(env: AiEnv): AiProvider | null {
  const configured: Record<AiProvider, boolean> = {
    anthropic: Boolean(env.ANTHROPIC_API_KEY?.trim()),
    openrouter: Boolean(env.OPENROUTER_API_KEY?.trim()),
    // A local OpenAI-compatible server needs only an address, no key.
    openai: Boolean(env.OPENAI_API_KEY?.trim() || env.OPENAI_BASE_URL?.trim()),
  };
  const named = env.AI_PROVIDER?.trim().toLowerCase();
  if (named === "none") return null;
  if (named && (ORDER as string[]).includes(named)) return configured[named as AiProvider] ? (named as AiProvider) : null;
  return ORDER.find((provider) => configured[provider]) ?? null;
}

/** The model's raw JSON answer, or null when no model is configured or the call failed. */
export async function classifyWithModel(text: string, env: AiEnv): Promise<Record<string, unknown> | null> {
  const provider = chooseProvider(env);
  if (!provider) return null;
  try {
    return provider === "anthropic"
      ? await classifyWithClaude(text, env)
      : await classifyWithOpenAICompatible(text, provider, env);
  } catch (error) {
    console.error(`${provider} classification failed`, error);
    return null;
  }
}
