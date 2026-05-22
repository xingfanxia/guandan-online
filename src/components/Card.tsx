// Card primitive — single playing-card view.
//
// Pure presentational: takes a Card (per lib/game/cards.ts) + size + state flags.
// Rendering follows demos/index.html S03 markup: corner rank + suit, center suit glyph.
// Wildcard treatment (gold edge + ★ corner) is applied when `isWildcard` prop is true;
// the caller (typically Hand) computes it via isWildcard(card, levelRank).

import type { Card as GameCard, NaturalSuit, Rank } from '@lib/game/cards';

export type CardSize = 'sm' | 'md' | 'lg';

export interface CardProps {
  card?: GameCard;
  /** When true, renders a card-back (no rank/suit visible). Ignores `card`. */
  faceDown?: boolean;
  size?: CardSize;
  /** Highlighted/selected state — translateY(-12px) per .card--lifted. */
  lifted?: boolean;
  /** Wildcard treatment (gold edge + ★). Caller computes per current level. */
  isWildcard?: boolean;
  /** Optional click handler (tap to lift / play). */
  onClick?: () => void;
  /** Optional aria label override. Default derived from rank+suit. */
  ariaLabel?: string;
  /** Optional className passthrough (rare; prefer props). */
  className?: string;
  /**
   * Override the default `<button>` tabIndex. Used by Hand.tsx to implement
   * roving-tabindex — only the currently-focused card has tabIndex=0, all
   * others have -1. Without this override, every card in a hand becomes a
   * tab stop (27 stops for a 4P deal), creating noisy keyboard navigation
   * (Round 2 MINOR-2 fix).
   *
   * Default behavior (undefined) preserves the prior native `<button>`
   * tabIndex=0 contract.
   */
  tabIndex?: number;
  /**
   * Optional ref to the underlying focusable button element. Used by Hand
   * to programmatically focus the next/prev card on arrow-key navigation.
   */
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  /**
   * Optional keyboard handler. Hand uses this to implement arrow-key
   * navigation across the roving-tabindex hand without wrapping cards in
   * extra DOM (which would break the .hand .card:first-child CSS selector).
   */
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
}

const SUIT_GLYPH: Record<NaturalSuit, string> = {
  spades: '♠',
  hearts: '♥',
  clubs: '♣',
  diamonds: '♦',
};

const RANK_LABEL: Record<Rank, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8',
  '9': '9', '10': '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
  BJ: 'Jr', // small joker — Geist-renderable label; CSS gives center glyph
  RJ: 'JR',
};

function isRed(suit: GameCard['suit']): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

function suitGlyph(card: GameCard): string {
  if (card.suit === 'joker') {
    return card.rank === 'RJ' ? '★' : '☆';
  }
  return SUIT_GLYPH[card.suit];
}

function defaultLabel(card: GameCard): string {
  if (card.suit === 'joker') {
    return card.rank === 'RJ' ? '大王' : '小王';
  }
  return `${RANK_LABEL[card.rank]} of ${card.suit}`;
}

export function Card({
  card,
  faceDown = false,
  size = 'sm',
  lifted = false,
  isWildcard = false,
  onClick,
  ariaLabel,
  className,
  tabIndex,
  buttonRef,
  onKeyDown,
}: CardProps): React.JSX.Element {
  const sizeClass = size === 'lg' ? 'card--lg' : size === 'md' ? 'card--md' : '';

  const classes = ['card', sizeClass];
  if (faceDown) classes.push('card--back');
  if (lifted) classes.push('card--lifted');
  if (isWildcard) classes.push('card--wild');
  if (card && !faceDown && isRed(card.suit)) classes.push('card--red');
  if (className) classes.push(className);

  // When onClick is present we render a real <button> so keyboard users get
  // Tab focus + Enter/Space activation for free (WCAG SC 2.1.1). Otherwise
  // we render a <div> for layout-only cards (face-down opp hands, decorative
  // trick cards). The `card--button` class lets components.css strip the
  // browser's default button styling (border/padding) without affecting the
  // pure-div variant.
  const finalClassName = classes.filter(Boolean).join(' ');
  const computedLabel = ariaLabel ?? (faceDown ? 'face-down card' : card ? defaultLabel(card) : 'empty card slot');

  if (faceDown || !card) {
    if (onClick) {
      return (
        <button
          type="button"
          className={`${finalClassName} card--button`}
          onClick={onClick}
          aria-label={computedLabel}
          {...(tabIndex !== undefined ? { tabIndex } : {})}
          {...(buttonRef ? { ref: buttonRef } : {})}
          {...(onKeyDown ? { onKeyDown } : {})}
        />
      );
    }
    return <div className={finalClassName} aria-label={computedLabel} />;
  }

  const rank = RANK_LABEL[card.rank];
  const glyph = suitGlyph(card);
  const children = (
    <>
      <span className="card__rank">{rank}</span>
      <span className="card__suit">{glyph}</span>
      <span className="card__center">{glyph}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`${finalClassName} card--button`}
        onClick={onClick}
        aria-label={computedLabel}
        data-rank={card.rank}
        data-suit={card.suit}
        data-deck={card.deck}
        {...(tabIndex !== undefined ? { tabIndex } : {})}
        {...(buttonRef ? { ref: buttonRef } : {})}
        {...(onKeyDown ? { onKeyDown } : {})}
      >
        {children}
      </button>
    );
  }
  return (
    <div
      className={finalClassName}
      aria-label={computedLabel}
      data-rank={card.rank}
      data-suit={card.suit}
      data-deck={card.deck}
    >
      {children}
    </div>
  );
}
