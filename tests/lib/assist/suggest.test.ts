import { describe, it, expect, vi } from 'vitest';
import { suggestMove } from '@/lib/assist/suggest';
import type { Card } from '@lib/game/cards';
import type { Pattern } from '@lib/game/patterns';
import { analyzeHand } from '@lib/game/patterns';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

// Helper: build a Pattern from cards via the real engine (guarantees validity).
function pat(cards: Card[], level: Parameters<typeof analyzeHand>[1] = '2'): Pattern {
  const p = analyzeHand(cards, level);
  if (!p) throw new Error('test fixture is not a valid pattern');
  return p;
}

describe('suggestMove — null cases', () => {
  it('returns null for an empty hand', () => {
    expect(suggestMove([], null, '2')).toBeNull();
  });

  it('returns null when a follower has no legal beat', () => {
    // Hand of low singles vs a target pair → no legal pair to follow.
    const hand: Card[] = [c('spades', '3'), c('clubs', '4'), c('diamonds', '5')];
    const target = pat([c('hearts', 'K'), c('spades', 'K', 2)]);
    expect(suggestMove(hand, target, '2')).toBeNull();
  });
});

describe('suggestMove — follower', () => {
  it('returns a legal pattern that beats the target', () => {
    const hand: Card[] = [
      c('spades', 'A'),
      c('clubs', 'A', 2),
      c('diamonds', '4'),
    ];
    const target = pat([c('hearts', '9'), c('spades', '9', 2)]);
    const move = suggestMove(hand, target, '2');
    expect(move).not.toBeNull();
    expect(move!.kind).toBe('pair');
    expect(move!.rank).toBe('A'); // the A-pair beats the 9-pair
  });

  it('picks the CHEAPEST beat when several exist (inject enumerator)', () => {
    const hand: Card[] = [c('spades', '9'), c('clubs', 'A')];
    const target = pat([c('hearts', '6')]);
    // Two legal singles: 9 (cheaper) and A (pricier). Suggest must take the 9.
    const single9 = pat([c('spades', '9')]);
    const singleA = pat([c('clubs', 'A')]);
    const enumerate = vi.fn(() => [singleA, single9]); // return pricey first
    const move = suggestMove(hand, target, '2', { enumerate });
    expect(move!.rank).toBe('9');
    expect(enumerate).toHaveBeenCalledWith(hand, target, '2');
  });

  it('prefers a finisher that empties the hand over a cheaper non-finisher', () => {
    // Follower holding exactly a pair that both beats the target AND is the
    // whole hand → must recommend it (going out).
    const hand: Card[] = [c('spades', 'K'), c('clubs', 'K', 2)];
    const target = pat([c('hearts', '5'), c('spades', '5', 2)]);
    const move = suggestMove(hand, target, '2');
    expect(move!.cards.length).toBe(hand.length);
    expect(move!.rank).toBe('K');
  });
});

describe('suggestMove — leader', () => {
  it('leads the cheapest non-bomb (preserve high/bomb cards)', () => {
    const hand: Card[] = [
      c('spades', '3'),
      c('clubs', 'A'),
      c('spades', '9'),
      c('clubs', '9', 2),
      c('diamonds', '9', 1),
      c('hearts', '9', 2),
    ];
    // Legal leads include a 9-bomb (4×9) and low singles. Leader should NOT
    // open with the bomb; cheapest non-bomb is the single 3.
    const move = suggestMove(hand, null, '2');
    expect(move).not.toBeNull();
    expect(move!.kind).toBe('single');
    expect(move!.rank).toBe('3');
  });

  it('leads a one-shot finisher when the whole hand is a single combo', () => {
    const hand: Card[] = [c('spades', 'Q'), c('clubs', 'Q', 2)];
    const move = suggestMove(hand, null, '2');
    expect(move!.cards.length).toBe(2);
    expect(move!.kind).toBe('pair');
  });

  it('falls back to cheapest overall when only bombs are legal', () => {
    // Hand is a single 4-bomb — the only legal lead is the bomb itself, which
    // is also the finisher.
    const hand: Card[] = [
      c('spades', '8'),
      c('clubs', '8', 2),
      c('diamonds', '8', 1),
      c('hearts', '8', 2),
    ];
    const move = suggestMove(hand, null, '2');
    expect(move!.kind).toBe('bomb');
    expect(move!.cards.length).toBe(4);
  });

  it('returns null when the injected enumerator yields no plays', () => {
    const enumerate = vi.fn(() => [] as Pattern[]);
    const hand: Card[] = [c('spades', '3')];
    expect(suggestMove(hand, null, '2', { enumerate })).toBeNull();
  });
});
