// POST /api/room/[code]/move — Vercel route wrapper.

import { createRealtimeInfra } from '../../../lib/realtime/infra';
import { handleMove } from '../../../lib/api/move';
import { createSlidingWindowLimiter } from '../../../lib/security/rateLimit';
import {
  createMemoryBudgetClient,
  createUpstashBudget,
  type BudgetClient,
} from '../../../lib/ai/budget';
import { createGatewayGenerate } from '../../../lib/ai/gateway';
import type { GenerateInput, GenerateResult } from '../../../lib/ai/hard';

export const config = {
  runtime: 'nodejs22.x',
};

// Cap per (room, player) at 30 moves per 10 seconds — enough headroom for
// fast-twitch play, low enough to throttle scripted clients.
const rateLimiter = createSlidingWindowLimiter({ windowMs: 10_000, max: 30 });

let infraCache: ReturnType<typeof createRealtimeInfra> | null = null;
function getInfra() {
  if (!infraCache) {
    infraCache = createRealtimeInfra(process.env);
  }
  return infraCache;
}

let budgetCache: BudgetClient | null = null;
function getBudget(): BudgetClient {
  if (!budgetCache) {
    const infra = getInfra();
    budgetCache = infra.redis ? createUpstashBudget(infra.redis) : createMemoryBudgetClient();
  }
  return budgetCache;
}

let generateCache: ((input: GenerateInput) => Promise<GenerateResult>) | null | undefined;
function getGenerate(): ((input: GenerateInput) => Promise<GenerateResult>) | undefined {
  if (generateCache === undefined) {
    // Hard tier needs both the gateway key AND the feature flag. Without
    // the key, the SDK can't reach the gateway; without the flag, hard.ts
    // bails out before calling. Treat both as required to construct.
    if (process.env['AI_GATEWAY_API_KEY']) {
      generateCache = createGatewayGenerate();
    } else {
      generateCache = null;
    }
  }
  return generateCache ?? undefined;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const code = segments[2] ?? '';
  const infra = getInfra();
  const generate = getGenerate();
  return handleMove(req, code, {
    roomStore: infra.roomStore,
    roundStore: infra.roundStore,
    sessionStore: infra.sessionStore,
    idempotency: infra.idempotency,
    rateLimiter,
    bus: infra.bus,
    log: infra.log,
    budget: getBudget(),
    ...(generate ? { generate } : {}),
  });
}
