// Hand — overlapping row of cards.
//
// CSS contract: .hand element from src/styles/components.css uses negative
// margin-left to overlap cards. First child has margin-left: 0. Lifted state
// applied per-card via Card's `lifted` prop.
//
// Round 2 MINOR-2 — roving tabindex. With 27 cards per hand, having every card
// be a tab stop creates noisy keyboard navigation. We expose only the currently
// focused index as a tab stop (tabIndex=0); the rest are -1. ArrowLeft / Right
// move focus within the hand; Tab from any card exits to the next focusable
// element on the page.

import { useEffect, useRef, useState } from 'react';
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
  // Roving-tabindex state. Only the card at `focusedIndex` carries tabIndex=0;
  // all others carry -1. ArrowLeft / Right cycle focus across cards in the hand.
  //
  // When the hand changes (cards added / removed), keep focusedIndex within
  // bounds — clamp to last valid index, or 0 for empty/single-card hands.
  const [focusedIndex, setFocusedIndex] = useState(0);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    // Clamp focusedIndex when hand size shrinks.
    if (focusedIndex >= cards.length && cards.length > 0) {
      setFocusedIndex(cards.length - 1);
    }
  }, [cards.length, focusedIndex]);

  // Ensure refs array length tracks cards length. Excess refs (after shrink)
  // are harmless but trimming keeps the array tidy.
  if (cardRefs.current.length !== cards.length) {
    cardRefs.current.length = cards.length;
  }

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    if (cards.length === 0) return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    // Clamp at edges (don't wrap) — wrap-around can confuse screen readers
    // and makes "Tab away" semantics less predictable.
    const next = Math.min(cards.length - 1, Math.max(0, idx + delta));
    setFocusedIndex(next);
    cardRefs.current[next]?.focus();
  };

  // We want a focused index AND a way to programmatically focus the next/
  // previous card. Card accepts onKeyDown directly (the handler is attached
  // to the underlying <button>) so we don't need a wrapper element, which
  // would otherwise break the .hand > .card:first-child CSS selector that
  // resets the negative margin for the leftmost card.
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
          tabIndex={idx === focusedIndex ? 0 : -1}
          buttonRef={{
            get current() {
              return cardRefs.current[idx] ?? null;
            },
            set current(el) {
              cardRefs.current[idx] = el;
            },
          } as React.RefObject<HTMLButtonElement | null>}
          onKeyDown={(e) => handleKeyDown(e, idx)}
        />
      ))}
    </div>
  );
}
