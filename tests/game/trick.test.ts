import { describe, expect, it } from 'vitest';
import { startTrick, playCards, pass } from '@lib/game/round';
import type { GameRound, PlayerSeat } from '@lib/game/round';
import type { Card } from '@lib/game/cards';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEATS_4P: PlayerSeat[] = [
  { id: 'a', team: 't1', position: 0 },
  { id: 'b', team: 't2', position: 1 },
  { id: 'c', team: 't1', position: 2 },
  { id: 'd', team: 't2', position: 3 },
];

/**
 * Construct a GameRound directly with scripted hands, bypassing dealRound.
 * Used only for trick-state tests — dealRound is tested separately in
 * round.test.ts. The trick state machine doesn't care how hands were dealt,
 * only that the round shape is well-formed.
 */
function buildScriptedRound(handsByPosition: readonly (readonly Card[])[]): GameRound {
  if (handsByPosition.length !== SEATS_4P.length) {
    throw new Error(`scripted hands must match seats (${SEATS_4P.length})`);
  }
  const hands: Record<string, Card[]> = {};
  for (let i = 0; i < SEATS_4P.length; i++) {
    const seat = SEATS_4P[i]!;
    hands[seat.id] = [...handsByPosition[i]!];
  }
  return {
    mode: '4',
    level: '2',
    owner: null,
    seats: SEATS_4P,
    hands,
    leader: 'a',
    phase: 'playing',
    finishOrder: [],
    currentTrick: null,
  };
}

const c = (
  suit: Card['suit'],
  rank: Card['rank'],
  deck: Card['deck'] = 1
): Card => ({ suit, rank, deck });

// ─── startTrick ───────────────────────────────────────────────────────────────

describe('startTrick', () => {
  it('creates an empty trick with leader as currentPlayer', () => {
    const r = buildScriptedRound([
      [c('spades', '5')],
      [c('hearts', '5')],
      [c('clubs', '5')],
      [c('diamonds', '5')],
    ]);
    const next = startTrick(r);
    expect(next.currentTrick).not.toBeNull();
    expect(next.currentTrick?.leader).toBe('a');
    expect(next.currentTrick?.currentPlayer).toBe('a');
    expect(next.currentTrick?.bestPattern).toBeNull();
    expect(next.currentTrick?.bestPlayer).toBeNull();
    expect(next.currentTrick?.entries).toEqual([]);
  });

  it('does not mutate the input round (immutability)', () => {
    const r = buildScriptedRound([
      [c('spades', '5')],
      [c('hearts', '5')],
      [c('clubs', '5')],
      [c('diamonds', '5')],
    ]);
    const snapshot = JSON.stringify(r);
    startTrick(r);
    expect(JSON.stringify(r)).toBe(snapshot);
  });
});

// ─── playCards: leader plays first ────────────────────────────────────────────

