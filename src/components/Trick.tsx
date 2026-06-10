// Trick — center area showing the most-recent played combination.
//
// Uses .played-stack CSS class for tighter overlap (8px vs hand's 12px).
// Renders the lead/follow author + pattern kind label below the stack.

import { Card as CardView, type CardSize } from './Card.js';
import { isWildcard, type Card as GameCard } from '@lib/game/cards';
import type { LevelRank } from '@lib/game/levels';

export interface TrickProps {
  /** Cards from the most-recent play. Empty array = no play yet (lead position). */
  cards: readonly GameCard[];
  /** Display handle of the player who made the play. */
  authorHandle?: string;
  /** Pattern kind label, e.g. "对子", "顺子", "炸弹". */
  patternLabel?: string;
  /** Current level for wildcard detection. */
  levelRank: LevelRank;
  /** Card render size. Defaults to 'md' (more readable in trick area). */
  size?: CardSize;
}

/**
 * Server combinationLabel carries the raw PatternKind discriminator
 * (lib/game/patterns.ts). Localize at the render boundary; unknown values
 * pass through verbatim so new kinds degrade readably instead of blanking.
 */
const PATTERN_LABEL_ZH: Record<string, string> = {
  single: '单张',
  pair: '对子',
  triple: '三张',
  fullHouse: '三带二',
  threePairs: '三连对',
  twoTriples: '钢板',
  straight: '顺子',
  flushStraight: '同花顺',
  bomb: '炸弹',
  jokerBomb: '王炸',
  unknown: '—',
};

export function localizePatternLabel(label: string | undefined): string | undefined {
  if (!label) return label;
  return PATTERN_LABEL_ZH[label] ?? label;
}

export function Trick({
  cards,
  authorHandle,
  patternLabel,
  levelRank,
  size = 'md',
}: TrickProps): React.JSX.Element {
  if (cards.length === 0) {
    return (
      <div className="trick trick--empty" role="region" aria-label="trick area, no play yet">
        <span className="trick__placeholder">—</span>
      </div>
    );
  }

  return (
    <div className="trick" role="region" aria-label="trick area">
      <div className="played-stack">
        {cards.map((card, idx) => (
          <CardView
            key={`${card.suit}-${card.rank}-${card.deck}-${idx}`}
            card={card}
            size={size}
            isWildcard={isWildcard(card, levelRank)}
          />
        ))}
      </div>
      {(authorHandle || patternLabel) && (
        <div className="trick__meta">
          {patternLabel && <span className="trick__kind">{localizePatternLabel(patternLabel)}</span>}
          {authorHandle && <span className="trick__author">{authorHandle}</span>}
        </div>
      )}
    </div>
  );
}
