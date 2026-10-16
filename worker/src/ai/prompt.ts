// What every provider is asked, so a switch of provider changes the model and
// nothing else. The caller (coerceExtraction in index.ts) validates the answer
// whichever provider gave it.

export const CLASSIFY_SYSTEM =
  "You file things people want to watch, read or listen to into their personal watchlist. " +
  "Given what they shared (their own words, and a preview of any link), identify the one thing to save. Return only JSON.";

export function classifyPrompt(text: string): string {
  return `Extract one recommendation from this message:\n${text}\n\n` +
    "Return JSON fields: title, media_type (movie|series|book|podcast|youtube|song|post|unknown), " +
    "source_name, source_url, reason_saved, confidence (0 to 1), needs_clarification. " +
    'Use media_type "post" for a link to a single X/Twitter or Reddit post. ' +
    "Use an empty string for a text field you can't tell.";
}

// For providers that can enforce a schema. Optional fields are empty strings
// rather than nulls, which every structured-output implementation accepts.
export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    media_type: { type: "string", enum: ["movie", "series", "book", "podcast", "youtube", "song", "post", "unknown"] },
    source_name: { type: "string" },
    source_url: { type: "string" },
    reason_saved: { type: "string" },
    confidence: { type: "number" },
    needs_clarification: { type: "boolean" },
  },
  required: ["title", "media_type", "source_name", "source_url", "reason_saved", "confidence", "needs_clarification"],
  additionalProperties: false,
} as const;
