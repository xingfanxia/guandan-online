// Hard-tier LLM budget guardrail.
//
// Tracks monthly spend (USD) in an injectable counter (memory by default,
// Upstash-backed in production via `createUpstashBudget()` — added with the
// AI-2 deploy). When spend > softLimit, the public API returns false from
// `canAffordHardMove()`, causing the bot dispatch to silently degrade Hard
// → Medium until the month rolls over.
//
// No PII in this module — counters are global per-server, not per-user.
// Stored under a single key `ai:budget:<YYYY-MM>` for easy operator audit.

export interface BudgetClient {
  /** Returns the current YYYY-MM-keyed spend in USD. */
  currentSpend: () => Promise<number>;
  /** Add `costUsd` to the current month's bucket. */
  recordCost: (costUsd: number) => Promise<void>;
}

export interface BudgetConfig {
  /** Soft limit in USD per month. At-or-above this, Hard degrades to Medium. */
  softLimitUsd: number;
  /** Hard limit in USD per month. At-or-above this, also blocks the spend record. */
  hardLimitUsd: number;
}

export const DEFAULT_BUDGET: BudgetConfig = {
  softLimitUsd: 50,
  hardLimitUsd: 100,
};

/**
 * Returns true when a hard-tier move can be attempted under the budget.
 * Caller still pays for whatever cost the call incurs; the budget is a
 * GUARD around starting the call, not a refund mechanism.
 */
export async function canAffordHardMove(
  client: BudgetClient,
  config: BudgetConfig = DEFAULT_BUDGET,
): Promise<boolean> {
  const spend = await client.currentSpend();
  return spend < config.softLimitUsd;
}

/**
 * Record the cost of a completed hard-tier move. Caller computes the cost
 * from observed token usage (input + output tokens × per-token rate).
 *
 * Returns true if recorded under the hard limit; false if at-or-above the
 * hard limit (in which case Hard should never be re-attempted this month
 * — caller should latch the answer for the rest of the request).
 */
export async function recordHardMoveCost(
  client: BudgetClient,
  costUsd: number,
  config: BudgetConfig = DEFAULT_BUDGET,
): Promise<boolean> {
  const before = await client.currentSpend();
  if (before + costUsd >= config.hardLimitUsd) return false;
  await client.recordCost(costUsd);
  return true;
}

/**
 * In-memory budget client — used in tests + dev. Production swaps in
 * `createUpstashBudget()`. Counter is shared per-process; restarts reset it
 * (acceptable since the soft limit is meant as a guardrail, not a hard wall).
 */
export function createMemoryBudgetClient(initial: number = 0): BudgetClient {
  let spend = initial;
  return {
    currentSpend: async () => spend,
    recordCost: async (cost) => {
      spend += cost;
    },
  };
}
