// POST /api/room/[code]/start — pure handler. Host-authenticated game start.
//
// Preconditions:
//   - room.phase === 'lobby'
//   - room.members.length === positionCount(mode)  (room is full)
//   - bearer matches room.hostToken (admin action — not joinToken)
//
// Effect:
//   - Seats assigned by alternating member position → team (t1/t2)
//   - Deck shuffled (caller-supplied rng for determinism in tests)
//   - dealRound() builds the initial GameRound; startTrick() begins trick 1
//   - RoundEnvelope persisted at version 0
//   - RoomState updated: phase='in_game', lastActiveAt=now()
//   - AuthorDealEvent fanned out (per-recipient filter happens in publishEvent)

import { extractBearerToken } from '../auth/ownershipToken';
import { isValidRoomCode } from '../room/code';
import { dealRound, startTrick } from '../game/round';
import type { PlayerSeat } from '../game/round';
import { buildDeck, shuffleDeck } from '../game/cards';
import { positionCount } from '../game/mode';
import type { TeamKey } from '../game/mode';
import type { LevelRank } from '../game/levels';
import { createSession } from '../game/session';
import type { RoomState } from '../room/lifecycle';
import type { RoomStore } from '../storage/roomStore';
import type { RoundStore } from '../storage/roundStore';
import type { SessionStore } from '../storage/sessionStore';
import type { EventBus } from '../realtime/eventBus';
import type { EventLog } from '../realtime/eventLog';
import { publishEvent } from '../realtime/publish';
import { buildGameState } from '../realtime/buildGameState';
import { encodeCards } from '../realtime/cardCodec';
import type { AuthorDealEvent } from '../realtime/buildClientPayload';

export interface StartGameDeps {
  roomStore: RoomStore;
  roundStore: RoundStore;
  sessionStore: SessionStore;
  bus: EventBus;
  log: EventLog;
  /** RNG seed for deck shuffle. Defaults to Math.random. */
  rng?: () => number;
  now?: () => number;
}

const ROOM_TTL_SECONDS = 86_400;
const ROUND_TTL_SECONDS = 86_400;
const SESSION_TTL_SECONDS = 86_400;
const STARTING_LEVEL: LevelRank = '2';

export async function handleStartGame(
  req: Request,
  code: string,
  deps: StartGameDeps
): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (!isValidRoomCode(code)) {
    return json({ error: 'invalid_room_code' }, 400);
  }

  const bearer = extractBearerToken(req);
  if (!bearer) {
    return json({ error: 'unauthorized' }, 401);
  }

  const room = await deps.roomStore.get(code);
  if (!room) {
    return json({ error: 'room_not_found' }, 404);
  }
  if (bearer !== room.hostToken) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (room.phase !== 'lobby') {
    return json(
      { error: 'conflict', details: `room is in "${room.phase}", cannot start` },
      409
    );
  }
  const expectedSeats = positionCount(room.mode);
  if (room.members.length !== expectedSeats) {
    return json(
      {
        error: 'conflict',
        details: `room needs ${expectedSeats} members, has ${room.members.length}`,
      },
      409
    );
  }

  const seats = assignSeats(room);
  const rng = deps.rng ?? Math.random;
  const shuffled = shuffleDeck(buildDeck(), rng);

  const round = startTrick(
    dealRound({
      mode: room.mode,
      level: STARTING_LEVEL,
      owner: null,
      seats,
      leader: seats[0]!.id,
      shuffledDeck: shuffled,
    })
  );

  const now = deps.now ?? Date.now;
  const updatedRoom: RoomState = {
    ...room,
    phase: 'in_game',
    lastActiveAt: now(),
  };

  await deps.roundStore.put(
    code,
    { round, version: 0, updatedAt: now() },
    ROUND_TTL_SECONDS
  );
  // Persist the session that survives across rounds. Move handler reads this
  // on each round-end transition to derive round_end + game_end events.
  await deps.sessionStore.put(
    code,
    createSession({ mode: room.mode, rules: room.rules }),
    SESSION_TTL_SECONDS
  );
  await deps.roomStore.put(updatedRoom, ROOM_TTL_SECONDS);

  // Fanout the deal. Per-recipient filtering in publishEvent → only your own
  // hand survives; everyone else's hand is replaced by a hand-count.
  const encodedHands: AuthorDealEvent['hands'] = {};
  for (const seat of seats) {
    encodedHands[seat.id] = encodeCards(round.hands[seat.id] ?? []);
  }
  const dealEvent: AuthorDealEvent = {
    type: 'deal',
    version: 0,
    hands: encodedHands,
    roundOwner: round.seats[0]!.team,
  };
  try {
    const gameState = buildGameState(updatedRoom, round);
    await publishEvent(code, dealEvent, gameState, deps.bus, deps.log);
  } catch (err) {
    console.error('[start] publishEvent failed:', err);
  }

  return json({ ok: true, version: 0 }, 200);
}

/**
 * Alternating team assignment: positions 0, 2, 4, ... → t1; 1, 3, 5, ... → t2.
 * This matches the natural guandan partnership (cross-table partners in 4P).
 * Member order in room.members IS the seat-position order (host at index 0,
 * subsequent joiners appended in arrival order — joinRoom enforces this).
 */
function assignSeats(room: RoomState): readonly PlayerSeat[] {
  const seats: PlayerSeat[] = [];
  for (let i = 0; i < room.members.length; i++) {
    const member = room.members[i]!;
    const team: TeamKey = i % 2 === 0 ? 't1' : 't2';
    seats.push({ id: member.id, team, position: i });
  }
  return seats;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
