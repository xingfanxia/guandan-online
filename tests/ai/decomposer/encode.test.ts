import { describe, it, expect } from 'vitest';
import type { Card } from '@lib/game/cards';
import { encodeCard, encodeHand, rankToBobgyChar } from '@lib/ai/decomposer/encode';

const c = (rank: Card['rank'], suit: Card['suit'], deck: Card['deck'] = 1): Card => ({ rank, suit, deck });

describe('rankToBobgyChar', () => {
  it('maps 10 → 0 (single-char encoding for 10)', () => {
    expect(rankToBobgyChar('10')).toBe('0');
  });

  it('maps BJ → XB and RJ → XR (joker codes)', () => {
    expect(rankToBobgyChar('BJ')).toBe('XB');
    expect(rankToBobgyChar('RJ')).toBe('XR');
  });

  it('passes through natural ranks 2-9, J, Q, K, A', () => {
    for (const r of ['2', '3', '4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A'] as const) {
      expect(rankToBobgyChar(r)).toBe(r);
    }
  });
});

describe('encodeCard', () => {
  it('encodes naturals with rank + suit char (rank first)', () => {
    expect(encodeCard(c('A', 'spades'))).toBe('AS');
    expect(encodeCard(c('K', 'hearts'))).toBe('KH');
    expect(encodeCard(c('Q', 'clubs'))).toBe('QC');
    expect(encodeCard(c('J', 'diamonds'))).toBe('JD');
  });

  it('encodes 10 as 0 prefix', () => {
    expect(encodeCard(c('10', 'spades'))).toBe('0S');
    expect(encodeCard(c('10', 'hearts'))).toBe('0H');
  });

  it('encodes jokers as XB / XR (suit ignored — both are joker)', () => {
    expect(encodeCard(c('BJ', 'joker'))).toBe('XB');
    expect(encodeCard(c('RJ', 'joker'))).toBe('XR');
  });

  it('ignores deck id (Bobgy wire format has no deck slot)', () => {
    expect(encodeCard(c('A', 'spades', 1))).toBe('AS');
    expect(encodeCard(c('A', 'spades', 2))).toBe('AS');
  });
});

describe('encodeHand', () => {
  it('packs cards with NO separator (Bobgy walks 2-char chunks)', () => {
    const hand: Card[] = [c('A', 'spades'), c('K', 'hearts'), c('10', 'clubs')];
    expect(encodeHand(hand)).toBe('ASKH0C');
  });

  it('encodes empty hand as empty string', () => {
    expect(encodeHand([])).toBe('');
  });

  it('encodes mixed hand with jokers', () => {
    const hand: Card[] = [
      c('2', 'hearts'),
      c('2', 'hearts', 2),
      c('BJ', 'joker'),
      c('RJ', 'joker'),
    ];
    expect(encodeHand(hand)).toBe('2H2HXBXR');
  });
});
