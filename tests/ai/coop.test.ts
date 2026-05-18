import { describe, it, expect } from 'vitest';
import { decidePartnerCoop, rankByCoop, type CoopContext } from '@lib/ai/coop';
import type { Pattern } from '@lib/game/patterns';
import type { Card } from '@lib/game/cards';

const c = (rank: Card['rank'], suit: Card['suit'], deck: Card['deck'] = 1): Card => ({ rank, suit, deck });

const pair5: Pattern = { kind: 'pair', rank: '5', length: 2, cards: [c('5', 'hearts'), c('5', 'spades')] };
const pair10: Pattern = { kind: 'pair', rank: '10', length: 2, cards: [c('10', 'hearts'), c('10', 'spades')] };
const bomb4: Pattern = {
  kind: 'bomb', rank: '7', length: 4,
  cards: [c('7', 'hearts'), c('7', 'spades'), c('7', 'clubs'), c('7', 'diamonds')],
};
const jokerBomb: Pattern = {
  kind: 'jokerBomb', rank: null, length: 4,
  cards: [c('BJ', 'joker', 1), c('BJ', 'joker', 2), c('RJ', 'joker', 1), c('RJ', 'joker', 2)],
};

const baseCtx: CoopContext = {
  lastPlayer: 'opp1',
  me: 'me',
  partner: 'partner',
  partnerHandCount: 12,
  opponentHandCounts: [12, 13],
  levelRank: '2',
  myHandCount: 14,
};

describe('decidePartnerCoop', () => {
  it('defers when partner just led / last played', () => {
    expect(decidePartnerCoop({ ...baseCtx, lastPlayer: 'partner' })).toEqual({ kind: 'defer' });
  });

  it('covers when partner near out (≤4) and opponent far behind (≥8)', () => {
    expect(decidePartnerCoop({
      ...baseCtx,
      partnerHandCount: 3,
      opponentHandCounts: [10, 11],
    })).toEqual({ kind: 'cover' });
  });

  it('competes when opponent already close to out', () => {
    expect(decidePartnerCoop({
      ...baseCtx,
      partnerHandCount: 2,
      opponentHandCounts: [4, 5],
    })).toEqual({ kind: 'compete' });
  });

  it('competes by default', () => {
    expect(decidePartnerCoop(baseCtx)).toEqual({ kind: 'compete' });
  });
});

describe('rankByCoop', () => {
  it('defer: drops bombs and jokerBombs, returns sorted non-bomb plays', () => {
    const ranked = rankByCoop([jokerBomb, pair10, bomb4, pair5], { kind: 'defer' }, '2');
    expect(ranked.find((p) => p.kind === 'bomb')).toBeUndefined();
    expect(ranked.find((p) => p.kind === 'jokerBomb')).toBeUndefined();
    expect(ranked[0]).toBe(pair5); // cheaper rank first
  });

  it('defer: falls back to original list when ALL plays are bombs', () => {
    const ranked = rankByCoop([bomb4, jokerBomb], { kind: 'defer' }, '2');
    expect(ranked).toHaveLength(2);
  });

  it('cover: drops jokerBombs only', () => {
    const ranked = rankByCoop([jokerBomb, pair10, bomb4, pair5], { kind: 'cover' }, '2');
    expect(ranked.find((p) => p.kind === 'jokerBomb')).toBeUndefined();
    expect(ranked).toContain(bomb4);
  });

  it('compete: returns sorted by cost ascending', () => {
    const ranked = rankByCoop([pair10, pair5], { kind: 'compete' }, '2');
    expect(ranked[0]).toBe(pair5);
    expect(ranked[1]).toBe(pair10);
  });
});
