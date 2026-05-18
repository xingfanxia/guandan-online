import { describe, expect, it } from 'vitest';
import { decodeCardId, encodeCard, encodeCards, decodeCardIds } from '@lib/realtime/cardCodec';
import type { Card } from '@lib/game/cards';

describe('encodeCard — wire format `<rank>-<suit>-<deck>`', () => {
  it('encodes a natural card', () => {
    expect(encodeCard({ suit: 'spades', rank: '7', deck: 1 })).toBe('7-S-1');
    expect(encodeCard({ suit: 'hearts', rank: 'A', deck: 2 })).toBe('A-H-2');
    expect(encodeCard({ suit: 'clubs', rank: '10', deck: 1 })).toBe('10-C-1');
    expect(encodeCard({ suit: 'diamonds', rank: 'K', deck: 2 })).toBe('K-D-2');
  });

  it('encodes a joker — suit is "J", rank is BJ/RJ', () => {
    expect(encodeCard({ suit: 'joker', rank: 'BJ', deck: 1 })).toBe('BJ-J-1');
    expect(encodeCard({ suit: 'joker', rank: 'RJ', deck: 2 })).toBe('RJ-J-2');
  });
});

describe('decodeCardId — inverse of encodeCard', () => {
  it('decodes a natural card', () => {
    expect(decodeCardId('7-S-1')).toEqual({ suit: 'spades', rank: '7', deck: 1 });
    expect(decodeCardId('A-H-2')).toEqual({ suit: 'hearts', rank: 'A', deck: 2 });
    expect(decodeCardId('10-C-1')).toEqual({ suit: 'clubs', rank: '10', deck: 1 });
  });

  it('decodes a joker', () => {
    expect(decodeCardId('BJ-J-1')).toEqual({ suit: 'joker', rank: 'BJ', deck: 1 });
    expect(decodeCardId('RJ-J-2')).toEqual({ suit: 'joker', rank: 'RJ', deck: 2 });
  });

  it('throws on malformed strings', () => {
    expect(() => decodeCardId('')).toThrow();
    expect(() => decodeCardId('not-a-card')).toThrow();
    expect(() => decodeCardId('5-S')).toThrow(); // missing deck
    expect(() => decodeCardId('5-X-1')).toThrow(/suit/); // bad suit
    expect(() => decodeCardId('5-S-3')).toThrow(/deck/); // bad deck
    expect(() => decodeCardId('Z-S-1')).toThrow(/rank/); // bad rank
  });
});

describe('encodeCard / decodeCardId — round-trip property', () => {
  const samples: Card[] = [
    { suit: 'spades', rank: '2', deck: 1 },
    { suit: 'hearts', rank: '10', deck: 2 },
    { suit: 'clubs', rank: 'J', deck: 1 },
    { suit: 'diamonds', rank: 'A', deck: 2 },
    { suit: 'joker', rank: 'BJ', deck: 1 },
    { suit: 'joker', rank: 'RJ', deck: 2 },
  ];

  it('decodeCardId(encodeCard(c)) === c for every canonical card', () => {
    for (const card of samples) {
      expect(decodeCardId(encodeCard(card))).toEqual(card);
    }
  });
});

describe('encodeCards / decodeCardIds — array helpers', () => {
  it('round-trips an array of cards', () => {
    const arr: Card[] = [
      { suit: 'spades', rank: '5', deck: 1 },
      { suit: 'hearts', rank: 'K', deck: 2 },
    ];
    const encoded = encodeCards(arr);
    expect(encoded).toEqual(['5-S-1', 'K-H-2']);
    expect(decodeCardIds(encoded)).toEqual(arr);
  });

  it('handles empty array', () => {
    expect(encodeCards([])).toEqual([]);
    expect(decodeCardIds([])).toEqual([]);
  });
});
