// Vercel AI Gateway client — converts an injected `GenerateInput` into a
// concrete LLM call, returning the raw text + an estimated cost in USD.
//
// Routes through `"provider/model"` strings (default 'deepseek/deepseek-chat')
// per Vercel session guidance: the gateway centralizes provider keys, failover,
// and cost telemetry on Vercel's side, so we don't need a per-provider SDK.
//
// Auth: the AI SDK reads `AI_GATEWAY_API_KEY` from the environment automatically.
// We don't pass it explicitly; the route wrappers gate creation of this client
// on the env var's presence (so Hard tier silently degrades to Medium when it
// isn't set).
//
// Cost: budget is approximate (see `budget.ts` notes). We use published
// per-token deepseek-chat rates; gateway markup is small enough that this
// stays accurate enough for soft/hard caps. Override `rates` when wiring a
// different model.

import { generateText } from 'ai';
import type { GenerateInput, GenerateResult } from './hard';

/** USD per 1M tokens. Default rates target deepseek-chat (May 2026 pricing). */
export interface ModelRates {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const DEEPSEEK_CHAT_RATES: ModelRates = {
  inputPerMillion: 0.27,
  outputPerMillion: 1.1,
};

export const DEFAULT_GATEWAY_MODEL = 'deepseek/deepseek-chat';

export interface GatewayOptions {
  /** Override the model string (default 'deepseek/deepseek-chat'). */
  model?: string;
  /** Override the per-token rates used for budget cost estimation. */
  rates?: ModelRates;
}

/**
 * Build a `generate` function suitable for `MoveDeps.generate` /
 * `StartGameDeps.generate`. Closes over the model + rate selection so the
 * caller doesn't re-construct on every move.
 */
export function createGatewayGenerate(
  options: GatewayOptions = {},
): (input: GenerateInput) => Promise<GenerateResult> {
  const model = options.model ?? DEFAULT_GATEWAY_MODEL;
  const rates = options.rates ?? DEEPSEEK_CHAT_RATES;
  return async (input) => {
    const result = await generateText({
      model,
      system: input.system,
      prompt: input.prompt,
      abortSignal: input.signal,
    });
    return {
      text: result.text,
      costUsd: computeCostUsd(result.usage, rates),
    };
  };
}

/**
 * Pure cost calculator. Exported for tests and for callers that want to log
 * spend without going through the budget client. Tolerates missing usage
 * fields (returns 0) so a degenerate response doesn't crash the move handler.
 */
export function computeCostUsd(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  rates: ModelRates = DEEPSEEK_CHAT_RATES,
): number {
  if (!usage) return 0;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cost =
    (inputTokens * rates.inputPerMillion + outputTokens * rates.outputPerMillion) /
    1_000_000;
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}
