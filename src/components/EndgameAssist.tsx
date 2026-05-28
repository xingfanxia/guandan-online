// EndgameAssist — opt-in late-game "clearing line" hint.
//
// When the hand is small (≤ 6 cards) AND the feature is enabled, surfaces a
// suggested sequence of plays that empties the hand, so the player can see a
// concrete path to going out. Gated by `enabled` (default OFF) — it's an
// assist, not always-on.
//
// The clearing line is computed by a greedy decomposition: repeatedly take the
// cheapest legal LEAD from the remaining cards (target=null) until the hand is
// empty or no legal play remains. This is a heuristic line (it doesn't model
// opponents or trick context) — purely a "here's one way to dump your hand"
// hint, intentionally simple and client-only (no server WASM decomposer).
//
// Renders nothing when disabled or when the hand exceeds the threshold. When a
// complete clearing line exists, lists each step's pattern label; when the
// greedy walk gets stuck, shows the partial line + a "需手动调整" note.

import { useMemo } from 'react';
import type { Card } from '@lib/game/cards';
import type { Pattern } from '@lib/game/patterns';
import type { LevelRank } from '@lib/game/levels';
import { suggestMove, type SuggestOptions } from '@/lib/assist/suggest';
import { patternLabel } from '@/lib/assist/patternLabel';

/** Default endgame threshold — hint only meaningful for short hands. */
export const ENDGAME_THRESHOLD = 6;

export interface EndgameAssistProps {
  cards: readonly Card[];
  levelRank: LevelRank;
  /** Opt-in gate. Default OFF — nothing renders unless explicitly enabled. */
  enabled?: boolean;
  /** Override the threshold (default 6). */
  threshold?: number;
  /** Inject the enumerator (tests). */
  suggestOptions?: SuggestOptions;
}

interface ClearingLine {
  readonly steps: readonly Pattern[];
  /** True if the greedy walk emptied the hand; false if it got stuck. */
  readonly complete: boolean;
}

export function EndgameAssist({
  cards,
  levelRank,
  enabled = false,
  threshold = ENDGAME_THRESHOLD,
  suggestOptions,
}: EndgameAssistProps): React.JSX.Element | null {
  const line = useMemo<ClearingLine>(
    () => computeClearingLine(cards, levelRank, suggestOptions),
    [cards, levelRank, suggestOptions],
  );

  if (!enabled) return null;
  if (cards.length === 0 || cards.length > threshold) return null;

  return (
    <div className="endgame-assist" role="status" aria-live="polite">
      <span className="endgame-assist__label">收官线</span>
      {line.steps.length === 0 ? (
        <span className="endgame-assist__empty">暂无可出</span>
      ) : (
        <ol className="endgame-assist__steps">
          {line.steps.map((p, i) => (
            <li key={`${p.kind}-${p.rank}-${i}`} className="endgame-assist__step">
              {patternLabel(p)}
            </li>
          ))}
        </ol>
      )}
      {!line.complete && line.steps.length > 0 ? (
        <span className="endgame-assist__note">需手动调整</span>
      ) : null}
    </div>
  );
}

/**
 * Greedy clearing-line walk: repeatedly suggest the cheapest LEAD from the
 * remaining cards (target=null) and remove it, until empty or stuck.
 *
 * Removal is by card identity (rank+suit+deck), consuming each played card
 * once so double-deck duplicates are handled. The loop is bounded by hand
 * size (each step removes ≥1 card), so it always terminates.
 */
function computeClearingLine(
  hand: readonly Card[],
  levelRank: LevelRank,
  suggestOptions: SuggestOptions | undefined,
): ClearingLine {
  const steps: Pattern[] = [];
  let remaining = hand.slice();

  // Safety bound: at most hand.length steps (each removes ≥1 card).
  for (let guard = 0; guard < hand.length && remaining.length > 0; guard++) {
    const next = suggestMove(remaining, null, levelRank, suggestOptions);
    if (!next || next.cards.length === 0) {
      return { steps, complete: false };
    }
    steps.push(next);
    remaining = removeCards(remaining, next.cards);
  }

  return { steps, complete: remaining.length === 0 };
}

/** Remove each of `toRemove` once from `from`, by card identity. */
function removeCards(
  from: readonly Card[],
  toRemove: readonly Card[],
): Card[] {
  const out = from.slice();
  for (const rc of toRemove) {
    const i = out.findIndex(
      (c) => c.rank === rc.rank && c.suit === rc.suit && c.deck === rc.deck,
    );
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}