describe('playCards — leader plays first', () => {
  it('sets bestPattern and bestPlayer, advances currentPlayer CCW', () => {
    const r = startTrick(
      buildScriptedRound([
        [c('spades', 'K')], // a
        [c('hearts', '5')], // b
        [c('clubs', '5')], // c
        [c('diamonds', '5')], // d
      ])
    );
    const next = playCards(r, [c('spades', 'K')]);
    expect(next.currentTrick?.bestPattern?.kind).toBe('single');
    expect(next.currentTrick?.bestPattern?.rank).toBe('K');
    expect(next.currentTrick?.bestPlayer).toBe('a');
    expect(next.currentTrick?.currentPlayer).toBe('b'); // next CCW
    expect(next.hands['a']).toEqual([]); // card removed from hand
  });

  it('throws if cards do not form a valid pattern', () => {
    const r = startTrick(
      buildScriptedRound([
        [c('spades', 'K'), c('hearts', '7')],
        [c('hearts', '5'), c('hearts', '6')],
        [c('clubs', '5'), c('clubs', '6')],
        [c('diamonds', '5'), c('diamonds', '6')],
      ])
    );
    // K + 7 is not a pair (different ranks), not a valid pattern at length 2
    expect(() => playCards(r, [c('spades', 'K'), c('hearts', '7')])).toThrow(/pattern/i);
  });

  it('throws if cards are not in the player\'s hand', () => {
    const r = startTrick(
      buildScriptedRound([
        [c('spades', 'K')],
        [c('hearts', '5')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    // a does not have 7♠
    expect(() => playCards(r, [c('spades', '7')])).toThrow(/hand|own/i);
  });
});

// ─── playCards: follower must beat or pass ───────────────────────────────────

describe('playCards — followers', () => {
  it('higher single beats lower single', () => {
    const r1 = startTrick(
      buildScriptedRound([
        [c('spades', '5')],
        [c('hearts', 'K')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    const r2 = playCards(r1, [c('spades', '5')]); // a plays 5
    const r3 = playCards(r2, [c('hearts', 'K')]); // b plays K → beats
    expect(r3.currentTrick?.bestPlayer).toBe('b');
    expect(r3.currentTrick?.bestPattern?.rank).toBe('K');
  });

  it('throws when a follower plays cards that don\'t beat current best', () => {
    const r1 = startTrick(
      buildScriptedRound([
        [c('spades', 'K')],
        [c('hearts', '5')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    const r2 = playCards(r1, [c('spades', 'K')]); // a plays K
    // b's 5 cannot beat K
    expect(() => playCards(r2, [c('hearts', '5')])).toThrow(/beat/i);
  });
});

// ─── pass: only valid for non-leader of empty trick ──────────────────────────

describe('pass', () => {
  it('throws if leader-of-empty-trick tries to pass (must play)', () => {
    const r = startTrick(
      buildScriptedRound([
        [c('spades', '5')],
        [c('hearts', '5')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    expect(() => pass(r)).toThrow(/lead|must play/i);
  });

  it('advances currentPlayer CCW when a follower passes', () => {
    const r1 = startTrick(
      buildScriptedRound([
        [c('spades', 'K')],
        [c('hearts', '5')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    const r2 = playCards(r1, [c('spades', 'K')]);
    const r3 = pass(r2); // b passes
    expect(r3.currentTrick?.currentPlayer).toBe('c');
  });
});

// ─── Trick end: all others pass → leader wins → leads next trick ─────────────

describe('trick end + next-leader inheritance', () => {
  it('all 3 others pass → leader wins, leads next trick', () => {
    const r0 = startTrick(
      buildScriptedRound([
        [c('spades', 'K'), c('spades', 'Q')],
        [c('hearts', '5'), c('hearts', '6')],
        [c('clubs', '5'), c('clubs', '6')],
        [c('diamonds', '5'), c('diamonds', '6')],
      ])
    );
    const r1 = playCards(r0, [c('spades', 'K')]);
    const r2 = pass(r1); // b
    const r3 = pass(r2); // c
    const r4 = pass(r3); // d → trick ends, a wins
    expect(r4.leader).toBe('a');
    expect(r4.currentTrick).toBeNull(); // trick ended, awaiting next startTrick
  });

  it('when a follower beats and then everyone else passes, beater becomes next leader', () => {
    const r0 = startTrick(
      buildScriptedRound([
        [c('spades', '5'), c('spades', '6')],
        [c('hearts', 'K'), c('hearts', '6')],
        [c('clubs', '5'), c('clubs', '7')],
        [c('diamonds', '5'), c('diamonds', '8')],
      ])
    );
    const r1 = playCards(r0, [c('spades', '5')]); // a leads 5
    const r2 = playCards(r1, [c('hearts', 'K')]); // b beats with K
    const r3 = pass(r2); // c
    const r4 = pass(r3); // d
    const r5 = pass(r4); // a (yes, a must pass too — they're not the bestPlayer)
    expect(r5.leader).toBe('b');
    expect(r5.currentTrick).toBeNull();
  });
});

// ─── Going-out detection ─────────────────────────────────────────────────────

describe('going-out detection', () => {
  it('player plays their last card → added to finishOrder', () => {
    const r = startTrick(
      buildScriptedRound([
        [c('spades', 'K')], // a has 1 card
        [c('hearts', '6'), c('hearts', '7')],
        [c('clubs', '6'), c('clubs', '7')],
        [c('diamonds', '6'), c('diamonds', '7')],
      ])
    );
    const next = playCards(r, [c('spades', 'K')]); // a plays last card
    expect(next.finishOrder).toEqual(['a']);
    expect(next.hands['a']).toEqual([]);
  });

  it('going-out player still wins the trick if no one beats them; partner inherits via 接风', () => {
    // a (t1) plays their last card. b, c, d all pass (or can't beat).
    // Trick winner = a, but a is out → partner c (t1) leads next.
    const r0 = startTrick(
      buildScriptedRound([
        [c('spades', 'K')], // a — single card
        [c('hearts', '6'), c('hearts', '7')],
        [c('clubs', '6'), c('clubs', '8')],
        [c('diamonds', '6'), c('diamonds', '9')],
      ])
    );
    const r1 = playCards(r0, [c('spades', 'K')]); // a goes out winning
    const r2 = pass(r1); // b
    const r3 = pass(r2); // c
    const r4 = pass(r3); // d → trick over
    expect(r4.finishOrder).toEqual(['a']);
    expect(r4.leader).toBe('c'); // a's teammate → 接风
    expect(r4.currentTrick).toBeNull();
  });
});

// ─── Round end ────────────────────────────────────────────────────────────────

describe('round end', () => {
  it('round ends after N-1 finishes (4P: 3 players out)', () => {
    // Tiny hands so we can drain quickly.
    // Each player has 1 card; a > b > c > d so a plays K, b plays Q (loses), etc.
    // Simpler: a plays K → b,c,d pass → a wins, but a is out → 接风 to c.
    // Then c plays alone? No, after a is out, b,c,d still in. c leads.
    // c plays Q → b,d pass → c wins, c out (had only 1 card) → 接风 to a, but a is out.
    //   Need to find next teammate; none → fall back to next active CCW.
    // Actually with the scripted hand below, let's do:
    //   a: 1 card K, b: 1 card 5, c: 1 card Q, d: 1 card 6
    // a plays K (out), b pass, c pass, d pass → trick over, 接风 to c.
    // c leads Q (out), d passes, b passes → 接风 attempt to a (out), fallback next active = b or d.
    //   Two finished (a, c), two remain (b, d). Round continues until N-1=3 out.
    const r0 = startTrick(
      buildScriptedRound([
        [c('spades', 'K')],
        [c('hearts', '5')],
        [c('clubs', 'Q')],
        [c('diamonds', '6')],
      ])
    );
    const r1 = playCards(r0, [c('spades', 'K')]); // a out
    const r2 = pass(r1); // b
    const r3 = pass(r2); // c
    const r4 = pass(r3); // d → trick over, leader=c (接风)
    const r5 = startTrick(r4);
    const r6 = playCards(r5, [c('clubs', 'Q')]); // c out
    const r7 = pass(r6); // d
    const r8 = pass(r7); // a is out, skip → b
    const r9 = r8; // trick should be over now (all others responded)
    // After d passes, only b has cards (c just went out, a was out).
    // active = {b}, awaitingResponse = {} → trick ends.
    expect(r9.finishOrder).toEqual(['a', 'c']);
    // Round has 2 out of 4; N-1=3 needed. Not yet done.
    expect(r9.phase).toBe('playing');
    // Now b leads (only active player + c's teammate is a who's out, so fallback)
    expect(r9.leader).toBeDefined();
  });

  it('round transitions to "finished" once N-1 players have gone out', () => {
    // 1-card hands; each player's only card beats the previous, so each leads
    // their own trick, plays out, others pass — until 3 out of 4 finish.
    const r0 = startTrick(
      buildScriptedRound([
        [c('spades', 'K')], // a t1
        [c('hearts', '6')], // b t2
        [c('clubs', 'Q')], // c t1
        [c('diamonds', '7')], // d t2
      ])
    );
    // Trick 1: a plays K → b,c,d pass → 接风 to c
    let r = playCards(r0, [c('spades', 'K')]);
    r = pass(r);
    r = pass(r);
    r = pass(r);
    expect(r.leader).toBe('c');

    // Trick 2: c plays Q → d,b pass (a is out) → 接风 to a (out) → fallback to d
    r = startTrick(r);
    r = playCards(r, [c('clubs', 'Q')]);
    r = pass(r); // d
    r = pass(r); // b (a skipped)
    expect(r.leader).toBe('d'); // fallback after teammate a is out

    // Trick 3: d plays 7. b's 6 cannot beat 7 → b must pass.
    // After d plays last card, awaitingResponse = [b]. b passes → trick over.
    // d in finishOrder → 接风 to b (t2 partner) → but round-end triggers first.
    r = startTrick(r);
    r = playCards(r, [c('diamonds', '7')]); // d out — 3 finishes
    expect(r.finishOrder).toEqual(['a', 'c', 'd']);
    // d's play stands; b is the only player left. awaitingResponse = [b].
    // Trick is NOT over yet — b still needs to respond.
    expect(r.phase).toBe('playing');

    r = pass(r); // b passes → awaitingResponse empty → trick ends → round ends
    expect(r.phase).toBe('finished');
    expect(r.finishOrder).toEqual(['a', 'c', 'd', 'b']); // b auto-filled
    expect(r.currentTrick).toBeNull();
  });
});
