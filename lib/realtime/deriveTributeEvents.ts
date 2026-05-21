// Tribute event derivation — translates a server-resolved tribute outcome into
// the wire-level event sequence the client expects.
//
// SYNC: lib/realtime/messages.ts → TributePendingEvent + TributeResolvedEvent
// shapes. The buildClientPayload filter at lib/realtime/buildClientPayload.ts
// turns AuthorTributePendingEvent into per-recipient TributePendingEvent;
// AuthorTributeResolvedEvent is pass-through (no hidden state).
//
// Auto-tribute happens in one server step (server picks tribute + return cards
// immediately). The wire sequence is:
//
//   1. tribute_pending  — declares the direction + obligations.
//                         For 'single' / 'double', `privatePayloads[winner] =
//                         { owedCard: <tribute card> }` so the winner client
//                         sees what they're about to receive.
//                         For 'anti_tribute', obligations is empty.
//   2. tribute_resolved — emits all card movements (tribute + return per pair).
//                         Skipped entirely for 'anti_tribute' / 'none'.

import type { TributeExchange, TributeMode } from '../game/tribute.js';
import { encodeCard } from './cardCodec.js';
import type {
  AuthorEvent,
  AuthorTributePendingEvent,
} from './buildClientPayload.js';
import type { CardId, TributeResolvedEvent } from './messages.js';

export interface DeriveTributeEventsInput {
  tributeMode: TributeMode;
  exchanges: readonly TributeExchange[];
  /** Version assigned to the FIRST emitted event. Subsequent events bump by 1. */
  baseVersion: number;
}

/**
 * Build the AuthorEvent[] for a resolved tribute phase. Returns an empty array
 * when `tributeMode.kind === 'none'`.
 *
 * Order: [tribute_pending, tribute_resolved?]. Caller publishes them sequentially
 * and assigns subsequent events (deal, move, etc.) versions starting from
 * `baseVersion + result.length`.
 */
export function deriveTributeEvents(
  input: DeriveTributeEventsInput
): AuthorEvent[] {
  const { tributeMode, exchanges, baseVersion } = input;
  if (tributeMode.kind === 'none') return [];

  const direction =
    tributeMode.kind === 'single'
      ? 'single'
      : tributeMode.kind === 'double'
        ? 'double'
        : 'anti_tribute';

  const obligations: AuthorTributePendingEvent['obligations'] =
    tributeMode.kind === 'single'
      ? [{ from: tributeMode.from, to: tributeMode.to, constraint: 'highest_non_heart' }]
      : tributeMode.kind === 'double'
        ? tributeMode.obligations.map((o) => ({
            from: o.from,
            to: o.to,
            constraint: 'highest_non_heart' as const,
          }))
        : []; // anti_tribute (resist) — no obligations

  // For auto-tribute we already know the exact tribute card per obligation.
  // Surface that to the winner via privatePayloads.owedCard so the modal can
  // render the incoming card immediately (S04 auto path).
  const privatePayloads: AuthorTributePendingEvent['privatePayloads'] = {};
  for (const ex of exchanges) {
    privatePayloads[ex.to] = { owedCard: encodeCard(ex.tribute) };
  }

  const pending: AuthorTributePendingEvent = {
    type: 'tribute_pending',
    version: baseVersion,
    direction,
    obligations,
    privatePayloads,
  };

  // Resist / anti_tribute: no card movement, no resolved event.
  if (tributeMode.kind === 'resist' || exchanges.length === 0) {
    return [pending];
  }

  // Resolved event: flatten each TributeExchange into two card movements
  // (tribute + return). returnCard may be null when the winner's hand had no
  // tributable card to give back (impossible at 27 cards, but pickReturnCard
  // returns null for safety — we skip the entry instead of emitting null).
  const exchanged: TributeResolvedEvent['exchanged'] = [];
  for (const ex of exchanges) {
    exchanged.push({ from: ex.from, to: ex.to, card: encodeCard(ex.tribute) as CardId });
    if (ex.return !== null) {
      exchanged.push({ from: ex.to, to: ex.from, card: encodeCard(ex.return) as CardId });
    }
  }

  const resolved: TributeResolvedEvent = {
    type: 'tribute_resolved',
    version: baseVersion + 1,
    exchanged,
  };

  return [pending, resolved];
}
