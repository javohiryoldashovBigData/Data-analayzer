// Maktab+ — shared AI config. Prices checked 15–17 Nov 2026 on
// https://platform.claude.com/docs/en/about-claude/pricing  (re-check before launch)
// Models: https://docs.anthropic.com/en/docs/about-claude/models/overview

export const MODELS = {
  prep: Deno.env.get("AI_MODEL_PREP") ?? "claude-sonnet-5-5",   // lesson cards, tests
  route: Deno.env.get("AI_MODEL_ROUTE") ?? "claude-haiku-5-5",  // classify / cheap checks
} as const;

// USD per million tokens, STANDARD (non-batch) prices.
export const PRICE_USD_PER_MTOK: Record<string, {
  input: number; output: number; cacheWrite1h: number; cacheRead: number;
}> = {
  "claude-sonnet-5-5": { input: 2.0, output: 10.0, cacheWrite1h: 4.0, cacheRead: 0.10 },
  "claude-haiku-5-5":  { input: 0.10, output: 0.50, cacheWrite1h: 0.20, cacheRead: 0.01 }, // prompts ≤100k tokens
};

// Batch API = 50% of standard prices. ASSUMPTION: the discount also applies to
// cache writes/reads (docs say caching and batch discounts stack). The monthly
// Anthropic invoice is the truth; reconcile ai_usage_log against it.
export const BATCH_FACTOR = 0.5;

export const ANTHROPIC_URL = "https://api.anthropic.com/v1";
export const ANTHROPIC_VERSION = "2023-06-01";

export const LIMITS = {
  maxLessonsPerRun: 40,         // one teacher, one week (ESTIMATE: 6 days × 6 periods)
  maxOutputTokensPerCard: 1800, // ESTIMATE; a card is ~600–1200 tokens of JSON
  estInputTokensUncached: 1500, // per request: lesson meta + gaps (ESTIMATE)
  estCachedPrefixTokens: 6000,  // instructions + curriculum (ESTIMATE)
};
