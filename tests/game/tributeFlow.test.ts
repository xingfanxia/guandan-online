import { describe, expect, it } from 'vitest';
import { selectTributeCard, declareAntiTribute } from '@lib/game/tributeFlow';
import type { GameRound, PlayerSeat, PendingTributeState } from '@lib/game/round';
import type { Card } from '@lib/game/cards';

const SEATS_4P: PlayerSeat[] = [
  { id: 'a', team: 't1', position: 0 },
  { id: 'b', team: 't2', position: 1 },
  { id: 'c', team: 't1', position: 2 },
  { id: 'd', team: 't2', position: 3 },
];

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

function makeRound(
  handsByPos: Readonly<Record<string, readonly Card[]>>,
  pending: PendingTributeState,
): GameRound {
  const hands: Record<string, Card[]> = {};
  for (const seat of SEATS_4P) {
    hands[seat.id] = [...(handsByPos[seat.id] ?? [])];
  }
  return {
    mode: '4',
    level: '2',
    owner: null,
    seats: SEATS_4P,
    hands,
    leader: 'a', // provisional; finalize overrides
    phase: 'playing',
    finishOrder: [],
    currentTrick: null,
    pendingTribute: pending,
  };
}

describe('selectTributeCard — single tribute', () => {
  // finishOrder [a, b, c, d]: a wins (t1), b 2nd (t2), c 3rd (t1), d 4th (t2).
  // 2nd is on losing team → single tribute. d tributes to a; 末游 (d) leads.
  const pending: PendingTributeState = {
    mode: 'single',
    obligations: [{ from: 'd', to: 'a', selectedCard: null }],
    finishOrder: ['a', 'b', 'c', 'd'],
  };
  const aceSpades = c('spades', 'A');
  const handsBefore = {
    a: [c('clubs', '5'), c('clubs', '6')],
    b: [c('hearts', '5')],
    c: [c('clubs', '7')],
    d: [aceSpades, c('clubs', '3')],
  };

  it('finalizes the swap when the obligated loser picks a card', () => {
    const round = makeRound(handsBefore, pending);
    const result = selectTributeCard(round, 'd', aceSpades);
    const next = result.round;
    // Pending cleared
    expect(next.pendingTribute).toBeUndefined();
    // Finalization populated exchanges
    expect(result.exchanges).not.toBeNull();
    expect(result.exchanges!.length).toBe(1);
    expect(result.exchanges![0]!.from).toBe('d');
    expect(result.exchanges![0]!.to).toBe('a');
    // d lost the Ace; a gained it
    expect(next.hands['d']).not.toContainEqual(aceSpades);
    expect(next.hands['a']).toContainEqual(aceSpades);
    // a returned a low card (the 5 or 6, both ≤10). d gained it.
    expect(next.hands['a']!.length).toBe(2); // gained Ace, lost 1
    expect(next.hands['d']!.length).toBe(2); // lost Ace, gained 1
    // 末游 (d) leads
    expect(next.leader).toBe('d');
    // First trick started
    expect(next.currentTrick).not.toBeNull();
    expect(next.currentTrick?.currentPlayer).toBe('d');
  });

  it('rejects when the wrong player tries to select', () => {
    const round = makeRound(handsBefore, pending);
    expect(() => selectTributeCard(round, 'a', aceSpades)).toThrow(/no tribute obligation/);
  });

  it('rejects when the card is not in the loser hand', () => {
    const round = makeRound(handsBefore, pending);
    const notInHand = c('diamonds', 'K');
    expect(() => selectTributeCard(round, 'd', notInHand)).toThrow(/not in d's hand/);
  });

  it('rejects when the card is a wildcard (heart-suit level rank)', () => {
    const wildcard = c('hearts', '2'); // level=2; heart-suit level rank = wildcard
    const round = makeRound(
      { ...handsBefore, d: [wildcard, aceSpades] },
      pending,
    );
    expect(() => selectTributeCard(round, 'd', wildcard)).toThrow(/wildcard/);
  });

  it('rejects when there is no pendingTribute on the round', () => {
    const round = makeRound(handsBefore, pending);
    const stripped: GameRound = { ...round };
    delete (stripped as { pendingTribute?: PendingTributeState }).pendingTribute;
    expect(() => selectTributeCard(stripped, 'd', aceSpades)).toThrow(/no pending tribute/);
  });

  it('rejects when called against a resist-mode pending state', () => {
    const resistPending: PendingTributeState = {
      mode: 'resist',
      obligations: [],
      finishOrder: ['a', 'b', 'c', 'd'],
    };
    const round = makeRound(handsBefore, resistPending);
    expect(() => selectTributeCard(round, 'd', aceSpades)).toThrow(/resist mode/);
  });
});

describe('selectTributeCard — double tribute', () => {
  // finishOrder [a, c, b, d]: t1 swept top 2 → double. d→a, b→c. 末游 (d) leads.
  const pending: PendingTributeState = {
    mode: 'double',
    obligations: [
      { from: 'd', to: 'a', selectedCard: null },
      { from: 'b', to: 'c', selectedCard: null },
    ],
    finishOrder: ['a', 'c', 'b', 'd'],
  };
  const dAce = c('spades', 'A');
  const bKing = c('diamonds', 'K');
  const handsBefore = {
    a: [c('clubs', '3'), c('clubs', '4')],
    b: [bKing, c('hearts', '6')],
    c: [c('clubs', '5'), c('clubs', '7')],
    d: [dAce, c('clubs', '8')],
  };

  it('keeps pendingTribute when only one obligation is satisfied', () => {
    const round = makeRound(handsBefore, pending);
    const result = selectTributeCard(round, 'd', dAce);
    const after = result.round;
    // Not yet finalized — exchanges is null
    expect(result.exchanges).toBeNull();
    expect(after.pendingTribute).toBeDefined();
    expect(after.pendingTribute!.obligations).toHaveLength(2);
    expect(after.pendingTribute!.obligations[0]!.selectedCard).toEqual(dAce);
    expect(after.pendingTribute!.obligations[1]!.selectedCard).toBeNull();
    // No swap yet — hands unchanged
    expect(after.hands['d']).toContainEqual(dAce);
    expect(after.hands['a']).not.toContainEqual(dAce);
    expect(after.currentTrick).toBeNull();
  });

  it('finalizes when both obligations are satisfied (in either order)', () => {
    const round = makeRound(handsBefore, pending);
    const afterFirst = selectTributeCard(round, 'b', bKing).round;
    const finalResult = selectTributeCard(afterFirst, 'd', dAce);
    const afterSecond = finalResult.round;
    expect(afterSecond.pendingTribute).toBeUndefined();
    // Finalization populated exchanges (one per obligation, two for double)
    expect(finalResult.exchanges).not.toBeNull();
    expect(finalResult.exchanges!.length).toBe(2);
    // Both swaps happened
    expect(afterSecond.hands['a']).toContainEqual(dAce);
    expect(afterSecond.hands['c']).toContainEqual(bKing);
    // 末游 (d) leads
    expect(afterSecond.leader).toBe('d');
    expect(afterSecond.currentTrick).not.toBeNull();
  });

  it("rejects double-selection from the same player", () => {
    const round = makeRound(handsBefore, pending);
    const after = selectTributeCard(round, 'd', dAce).round;
    expect(() => selectTributeCard(after, 'd', dAce)).toThrow(/already selected/);
  });
});

describe('declareAntiTribute — resist mode', () => {
  // finishOrder [a, b, c, d]: a wins. t2 (b, d) hold both RJs in detect upstream.
  const pending: PendingTributeState = {
    mode: 'resist',
    obligations: [],
    finishOrder: ['a', 'b', 'c', 'd'],
  };
  const handsBefore = {
    a: [c('clubs', '5')],
    b: [c('joker', 'RJ')],
    c: [c('clubs', '6')],
    d: [c('joker', 'RJ', 2)],
  };

  it('finalizes with no swap when called by a losing-team player', () => {
    const round = makeRound(handsBefore, pending);
    const result = declareAntiTribute(round, 'd');
    const next = result.round;
    expect(next.pendingTribute).toBeUndefined();
    // Resist finalization emits an empty (but non-null) exchanges array.
    expect(result.exchanges).toEqual([]);
    // Hands unchanged
    expect(next.hands['a']).toEqual([c('clubs', '5')]);
    expect(next.hands['d']).toEqual([c('joker', 'RJ', 2)]);
    // 头游 (a) leads on resist
    expect(next.leader).toBe('a');
    expect(next.currentTrick).not.toBeNull();
    expect(next.currentTrick?.currentPlayer).toBe('a');
  });

  it('accepts the declaration from either losing-team player', () => {
    const round = makeRound(handsBefore, pending);
    const next = declareAntiTribute(round, 'b').round;
    expect(next.pendingTribute).toBeUndefined();
    expect(next.leader).toBe('a');
  });

  it('rejects when called by a winning-team player', () => {
    const round = makeRound(handsBefore, pending);
    expect(() => declareAntiTribute(round, 'a')).toThrow(
      /winning team and cannot declare resist/,
    );
    expect(() => declareAntiTribute(round, 'c')).toThrow(
      /winning team and cannot declare resist/,
    );
  });

  it('rejects when the pending mode is not resist', () => {
    const singlePending: PendingTributeState = {
      mode: 'single',
      obligations: [{ from: 'd', to: 'a', selectedCard: null }],
      finishOrder: ['a', 'b', 'c', 'd'],
    };
    const round = makeRound(handsBefore, singlePending);
    expect(() => declareAntiTribute(round, 'd')).toThrow(/only valid in resist mode/);
  });

  it('rejects when there is no pendingTribute on the round', () => {
    const round = makeRound(handsBefore, pending);
    const stripped: GameRound = { ...round };
    delete (stripped as { pendingTribute?: PendingTributeState }).pendingTribute;
    expect(() => declareAntiTribute(stripped, 'd')).toThrow(/no pending tribute/);
  });
});
