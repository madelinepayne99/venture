// Per-million-token USD pricing for models Venture HQ agents are allowed to
// call. Keep in sync with Anthropic's published pricing. Used only to
// record real spend in the cost ledger — never to estimate or promise
// savings/profit.
export const MODEL_PRICING_PER_MTOK: Record<
  string,
  { input: number; output: number; cacheWrite?: number; cacheRead?: number }
> = {
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function calculateUsdCost(model: string, usage: UsageLike): number {
  const pricing = MODEL_PRICING_PER_MTOK[model];
  if (!pricing) {
    throw new Error(`No pricing configured for model "${model}" — refusing to record an unknown cost.`);
  }
  const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;
  const cacheWriteCost =
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * (pricing.cacheWrite ?? pricing.input);
  const cacheReadCost =
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * (pricing.cacheRead ?? pricing.input);
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}
