// Realtime transport message types — server-to-client SSE events + supporting
// DTOs.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.2 ("Concrete MessageType
// enum (locked for SSE+POST shape)") lines ~685-830. Wire encoding (CardId
// strings, not full Card objects) lives at NET-3's buildClientPayload; this
// module is the type-only contract.

import type { LevelRank } from '../game/levels.js';
import type { PlayerId } from '../game/round.js';
import type { TeamKey } from '../game/mode.js';

// ─── Scalar/wire types ────────────────────────────────────────────────────────

/** Wire-format card id, e.g. "5-S-1" for 5♠ deck-1. Encoding lives in NET-3. */
export type CardId = string;
export type ISOTimestamp = string;
export type PlayerHandle = string;

export type RoomPhase =
  | 'lobby'
  | 'dealing'
  | 'tribute'
  | 'playing'
  | 'scoring'
  | 'ended';

// ─── Shared DTOs ──────────────────────────────────────────────────────────────

export interface PrivatePlayerState {
  playerId: PlayerId;
  hand: CardId[];
  teamId: TeamKey;
  partnerId: PlayerId;
}

export interface PublicTableState {
  currentTurn: PlayerId;
  currentTrick: { player: PlayerId; cards: CardId[] }[];
  lastTrick: { player: PlayerId; cards: CardId[] } | null;
  teamLevels: Record<TeamKey, LevelRank>;
  roundOwner: TeamKey;
  phase: RoomPhase;
  turnDeadline: ISOTimestamp;
}

export type PlayerStatus = 'connected' | 'disconnected' | 'bot';

export interface PlayerSummary {
  id: PlayerId;
  handle: PlayerHandle;
  team: TeamKey;
  handCount: number;
  status: PlayerStatus;
  rank: number | null;
}

// ─── ServerEvent discriminated union (15 kinds) ───────────────────────────────

export interface SnapshotEvent {
  type: 'snapshot';
  version: number;
  you: PrivatePlayerState;
  table: PublicTableState;
  players: PlayerSummary[];
  /** 1-based round counter (session.finishedRounds + 1). Optional —
   *  pre-existing emitters may omit it; clients keep their local counter. */
  roundNumber?: number;
  /** Per-team A-level fail counters — drives the ALevelFinal banner on
   *  resume. Optional for back-compat. */
  teamAFails?: Record<TeamKey, number>;
}

export interface RoomJoinedEvent {
  type: 'room_joined';
  version: number;
  player: PlayerSummary;
}

export interface RoomLeftEvent {
  type: 'room_left';
  version: number;
  playerId: PlayerId;
  reason: 'disconnect' | 'leave' | 'kick';
}

export interface DealEvent {
  type: 'deal';
  version: number;
  yourHand: CardId[];
  publicHandCounts: Record<PlayerId, number>;
  roundOwner: TeamKey;
  /** Who leads the first trick of this round. Optional for back-compat with
   *  pre-leader log entries replayed from durable storage. */
  leader?: PlayerId;
}

export interface MovePlayedEvent {
  type: 'move_played';
  version: number;
  player: PlayerId;
  cards: CardId[];
  combinationLabel: string;
  nextTurn: PlayerId;
  turnDeadline: ISOTimestamp;
}

export interface MovePassedEvent {
  type: 'move_passed';
  version: number;
  player: PlayerId;
  nextTurn: PlayerId;
  turnDeadline: ISOTimestamp;
}

export interface TrickWonEvent {
  type: 'trick_won';
  version: number;
  winner: PlayerId;
  nextLeader: PlayerId;
}

export interface TributePendingEvent {
  type: 'tribute_pending';
  version: number;
  /**
   * `single` / `double` — 4P tribute paths.
   * `sweep` — 6P/8P multi-pair tribute when the winning team sweeps positions
   *           1..N (N = winningRankCount). Obligation count is 3 (6P) or 4 (8P).
   * `anti_tribute` — losing team collectively holds both red jokers and refuses.
   */
  direction: 'single' | 'double' | 'sweep' | 'anti_tribute';
  obligations: {
    from: PlayerId;
    to: PlayerId;
    constraint: 'highest_non_heart' | 'any';
  }[];
  yourOwedCard?: CardId;
}

export interface TributeResolvedEvent {
  type: 'tribute_resolved';
  version: number;
  exchanged: { from: PlayerId; to: PlayerId; card: CardId }[];
}

