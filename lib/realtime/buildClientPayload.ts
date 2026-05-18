// Hidden-state filter — the SINGLE gateway between authoritative game state
// and per-recipient SSE payloads.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.4 "Hidden-state filtering"
// (lines ~896-1004). Every publish path MUST route events through this function.
// NET-3's grep-no-leak CI test enforces this by forbidding `redis.publish(`
// or `eventLog.append(` anywhere outside the publish wrapper (built on top of
// this filter).
//
// SECURITY-CRITICAL: a bug here lets opponents see hidden hands. Tests cover
// each event kind plus the runtime leak detector.

import type { PlayerId } from '../game/round';
import type {
  CardId,
  DealEvent,
  HeartbeatEvent,
  PlayerHandle,
  PlayerStatus,
  PublicTableState,
  ServerEvent,
  SnapshotEvent,
  StateResyncEvent,
  TributePendingEvent,
} from './messages';
import type { TeamKey } from '../game/mode';

// ─── Authoritative server-side state ──────────────────────────────────────────

export interface GameState {
  hands: Record<PlayerId, CardId[]>;
  handles: Record<PlayerId, PlayerHandle>;
  teams: Record<PlayerId, TeamKey>;
  partners: Record<PlayerId, PlayerId>;
  statuses: Record<PlayerId, PlayerStatus>;
  ranks: Record<PlayerId, number | null>;
}

// ─── AuthorEvent: events carrying full information (server-side only) ────────
//
// Mirrors ServerEvent but for events with hidden state, the Author* variant
// carries the full data (all hands, all private payloads). buildClientPayload
// turns each into the per-recipient ServerEvent.

export interface AuthorDealEvent {
  type: 'deal';
  version: number;
  /** Full hands by player. Filtered to only the recipient's own. */
  hands: Record<PlayerId, CardId[]>;
  roundOwner: TeamKey;
}

export interface AuthorTributePendingEvent {
  type: 'tribute_pending';
  version: number;
  direction: 'single' | 'double' | 'anti_tribute';
  obligations: {
    from: PlayerId;
    to: PlayerId;
    constraint: 'highest_non_heart' | 'any';
  }[];
  /** Per-player private payload (e.g., the card you've been given). */
  privatePayloads: Record<PlayerId, { owedCard?: CardId }>;
}

export interface AuthorSnapshotEvent {
  type: 'snapshot';
  version: number;
  table: PublicTableState;
}

export interface AuthorStateResyncEvent {
  type: 'state_resync';
  version: number;
  reason: 'buffer_exhausted' | 'version_mismatch' | 'schema_upgrade';
  table: PublicTableState;
}

/**
 * AuthorEvent = pass-through events ∪ specialized Author* variants.
 * Pass-through events have no hidden state, so the server-side and client-side
 * shapes are identical.
 */
export type PassThroughServerEvent = Exclude<
  ServerEvent,
  DealEvent | TributePendingEvent | SnapshotEvent | StateResyncEvent
>;

export type AuthorEvent =
  | AuthorDealEvent
  | AuthorTributePendingEvent
  | AuthorSnapshotEvent
  | AuthorStateResyncEvent
  | PassThroughServerEvent;

// ─── Filter ───────────────────────────────────────────────────────────────────

export function buildClientPayload(
  recipient: PlayerId,
  event: AuthorEvent,
  state: GameState
): ServerEvent | null {
  switch (event.type) {
    case 'deal': {
      const yourHand = event.hands[recipient] ?? [];
      const publicHandCounts: Record<PlayerId, number> = {};
      for (const [id, hand] of Object.entries(event.hands)) {
        publicHandCounts[id] = hand.length;
      }
      const out: DealEvent = {
        type: 'deal',
        version: event.version,
        yourHand,
        publicHandCounts,
        roundOwner: event.roundOwner,
      };
      return out;
    }

    case 'tribute_pending': {
      const myObligation = event.obligations.find(
        (o) => o.from === recipient || o.to === recipient
      );
      const yourOwedCard =
        myObligation && myObligation.to === recipient
          ? event.privatePayloads[recipient]?.owedCard
          : undefined;
      const out: TributePendingEvent = {
        type: 'tribute_pending',
        version: event.version,
        direction: event.direction,
        obligations: event.obligations,
      };
      if (yourOwedCard !== undefined) {
        out.yourOwedCard = yourOwedCard;
      }
      return out;
    }

    case 'snapshot':
      return buildSnapshot(recipient, event, state);

    case 'state_resync': {
      const snapshot = buildSnapshot(
        recipient,
        { type: 'snapshot', version: event.version, table: event.table },
        state
      );
      const out: StateResyncEvent = {
        type: 'state_resync',
        version: event.version,
        snapshot,
        reason: event.reason,
      };
      return out;
    }

    // Pass-through: no hidden state in the wire format.
    case 'heartbeat':
    case 'room_joined':
    case 'room_left':
    case 'move_played':
    case 'move_passed':
    case 'trick_won':
    case 'tribute_resolved':
    case 'round_end':
    case 'game_end':
    case 'turn_advanced':
    case 'stream_closing':
      return event;

    default: {
      const _exhaustive: never = event;
      throw new Error(
        `buildClientPayload: unhandled event ${JSON.stringify(_exhaustive)}`
      );
    }
  }
}

function buildSnapshot(
  recipient: PlayerId,
  event: AuthorSnapshotEvent,
  state: GameState
): SnapshotEvent {
  return {
    type: 'snapshot',
    version: event.version,
    you: {
      playerId: recipient,
      hand: state.hands[recipient] ?? [],
      teamId: state.teams[recipient]!,
      partnerId: state.partners[recipient]!,
    },
    table: event.table,
    players: Object.keys(state.hands).map((id) => ({
      id,
      handle: state.handles[id] ?? id,
      team: state.teams[id]!,
      handCount: state.hands[id]?.length ?? 0,
      status: state.statuses[id] ?? 'connected',
      rank: state.ranks[id] ?? null,
    })),
  };
}

// ─── Runtime leak detector (dev / CI gate) ────────────────────────────────────

/**
 * Throws if the serialized payload includes any card identity belonging to
 * a player other than the recipient. Run in dev / CI to catch accidental
 * leaks introduced by future event kinds.
 *
 * Note on substring matching: card identities are wrapped in double quotes in
 * JSON, so we search for `"<card>"` rather than the bare card string. This
 * avoids false positives if a card id happens to appear inside a longer
 * string (e.g., the literal "5-S-1" inside a comment field). Card IDs are
 * disjoint from English words, so quoted substring matching is precise.
 */
export function assertNoOpponentHandLeak(
  payload: ServerEvent | HeartbeatEvent,
  recipient: PlayerId,
  state: GameState
): void {
  const serialized = JSON.stringify(payload);
  for (const [otherId, otherHand] of Object.entries(state.hands)) {
    if (otherId === recipient) continue;
    for (const card of otherHand) {
      if (serialized.includes(`"${card}"`)) {
        throw new Error(
          `HIDDEN_STATE_LEAK: payload for ${recipient} contains opponent ${otherId}'s card ${card}`
        );
      }
    }
  }
}
