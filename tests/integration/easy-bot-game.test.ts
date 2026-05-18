import { describe, expect, it } from 'vitest';
import seedrandom from 'seedrandom';
import { buildDeck, shuffleDeck } from '@lib/game/cards';
import { dealRound, pass, playCards, startTrick } from '@lib/game/round';
import type { GameRound, PlayerSeat } from '@lib/game/round';
import { chooseEasyMove } from '@lib/ai/easy';
import { applyRoundResult, createSession } from '@lib/game/session';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

const SEATS_4P: PlayerSeat[] = [
  { id: 'alice', team: 't1', position: 0 },
  { id: 'bob', team: 't2', position: 1 },
  { id: 'carol', team: 't1', position: 2 },
  { id: 'dave', team: 't2', position: 3 },
];

const MAX_ACTIONS = 5000; // safety cap

function runRound(round0: GameRound, rng: () => number): GameRound {
  let round = round0;
  let actionCount = 0;
  while (round.phase === 'playing') {
    if (actionCount++ > MAX_ACTIONS) {
      throw new Error(`runRound: exceeded ${MAX_ACTIONS} actions — likely infinite loop`);
    }
    if (round.currentTrick === null) {
      round = startTrick(round);
      continue;
    }
    const actor = round.currentTrick.currentPlayer;
    const hand = round.hands[actor] ?? [];
    const target = round.currentTrick.bestPattern;
    const move = chooseEasyMove(hand, target, round.level, rng);
    if (move.kind === 'pass') {
      round = pass(round);
    } else {
      round = playCards(round, move.pattern.cards);
    }
  }
  return round;
}

describe('integration: 4P round with Easy bots', () => {
  it('plays through to round-end without crash or infinite loop', () => {
    const rng = seedrandom('integ-1');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: deck,
    });
    const final = runRound(round0, rng);
    expect(final.phase).toBe('finished');
    // All 4 players accounted for in finishOrder.
    expect(final.finishOrder).toHaveLength(4);
    expect(new Set(final.finishOrder).size).toBe(4);
  });

  it('produces a valid session transition after the round resolves', () => {
    const rng = seedrandom('integ-2');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: deck,
    });
    const final = runRound(round0, rng);
    const session0 = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    const session1 = applyRoundResult(session0, final);
    // The winning team must have advanced (upgrade ∈ {1,2,3}).
    const winnerTeam = session1.roundOwner!;
    expect(['t1', 't2']).toContain(winnerTeam);
    expect(session1.teamLevels[winnerTeam]).not.toBe('2');
    expect(session1.finishedRounds).toBe(1);
  });

  it('first N-1 finishers have empty hands; last finisher keeps remaining cards', () => {
    const rng = seedrandom('integ-3');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: deck,
    });
    expect(Object.values(round0.hands).reduce((s, h) => s + h.length, 0)).toBe(108);

    const final = runRound(round0, rng);
    // Round ends at N-1 actual finishes; the Nth player is auto-filled into
    // finishOrder but their hand still holds their unplayed cards.
    for (let i = 0; i < final.finishOrder.length - 1; i++) {
      const id = final.finishOrder[i]!;
      expect(final.hands[id], `finisher ${i + 1} (${id})`).toEqual([]);
    }
    const lastId = final.finishOrder[final.finishOrder.length - 1]!;
    // Last finisher's hand may be non-empty — the round ended early.
    expect(Array.isArray(final.hands[lastId])).toBe(true);
  });

  it('different RNG seeds produce different finish orders (sanity: not always the same outcome)', () => {
    const finishOrders: string[][] = [];
    for (const seed of ['integ-A', 'integ-B', 'integ-C']) {
      const rng = seedrandom(seed);
      const deck = shuffleDeck(buildDeck(), rng);
      const round0 = dealRound({
        mode: '4',
        level: '2',
        owner: null,
        seats: SEATS_4P,
        leader: 'alice',
        shuffledDeck: deck,
      });
      const final = runRound(round0, rng);
      finishOrders.push(final.finishOrder);
    }
    // At least 2 of 3 should differ — if all 3 are identical the test is suspect.
    const uniqueOrders = new Set(finishOrders.map((o) => o.join(',')));
    expect(uniqueOrders.size).toBeGreaterThanOrEqual(2);
  });
});
