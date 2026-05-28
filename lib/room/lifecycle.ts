// Room lifecycle — state types + pure transitions for create/join/leave.
//
// SYNC: docs/plan/PLAN.md ROOM-1 spec. KV persistence and SSE-broadcast on
// state changes are API-route concerns (api/room/*); this module is the
// pure state machine.

import type { GameMode, ModeRules } from '../game/mode.js';
import { positionCount } from '../game/mode.js';
import type { PlayerId } from '../game/round.js';
import type { PlayerHandle, PlayerStatus } from '../realtime/messages.js';

export type RoomPhase = 'lobby' | 'in_game';

export interface RoomMember {
  id: PlayerId;
  handle: PlayerHandle;
  /** SSE reconnect token; held by the client. */
  joinToken: string;
  joinedAt: number;
  status: PlayerStatus;
  /** Bot difficulty when status === 'bot'; undefined otherwise. */
  difficulty?: 'easy' | 'medium';
  /**
   * SEC-2: salted hash of the joining client's IP, set at join time. Used by
   * the same-room IP-collision check (lib/room/ipWarning.ts). Never exposed
   * through the public room view — it is a moderation signal, not player data.
   */
  ipHash?: string;
  /**
   * AI-4: when a human seat is taken over by a bot after a disconnect, the
   * original human's reclaim credentials are stashed here so a reconnecting
   * client with the matching joinToken can resume the seat. Absent for
   * genuine bots (host-added fill) and live humans.
   */
  takenOverFrom?: { handle: PlayerHandle; joinToken: string };
}

export interface RoomState {
  code: string;
  mode: GameMode;
  rules: ModeRules;
  hostId: PlayerId;
  /** Admin-rights token (start game, kick, change rules). Distinct from
   *  the host's joinToken which only authenticates SSE reconnect. */
  hostToken: string;
  members: RoomMember[];
  phase: RoomPhase;
  createdAt: number;
  lastActiveAt: number;
  /**
   * Monotonic counter for per-recipient SSE event versions. Lifecycle events
   * (room_joined / room_left) increment this counter; game-start consumes
   * the next value as the deal event version, after which the round's
   * version takes over (RoundEnvelope.version). The lobby phase + game phase
   * thus share a single monotonic namespace per recipient so clients can
   * resume with a single Last-Event-ID across phase boundaries.
   *
   * Default 0 at creation; the first lifecycle event from joinRoom is at
   * version 1.
   */
  eventVersion: number;
  /**
   * AI-4: per-player last-seen wall-clock timestamps, bumped on SSE connect
   * and on each move. The dc-check cron (api/cron/dcCheck.ts) reads this to
   * find humans who have been silent past the disconnect threshold during an
   * in-game round. Optional — absent on freshly-created rooms.
   */
  lastSeenAt?: Record<PlayerId, number>;
}

// ─── createRoom ───────────────────────────────────────────────────────────────

export interface CreateRoomInput {
  code: string;
  mode: GameMode;
  rules: ModeRules;
  host: { id: PlayerId; handle: PlayerHandle };
  now: number;
  /** Token generator; caller controls source (crypto.randomUUID in prod). */
  tokenGen: () => string;
}

export function createRoom(input: CreateRoomInput): RoomState {
  const hostToken = input.tokenGen();
  const hostJoinToken = input.tokenGen();
  return {
    code: input.code,
    mode: input.mode,
    rules: input.rules,
    hostId: input.host.id,
    hostToken,
    members: [
      {
        id: input.host.id,
        handle: input.host.handle,
        joinToken: hostJoinToken,
        joinedAt: input.now,
        status: 'connected',
      },
    ],
    phase: 'lobby',
    createdAt: input.now,
    lastActiveAt: input.now,
    eventVersion: 0,
  };
}

// ─── joinRoom ─────────────────────────────────────────────────────────────────

