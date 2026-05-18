import { describe, expect, it } from 'vitest';
import seedrandom from 'seedrandom';
import { dealNextRound } from '@lib/game/nextRound';
import { buildDeck, shuffleDeck } from '@lib/game/cards';
import { dealRound, startTrick, playCards, pass } from '@lib/game/round';
import type { GameRound, PlayerSeat } from '@lib/game/round';
import { applyRoundResult, createSession } from '@lib/game/session';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';
import { chooseEasyMove } from '@lib/ai/easy';

const SEATS_4P: PlayerSeat[] = [
  { id: 'alice', team: 't1', position: 0 },
  { id: 'bob', team: 't2', position: 1 },
  { id: 'carol', team: 't1', position: 2 },
  { id: 'dave', team: 't2', position: 3 },
];

const SEATS_6P: PlayerSeat[] = [
  { id: 'a', team: 't1', position: 0 },
  { id: 'b', team: 't2', position: 1 },
  { id: 'c', team: 't1', position: 2 },
  { id: 'd', team: 't2', position: 3 },
  { id: 'e', team: 't1', position: 4 },
  { id: 'f', team: 't2', position: 5 },
];

/**
 * Drive a round to completion with Easy bots. Used to set up a finished
 * round in a deterministic, replayable way for the next-round test.
 */
function runRoundToFinish(round0: GameRound, rng: () => number): GameRound {
  let round = round0;
  let actions = 0;
  while (round.phase === 'playing') {
    if (actions++ > 5000) throw new Error('runRoundToFinish: stuck');
    if (round.currentTrick === null) {
      round = startTrick(round);
      continue;
    }
    const actor = round.currentTrick.currentPlayer;
    const move = chooseEasyMove(
      round.hands[actor] ?? [],
      round.currentTrick.bestPattern,
      round.level,
      rng
    );
    if (move.kind === 'pass') {
      round = pass(round);
    } else {
      round = playCards(round, move.pattern.cards);
    }
  }
  return round;
}

describe('dealNextRound — 4P', () => {
  it('returns a started round with currentTrick non-null', () => {
    const rng = seedrandom('next-1');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: deck,
    });
    const finished = runRoundToFinish(round0, rng);

    const session0 = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    const session1 = applyRoundResult(session0, finished);

    const result = dealNextRound({
      prevRound: finished,
      session: session1,
      rng,
    });

    expect(result.round.phase).toBe('playing');
    expect(result.round.currentTrick).not.toBeNull();
    expect(result.round.finishOrder).toEqual([]);
    expect(Object.keys(result.round.hands)).toEqual(['alice', 'bob', 'carol', 'dave']);
  });

  it('starts at the winning team\'s new level (post-upgrade)', () => {
    const rng = seedrandom('next-2');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: deck,
    });
    const finished = runRoundToFinish(round0, rng);
    const session0 = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    const session1 = applyRoundResult(session0, finished);

    const result = dealNextRound({
      prevRound: finished,
      session: session1,
      rng,
    });

    // Whatever the winning team's level is now, the new round must match.
    expect(result.round.level).toBe(session1.teamLevels[session1.roundOwner!]);
  });

  it('detects tribute mode + applies exchange (4P)', () => {
    const rng = seedrandom('next-3');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: deck,
    });
    const finished = runRoundToFinish(round0, rng);
    const session0 = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    const session1 = applyRoundResult(session0, finished);

    const result = dealNextRound({
      prevRound: finished,
      session: session1,
      rng,
    });

    expect(result.tributeMode).not.toBeNull();
    expect(['single', 'double', 'resist']).toContain(result.tributeMode!.kind);
    if (result.tributeMode!.kind === 'single' || result.tributeMode!.kind === 'double') {
      // Single → 1 exchange, double → 2 exchanges.
      expect(result.exchanges.length).toBeGreaterThan(0);
    } else {
      // Resist → no exchange.
      expect(result.exchanges).toEqual([]);
    }
  });

  it('first leader matches tribute outcome (末游 for single/double, 1st for resist)', () => {
    const rng = seedrandom('next-4');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: deck,
    });
    const finished = runRoundToFinish(round0, rng);
    const session0 = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    const session1 = applyRoundResult(session0, finished);
    const result = dealNextRound({
      prevRound: finished,
      session: session1,
      rng,
    });

    const lastFinisher = finished.finishOrder[finished.finishOrder.length - 1]!;
    const firstFinisher = finished.finishOrder[0]!;
    if (
      result.tributeMode!.kind === 'single' ||
      result.tributeMode!.kind === 'double'
    ) {
      // 末游 leads.
      expect(result.round.leader).toBe(lastFinisher);
      expect(result.round.currentTrick!.currentPlayer).toBe(lastFinisher);
    } else {
      // resist → 1st place leads.
      expect(result.round.leader).toBe(firstFinisher);
    }
  });

  it('throws when session is finished', () => {
    const rng = seedrandom('next-throw-1');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: deck,
    });
    const finished = runRoundToFinish(round0, rng);
    const session = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    expect(() =>
      dealNextRound({
        prevRound: finished,
        session: { ...session, phase: 'finished' },
        rng,
      })
    ).toThrow(/finished/i);
  });

  it('throws when prev round is not finished', () => {
    const rng = seedrandom('next-throw-2');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: deck,
    });
    const session = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    expect(() =>
      dealNextRound({ prevRound: round0, session, rng })
    ).toThrow(/playing|finished/i);
  });
});

describe('dealNextRound — 6P', () => {
  it('skips tribute (returns null + empty exchanges)', () => {
    const rng = seedrandom('next-6p');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '6',
      level: '2',
      owner: null,
      seats: SEATS_6P,
      leader: 'a',
      shuffledDeck: deck,
    });
    const finished = runRoundToFinish(round0, rng);
    const session0 = createSession({ mode: '6', rules: DEFAULT_MODE_RULES });
    const session1 = applyRoundResult(session0, finished);

    const result = dealNextRound({ prevRound: finished, session: session1, rng });
    expect(result.tributeMode).toBeNull();
    expect(result.exchanges).toEqual([]);
    // 1st place leads (no tribute redirection).
    expect(result.round.leader).toBe(finished.finishOrder[0]);
  });
});
