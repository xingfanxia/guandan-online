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

import { extractBearerToken } from '../auth/ownershipToken.js';
import { isValidRoomCode } from '../room/code.js';
import { dealRound, startTrick } from '../game/round.js';
import type { PlayerSeat } from '../game/round.js';
import { buildDeck, shuffleDeck } from '../game/cards.js';
import { positionCount } from '../game/mode.js';
import type { TeamKey } from '../game/mode.js';
import type { LevelRank } from '../game/levels.js';
import { createSession } from '../game/session.js';
import type { RoomState } from '../room/lifecycle.js';
import type { RoomStore } from '../storage/roomStore.js';
import type { RoundStore } from '../storage/roundStore.js';
import type { SessionStore } from '../storage/sessionStore.js';
import type { EventBus } from '../realtime/eventBus.js';
import type { EventLog } from '../realtime/eventLog.js';
import { publishEvent } from '../realtime/publish.js';
import { buildGameState } from '../realtime/buildGameState.js';
import { encodeCards } from '../realtime/cardCodec.js';
import type { AuthorDealEvent } from '../realtime/buildClientPayload.js';
import { runBots } from '../ai/runBots.js';

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
const DEFAULT_TURN_TIMEOUT_SECONDS = 30;

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
  // Continue the per-recipient SSE event-version namespace established by
  // lobby-phase lifecycle events (room_joined). Lifecycle bumps room
  // eventVersion on every join/leave; the deal takes the next value so
  // clients can resume across the lobby→game boundary with one
  // Last-Event-ID.
  const dealVersion = room.eventVersion + 1;
  const updatedRoom: RoomState = {
    ...room,
    phase: 'in_game',
    lastActiveAt: now(),
    eventVersion: dealVersion,
  };

  // Persist the session that survives across rounds. Move handler reads this
  // on each round-end transition to derive round_end + game_end events.
  await deps.sessionStore.put(
    code,
    createSession({ mode: room.mode, rules: room.rules }),
    SESSION_TTL_SECONDS
  );

  // Fanout the deal. Per-recipient filtering in publishEvent → only your own
  // hand survives; everyone else's hand is replaced by a hand-count.
  const encodedHands: AuthorDealEvent['hands'] = {};
  for (const seat of seats) {
    encodedHands[seat.id] = encodeCards(round.hands[seat.id] ?? []);
  }
  const dealEvent: AuthorDealEvent = {
    type: 'deal',
    version: dealVersion,
    hands: encodedHands,
    roundOwner: round.seats[0]!.team,
  };
  try {
    const gameState = buildGameState(updatedRoom, round);
    await publishEvent(code, dealEvent, gameState, deps.bus, deps.log);
  } catch (err) {
    console.error('[start] publishEvent failed:', err);
  }

  // Bot run-loop on game-start. If the first player (the leader / seats[0])
  // is a bot, advance through any contiguous bot turns until landing on a
  // human. Without this, a fully-bot-fill room would deal and then stall
  // forever waiting for someone to make a move.
  const turnDeadline = new Date(now() + DEFAULT_TURN_TIMEOUT_SECONDS * 1000).toISOString();
  const botResult = runBots({
    room: updatedRoom,
    round,
    startVersion: dealVersion,
    turnDeadline,
  });

  // Update the round-state to the post-bots round + final event version. If
  // no bots played, botResult.version === dealVersion and the round is
  // unchanged.
  const finalRound = botResult.round;
  const finalVersion = botResult.version;
  await deps.roundStore.put(
    code,
    { round: finalRound, version: finalVersion, updatedAt: now() },
    ROUND_TTL_SECONDS
  );

  // Room eventVersion tracks the LAST emitted event version so subsequent
  // lifecycle events (room_left during a game) and the move handler's
  // version checks stay aligned.
  const finalRoom: RoomState =
    finalVersion === dealVersion ? updatedRoom : { ...updatedRoom, eventVersion: finalVersion };
  await deps.roomStore.put(finalRoom, ROOM_TTL_SECONDS);

  // Fan out each bot event in sequence. publishEvent failures don't propagate
  // because the round state is durable and SSE clients catch up via the
  // EventLog backlog.
  if (botResult.events.length > 0) {
    try {
      const postBotsGameState = buildGameState(finalRoom, finalRound);
      for (const event of botResult.events) {
        await publishEvent(code, event, postBotsGameState, deps.bus, deps.log);
      }
    } catch (err) {
      console.error('[start] bot publishEvent failed:', err);
    }
  }

  return json({ ok: true, version: finalVersion }, 200);
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
