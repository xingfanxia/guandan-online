// GET /api/rooms — public room browse list (ROOM-3, pure handler).
//
// Lists rooms that (a) opted into visibility:'public' at create time,
// (b) are still in the lobby phase, and (c) have at least one open human
// seat. Sorted newest-first, capped at MAX_LISTED.
//
// Privacy: the response DTO is constructed field-by-field — joinTokens,
// hostToken, ipHash, and member identities beyond the host handle NEVER
// leave the server. Anyone can call this endpoint (that's the point of a
// public list), so it's rate-limited per caller identity at the route
// wrapper.

import type { RoomStore } from '../storage/roomStore.js';
import type { RateLimiter } from '../security/rateLimit.js';
import { positionCount, type GameMode } from '../game/mode.js';

export interface PublicRoomListing {
  code: string;
  mode: GameMode;
  /** Seats currently taken (humans + bots). */
  seatsFilled: number;
  seatsTotal: number;
  hostHandle: string;
  createdAt: number;
  /** Strict-A chip for the browse card. */
  strictA: boolean;
}

export interface ListRoomsResponseBody {
  rooms: PublicRoomListing[];
}

export interface ListRoomsDeps {
  roomStore: RoomStore;
  /** Optional per-caller rate limiter (route wrapper supplies identity). */
  rateLimiter?: RateLimiter;
  identify?: (req: Request) => string;
  now?: () => number;
}

const MAX_LISTED = 50;

export async function handleListRooms(
  req: Request,
  deps: ListRoomsDeps
): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (deps.rateLimiter) {
    const ident = deps.identify ? deps.identify(req) : extractIdentity(req);
    const now = (deps.now ?? Date.now)();
    const rl = await deps.rateLimiter.check(`rooms:${ident}`, now);
    if (!rl.allowed) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (rl.retryAfterMs !== undefined) {
        headers['retry-after'] = Math.ceil(rl.retryAfterMs / 1000).toString();
      }
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers,
      });
    }
  }

  const codes = await deps.roomStore.listCodes();
  const rooms: PublicRoomListing[] = [];
  for (const code of codes) {
    try {
      const room = await deps.roomStore.get(code);
      if (!room) continue;
      if (room.visibility !== 'public') continue;
      if (room.phase !== 'lobby') continue;
      const seatsTotal = positionCount(room.mode);
      if (room.members.length >= seatsTotal) continue;
      const host = room.members.find((m) => m.id === room.hostId);
      rooms.push({
        code: room.code,
        mode: room.mode,
        seatsFilled: room.members.length,
        seatsTotal,
        hostHandle: host?.handle ?? '?',
        createdAt: room.createdAt,
        strictA: room.rules.strictA,
      });
    } catch (err) {
      // One bad room must not empty the whole list.
      console.error('[list-rooms] error reading', code, err);
    }
  }

  rooms.sort((a, b) => b.createdAt - a.createdAt);
  const body: ListRoomsResponseBody = { rooms: rooms.slice(0, MAX_LISTED) };
  return json(body, 200);
}

/** Same client-IP extraction as createRoom — per-caller rate-limit buckets. */
function extractIdentity(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    return xff.split(',')[0]!.trim();
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'anon';
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