export interface RoundEndEvent {
  type: 'round_end';
  version: number;
  winnerTeam: TeamKey;
  winnerRanks: number[];
  upgrade: number;
  newLevels: Record<TeamKey, LevelRank>;
  /** Post-round A-level fail counters — lets the ALevelFinal banner update
   *  live without a refetch. Optional for back-compat with logged events. */
  teamAFails?: Record<TeamKey, number>;
}

export interface GameEndEvent {
  type: 'game_end';
  version: number;
  winnerTeam: TeamKey;
  summary: string;
}

export interface StateResyncEvent {
  type: 'state_resync';
  version: number;
  snapshot: SnapshotEvent;
  reason: 'buffer_exhausted' | 'version_mismatch' | 'schema_upgrade';
}

export interface TurnAdvancedEvent {
  type: 'turn_advanced';
  version: number;
  currentTurn: PlayerId;
  turnDeadline: ISOTimestamp;
}

export interface HeartbeatEvent {
  type: 'heartbeat';
  version: number;
  serverTime: ISOTimestamp;
}

export interface StreamClosingEvent {
  type: 'stream_closing';
  version: number;
  retryAfterMs: number;
  reason: 'rotation' | 'maintenance' | 'error';
}

// ─── EXCHANGE-1 card-exchange events ──────────────────────────────────────────

/** Opens the losing-team vote on whether to run a card exchange this round. */
export interface ExchangeVoteRequiredEvent {
  type: 'exchange_vote_required';
  version: number;
  /** Losing-team players eligible to vote. */
  losers: PlayerId[];
  /** Fraction of yes votes required to pass (e.g. 0.5). */
  voteThreshold: number;
  /** Cards each player will exchange if the vote passes. */
  cardCount: number;
}

/** Announces the vote outcome. On pass, `direction` is set for the swap. */
export interface ExchangeVoteResolvedEvent {
  type: 'exchange_vote_resolved';
  version: number;
  passed: boolean;
  direction?: 'cw' | 'ccw';
}

/** Prompts every player to choose `cardCount` cards to give away. */
export interface ExchangeSelectRequiredEvent {
  type: 'exchange_select_required';
  version: number;
  cardCount: number;
  direction: 'cw' | 'ccw';
}

/**
 * The exchange completed. Carries hidden state — each recipient gets only
 * their own post-swap hand (filtered by buildClientPayload, like `deal`).
 */
export interface ExchangeCompletedEvent {
  type: 'exchange_completed';
  version: number;
  direction: 'cw' | 'ccw';
  /** Recipient's full post-swap hand. */
  yourHand: CardId[];
  /** Public per-player hand counts (unchanged by a count-preserving swap). */
  publicHandCounts: Record<PlayerId, number>;
}

export type ServerEvent =
  | SnapshotEvent
  | RoomJoinedEvent
  | RoomLeftEvent
  | DealEvent
  | MovePlayedEvent
  | MovePassedEvent
  | TrickWonEvent
  | TributePendingEvent
  | TributeResolvedEvent
  | RoundEndEvent
  | GameEndEvent
  | StateResyncEvent
  | TurnAdvancedEvent
  | HeartbeatEvent
  | StreamClosingEvent
  | ExchangeVoteRequiredEvent
  | ExchangeVoteResolvedEvent
  | ExchangeSelectRequiredEvent
  | ExchangeCompletedEvent;

// ─── Discriminator helpers ────────────────────────────────────────────────────
//
// `serverEventType` uses an exhaustive switch + `never` assignment so the
// TypeScript compiler flags any future event-kind addition that forgets to
// extend this function. The runtime test in messages.test.ts then verifies
// the literal mapping for every kind.

export function serverEventType(event: ServerEvent): ServerEvent['type'] {
  switch (event.type) {
    case 'snapshot':
    case 'room_joined':
    case 'room_left':
    case 'deal':
    case 'move_played':
    case 'move_passed':
    case 'trick_won':
    case 'tribute_pending':
    case 'tribute_resolved':
    case 'round_end':
    case 'game_end':
    case 'state_resync':
    case 'turn_advanced':
    case 'heartbeat':
    case 'stream_closing':
    case 'exchange_vote_required':
    case 'exchange_vote_resolved':
    case 'exchange_select_required':
    case 'exchange_completed':
      return event.type;
    default: {
      const _exhaustive: never = event;
      throw new Error(
        `serverEventType: unhandled event kind ${JSON.stringify(_exhaustive)}`
      );
    }
  }
}

export function isHeartbeat(event: ServerEvent): event is HeartbeatEvent {
  return event.type === 'heartbeat';
}

export function isStreamClosing(event: ServerEvent): event is StreamClosingEvent {
  return event.type === 'stream_closing';
}