export function joinRoom(
  state: RoomState,
  member: { id: PlayerId; handle: PlayerHandle },
  now: number,
  tokenGen: () => string
): RoomState {
  if (state.phase !== 'lobby') {
    throw new Error(`joinRoom: room is in "${state.phase}", cannot join after game started`);
  }
  const cap = positionCount(state.mode);
  if (state.members.length >= cap) {
    throw new Error(`joinRoom: room is full (${state.members.length}/${cap})`);
  }
  if (state.members.some((m) => m.handle === member.handle)) {
    throw new Error(`joinRoom: handle "${member.handle}" is already in the room`);
  }

  return {
    ...state,
    members: [
      ...state.members,
      {
        id: member.id,
        handle: member.handle,
        joinToken: tokenGen(),
        joinedAt: now,
        status: 'connected',
      },
    ],
    lastActiveAt: now,
    eventVersion: state.eventVersion + 1,
  };
}

// ─── addBotToRoom ─────────────────────────────────────────────────────────────

export interface AddBotInput {
  state: RoomState;
  id: PlayerId;
  handle: PlayerHandle;
  difficulty: 'easy' | 'medium';
  now: number;
  /** Synthetic token generator — bots never authenticate but the field is
   *  non-optional in RoomMember. Caller controls source. */
  tokenGen: () => string;
}

/**
 * Append a bot member to a lobby-phase room. Same capacity + handle-collision
 * checks as joinRoom; differs only by setting `status: 'bot'` + `difficulty`.
 *
 * Bots don't go through the join HTTP endpoint — they're seated at create-time
 * by the host's bot-fill choice. We still bump eventVersion so lifecycle
 * fanout (if wired) stays consistent with joinRoom.
 */
export function addBotToRoom(input: AddBotInput): RoomState {
  const { state, id, handle, difficulty, now, tokenGen } = input;
  if (state.phase !== 'lobby') {
    throw new Error(
      `addBotToRoom: room is in "${state.phase}", cannot add after game started`
    );
  }
  const cap = positionCount(state.mode);
  if (state.members.length >= cap) {
    throw new Error(`addBotToRoom: room is full (${state.members.length}/${cap})`);
  }
  if (state.members.some((m) => m.handle === handle)) {
    throw new Error(`addBotToRoom: handle "${handle}" is already in the room`);
  }
  if (state.members.some((m) => m.id === id)) {
    throw new Error(`addBotToRoom: id "${id}" is already in the room`);
  }

  return {
    ...state,
    members: [
      ...state.members,
      {
        id,
        handle,
        joinToken: tokenGen(),
        joinedAt: now,
        status: 'bot',
        difficulty,
      },
    ],
    lastActiveAt: now,
    eventVersion: state.eventVersion + 1,
  };
}

// ─── leaveRoom ────────────────────────────────────────────────────────────────

/**
 * Remove a player from the room. Returns null if the host left → caller
 * should delete the room from storage (and broadcast room-closed to remaining
 * members). Returns the new state otherwise.
 *
 * If the player isn't in the room, returns state unchanged (idempotent).
 */
export function leaveRoom(
  state: RoomState,
  playerId: PlayerId,
  now: number
): RoomState | null {
  if (playerId === state.hostId) {
    return null; // host quit → room is dissolved
  }
  if (!state.members.some((m) => m.id === playerId)) {
    return state; // not in room — no-op
  }
  return {
    ...state,
    members: state.members.filter((m) => m.id !== playerId),
    lastActiveAt: now,
    eventVersion: state.eventVersion + 1,
  };
}

// ─── isStale ──────────────────────────────────────────────────────────────────

/**
 * True when the room's last activity is at or before (now - ttlMs).
 * Used by the periodic cleanup pass (api/cron/cleanup-rooms.ts) to GC
 * abandoned rooms.
 */
export function isStale(state: RoomState, now: number, ttlMs: number): boolean {
  return now - state.lastActiveAt >= ttlMs;
}
