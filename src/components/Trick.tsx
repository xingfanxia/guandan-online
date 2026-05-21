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
          {patternLabel && <span className="trick__kind">{patternLabel}</span>}
          {authorHandle && <span className="trick__author">{authorHandle}</span>}
        </div>
      )}
    </div>
  );
}
