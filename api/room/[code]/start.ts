// POST /api/room/[code]/start — Vercel route wrapper.

import { createRealtimeInfra } from '../../../lib/realtime/infra';
import { handleStartGame } from '../../../lib/api/startGame';
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
  return handleStartGame(req, code, {
    roomStore: infra.roomStore,
    roundStore: infra.roundStore,
    sessionStore: infra.sessionStore,
    bus: infra.bus,
    log: infra.log,
    budget: getBudget(),
    ...(generate ? { generate } : {}),
  });
}
