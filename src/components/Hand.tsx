// Hand — overlapping row of cards.
//
// CSS contract: .hand element from src/styles/components.css uses negative
// margin-left to overlap cards. First child has margin-left: 0. Lifted state
// applied per-card via Card's `lifted` prop.

import { Card as CardComponent, type CardSize } from './Card.js';
import { isWildcard, type Card as GameCard } from '@lib/game/cards';
import type { LevelRank } from '@lib/game/levels';

export interface HandProps {
  cards: readonly GameCard[];
  /** Current level rank — used to detect wildcards (红心级牌). */
  levelRank: LevelRank;
  /** Indices currently selected/lifted. */
  liftedIndices?: ReadonlySet<number>;
  /** Toggle a card lift by clicking. */
  onCardClick?: (index: number, card: GameCard) => void;
  size?: CardSize;
  /** Hidden hand (opponent view) — renders card-backs. */
  faceDown?: boolean;
  /** Optional aria label for the hand container. */
  ariaLabel?: string;
}

export function Hand({
  cards,
  levelRank,
  liftedIndices,
  onCardClick,
  size = 'sm',
  faceDown = false,
  ariaLabel,
}: HandProps): React.JSX.Element {
  return (
    <div
      className="hand"
      role="group"
      aria-label={ariaLabel ?? `hand of ${cards.length} cards`}
    >
      {cards.map((card, idx) => (
        <CardComponent
          key={`${card.suit}-${card.rank}-${card.deck}-${idx}`}
          card={card}
          faceDown={faceDown}
          size={size}
          lifted={liftedIndices?.has(idx) ?? false}
          isWildcard={!faceDown && isWildcard(card, levelRank)}
          onClick={onCardClick ? () => onCardClick(idx, card) : undefined}
        />
      ))}
    </div>
  );
}
