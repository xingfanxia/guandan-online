// SuggestionHint — "提示" surface. Computes the recommended play for the
// current hand + trick target and renders a caption ("建议: 一对 7"), plus
// the suggested cards highlighted.
//
// It maps the suggested Pattern's cards back to flat hand indices (by card
// identity: rank+suit+deck), so the caller can lift exactly those cards in the
// shared <Hand /> render. The indices are surfaced two ways:
//   1. onSuggest(indices, pattern) callback — fired whenever the suggestion
//      changes, letting the parent set liftedIndices / pre-stage a play.
//   2. A read-only caption + suited card chips rendered inline.
//
// When no legal play exists (empty hand, or follower with nothing to beat the
// target) the caption shows "建议: 过牌" (pass) and onSuggest fires with [].
//
// Pure aside from the suggestion compute (delegated to suggestMove, which is
// itself pure + dependency-injectable). No SSE, no network.

import { useEffect, useMemo } from 'react';
import type { Card } from '@lib/game/cards';
import type { Pattern } from '@lib/game/patterns';
import type { LevelRank } from '@lib/game/levels';
import { suggestMove, type SuggestOptions } from '@/lib/assist/suggest';
import { patternLabel, cardLabel } from '@/lib/assist/patternLabel';

export interface SuggestionHintProps {
  cards: readonly Card[];
  /** Trick to beat; null when leading. */
  target: Pattern | null;
  levelRank: LevelRank;
  /**
   * Fired whenever the computed suggestion changes. `indices` are flat hand
   * indices to lift; empty array means "pass" (no legal play). `pattern` is
   * null on a pass.
   */
  onSuggest?: (indices: number[], pattern: Pattern | null) => void;
  /** Inject the enumerator (tests). */
  suggestOptions?: SuggestOptions;
}

export function SuggestionHint({
  cards,
  target,
  levelRank,
  onSuggest,
  suggestOptions,
}: SuggestionHintProps): React.JSX.Element {
  const pattern = useMemo(
    () => suggestMove(cards, target, levelRank, suggestOptions),
    [cards, target, levelRank, suggestOptions],
  );

  const indices = useMemo(
    () => (pattern ? mapToIndices(cards, pattern.cards) : []),
    [cards, pattern],
  );

  // Notify the parent when the suggestion changes so it can lift the cards.
  useEffect(() => {
    onSuggest?.(indices, pattern);
  }, [onSuggest, indices, pattern]);

  const caption = pattern ? patternLabel(pattern) : '过牌';

  return (
    <div className="suggestion-hint" role="status" aria-live="polite">
      <span className="suggestion-hint__label">建议</span>
      <span className="suggestion-hint__value">{caption}</span>
      {pattern ? (
        <span className="suggestion-hint__cards" aria-hidden="true">
          {pattern.cards.map((c, i) => (
            <span key={`${c.rank}-${c.suit}-${c.deck}-${i}`} className="suggestion-hint__chip">
              {cardLabel(c)}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Map a pattern's cards back to indices in the hand. Greedy: each pattern card
 * consumes the first not-yet-consumed hand card with identical (rank,suit,deck).
 * Handles duplicate cards (double deck) without double-counting an index.
 */
function mapToIndices(
  hand: readonly Card[],
  patternCards: readonly Card[],
): number[] {
  const used = new Set<number>();
  const out: number[] = [];
  for (const pc of patternCards) {
    for (let i = 0; i < hand.length; i++) {
      if (used.has(i)) continue;
      const h = hand[i]!;
      if (h.rank === pc.rank && h.suit === pc.suit && h.deck === pc.deck) {
        used.add(i);
        out.push(i);
        break;
      }
    }
  }
  return out;
}
