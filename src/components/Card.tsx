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
}: CardProps): React.JSX.Element {
  const sizeClass = size === 'lg' ? 'card--lg' : size === 'md' ? 'card--md' : '';

  const classes = ['card', sizeClass];
  if (faceDown) classes.push('card--back');
  if (lifted) classes.push('card--lifted');
  if (isWildcard) classes.push('card--wild');
  if (card && !faceDown && isRed(card.suit)) classes.push('card--red');
  if (className) classes.push(className);

  if (faceDown || !card) {
    return (
      <div
        className={classes.filter(Boolean).join(' ')}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        aria-label={ariaLabel ?? (faceDown ? 'face-down card' : 'empty card slot')}
      />
    );
  }

  const rank = RANK_LABEL[card.rank];
  const glyph = suitGlyph(card);

  return (
    <div
      className={classes.filter(Boolean).join(' ')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={ariaLabel ?? defaultLabel(card)}
      data-rank={card.rank}
      data-suit={card.suit}
      data-deck={card.deck}
    >
      <span className="card__rank">{rank}</span>
      <span className="card__suit">{glyph}</span>
      <span className="card__center">{glyph}</span>
    </div>
  );
}
