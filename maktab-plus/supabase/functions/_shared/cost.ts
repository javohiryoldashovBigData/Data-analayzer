import { BATCH_FACTOR, LIMITS, PRICE_USD_PER_MTOK } from "./config.ts";

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

function price(model: string) {
  const p = PRICE_USD_PER_MTOK[model];
  if (!p) throw new Error(`no_price_for_model:${model}`);   // never guess a price
  return p;
}

/** Real cost in US cents from the usage block of one response. */
export function costCents(model: string, u: Usage, batch = true): number {
  const p = price(model);
  const usd =
    ((u.input_tokens ?? 0) * p.input +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite1h +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.output_tokens ?? 0) * p.output) / 1_000_000;
  return Math.round(usd * (batch ? BATCH_FACTOR : 1) * 100 * 10000) / 10000;
}

/** Upper-bound ESTIMATE for the reservation (assumes the first request writes the cache, the rest read it). */
export function estimateCents(model: string, nRequests: number): number {
  if (nRequests <= 0) return 0;
  const p = price(model);
  const usd =
    (LIMITS.estCachedPrefixTokens * p.cacheWrite1h +                       // first write
      (nRequests - 1) * LIMITS.estCachedPrefixTokens * p.cacheRead +       // later hits
      nRequests * LIMITS.estInputTokensUncached * p.input +
      nRequests * LIMITS.maxOutputTokensPerCard * p.output) / 1_000_000;
  return Math.ceil(usd * BATCH_FACTOR * 100 * 100) / 100;                  // round UP
}
