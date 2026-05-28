// POST /api/auth/createHandle — Vercel route wrapper. (SEC-2)
// Logic lives in lib/api/createHandle.ts. Wires the shared profile store +
// the per-IP account-creation throttle (Redis in prod, memory in dev) and the
// server-side IP-hash salt from env.
//
// Future routes MUST use named HTTP method exports — `export default async
// function handler` is the Vercel trap (silently treated as Express-style
// (req, res) => void; returned Response is ignored → request hangs).

import { getProfileStore } from '../../lib/storage/sharedStores.js';
import { getIpThrottle } from '../../lib/security/sharedIpThrottle.js';
import { handleCreateHandle } from '../../lib/api/createHandle.js';

export async function POST(request: Request): Promise<Response> {
  return handleCreateHandle(request, {
    ipThrottle: getIpThrottle(),
    profileStore: getProfileStore(),
    salt: process.env['IP_HASH_SALT'] ?? 'dev-salt',
  });
}
