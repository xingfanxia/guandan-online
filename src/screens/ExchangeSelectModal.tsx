// ExchangeSelectModal — shown to ALL players during EXCHANGE-1's select phase
// (after the losing-team vote passes). Each player picks exactly `cardCount`
// cards from their hand to give away; the server routes them to the next
// player in the swap `direction`.
//
// Mirrors TributeModal's pick-shelf (tap-to-toggle cards) but multi-select with
// an exact-count gate: 确认 is disabled until exactly `cardCount` cards are
// chosen. The direction (顺时针 / 逆时针) is surfaced so the player knows who
// receives their cards.
//
// Purely props-driven. Local state holds only the set of chosen card keys.

import { useState } from 'react';
import { Card } from '@/components/Card';
import type { Card as GameCard } from '@lib/game/cards';

export interface ExchangeSelectModalProps {
  /** The player's full hand. */
  hand: readonly GameCard[];
  /** Exact number of cards the player must choose. */
  cardCount: number;
  /** Swap direction — 'cw' = 顺时针 (give to next clockwise seat). */
  direction: 'cw' | 'ccw';
  /** Fired with the chosen cards once exactly `cardCount` are selected + confirmed. */
  onSelect: (cards: GameCard[]) => void;
  /** Disable selection + confirm while a submit is in flight. */
  busy?: boolean;
}

export function ExchangeSelectModal({
  hand,
  cardCount,
  direction,
  onSelect,
  busy = false,
}: ExchangeSelectModalProps): React.JSX.Element {
  const [chosenKeys, setChosenKeys] = useState<ReadonlySet<string>>(new Set());

  const toggle = (key: string): void => {
    setChosenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < cardCount) {
        // Cap selection at cardCount — extra taps are no-ops until the player
        // deselects something. Keeps the confirm gate unambiguous.
        next.add(key);
      }
      return next;
    });
  };

  const chosenCards = hand.filter((c) => chosenKeys.has(cardKey(c)));
  const ready = chosenKeys.size === cardCount;
  const directionLabel = direction === 'cw' ? '顺时针' : '逆时针';

  return (
    <div
      className="tribute-veil"
      role="dialog"
      aria-modal="true"
      aria-label="换牌 · 选牌"
    >
      <div className="exchange-modal exchange-modal--select">
        <header className="tribute-head">
          <div>
            <div className="tribute-eyebrow">换牌阶段 · 选牌</div>
            <h2 className="tribute-title">
              选 <em>{cardCount}</em> 张牌交换（{directionLabel}给下家）
            </h2>
          </div>
          <span className="chip chip--accent mono">
            {chosenKeys.size}/{cardCount}
          </span>
        </header>
        <p className="tribute-lede">
          按 {directionLabel}方向，你选的牌将发给下一位玩家。tap 选择，选满 {cardCount} 张后确认。
        </p>
        <div className="tribute-pick-shelf" role="listbox" aria-label="手牌">
          {hand.map((c) => {
            const key = cardKey(c);
            const lifted = chosenKeys.has(key);
            // Cards beyond the cap (when not already chosen) render disabled so
            // the player can't exceed cardCount.
            const blocked = !lifted && chosenKeys.size >= cardCount;
            return (
              <button
                key={key}
                type="button"
                className="tribute-pick-card"
                disabled={busy || blocked}
                onClick={() => toggle(key)}
                role="option"
                aria-selected={lifted}
                aria-label={`${c.rank} of ${c.suit}`}
              >
                <Card card={c} size="md" lifted={lifted} />
              </button>
            );
          })}
        </div>
        <div className="tribute-actions">
          <span className="tribute-actions__hint">
            {ready
              ? `已选 ${cardCount} 张`
              : `还需选 ${cardCount - chosenKeys.size} 张`}
          </span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!ready || busy}
            onClick={() => {
              if (ready) onSelect(chosenCards);
            }}
            aria-label="确认换牌"
          >
            {ready ? `确认交换 ${cardCount} 张 →` : '确认交换'}
          </button>
        </div>
      </div>
    </div>
  );
}

function cardKey(c: GameCard): string {
  return `${c.rank}-${c.suit}-${c.deck}`;
}
