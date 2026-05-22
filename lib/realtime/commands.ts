// Realtime transport — client → server POST command shapes.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.2 (lines ~705-721).
// Commands route via URL path (api/game/[room]/move, api/game/[room]/join)
// but the body shape uses a `kind` discriminator so the move handler can
// dispatch on it. moveId is a client-generated UUID v4 — the idempotency
// key for retry-safety (NET-2 consumes this).

import type { CardId } from './messages.js';

export interface PlayCommand {
  kind: 'play';
  cards: CardId[];
  /** Optimistic-version check: server rejects if appliedVersion ≠ fromVersion. */
  fromVersion: number;
}

export interface PassCommand {
  kind: 'pass';
  fromVersion: number;
}

export interface TributeSelectCommand {
  kind: 'tribute_select';
  targetCard: CardId;
  fromVersion: number;
}

export interface AntiTributeCommand {
  kind: 'anti_tribute';
  fromVersion: number;
}

export interface ReportCardCommand {
  kind: 'report_card';
  cards: CardId[];
  fromVersion: number;
}

export interface ReadyCommand {
  kind: 'ready';
  fromVersion: number;
}

export type MoveCommand =
  | PlayCommand
  | PassCommand
  | TributeSelectCommand
  | AntiTributeCommand
  | ReportCardCommand
  | ReadyCommand;

export interface MoveRequest {
  /** Client-generated UUIDv4. Same moveId → same response (NET-2 idempotency). */
  moveId: string;
  command: MoveCommand;
}

export type MoveErrorCode =
  | 'stale_version'
  | 'not_your_turn'
  | 'invalid_move'
  | 'rate_limited'
  | 'auth_failed'
  /**
   * Catch-all for downstream-throw recovery in the API handlers — e.g., a
   * roomStore/roundStore/sessionStore put() that throws after an idempotency
   * reservation. The handler commits a `{ ok: false, error: 'internal_error', ... }`
   * MoveResponse so concurrent retries see a cached error rather than a
   * stuck 'pending'. Never surfaced from the game-logic dispatch itself.
   */
  | 'internal_error';

export type MoveResponse =
  | { ok: true; appliedVersion: number; result: 'applied' | 'replayed' }
  | { ok: false; error: MoveErrorCode; details?: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function moveCommandKind(cmd: MoveCommand): MoveCommand['kind'] {
  switch (cmd.kind) {
    case 'play':
    case 'pass':
    case 'tribute_select':
    case 'anti_tribute':
    case 'report_card':
    case 'ready':
      return cmd.kind;
    default: {
      const _exhaustive: never = cmd;
      throw new Error(
        `moveCommandKind: unhandled command ${JSON.stringify(_exhaustive)}`
      );
    }
  }
}

export function isPlayCommand(cmd: MoveCommand): cmd is PlayCommand {
  return cmd.kind === 'play';
}
