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

describe('dealNextRound — 4P manual tribute', () => {
  it('defers the swap and sets pendingTribute on the new round', () => {
    const rng = seedrandom('next-manual-1');
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
    const session0 = createSession({
      mode: '4',
      rules: { ...DEFAULT_MODE_RULES, manualTribute: true },
    });
    const session1 = applyRoundResult(session0, finished);

    const result = dealNextRound({ prevRound: finished, session: session1, rng });

    expect(result.pendingManualTribute).toBe(true);
    expect(result.tributeMode).not.toBeNull();
    expect(['single', 'double', 'resist']).toContain(result.tributeMode!.kind);
    // Exchanges are deferred — empty until manual flow finalizes.
    expect(result.exchanges).toEqual([]);
    // Trick has NOT started yet — manual flow finalizes that.
    expect(result.round.currentTrick).toBeNull();
    // pendingTribute is set with the right mode + a snapshot finishOrder.
    expect(result.round.pendingTribute).toBeDefined();
    expect(result.round.pendingTribute!.mode).toBe(result.tributeMode!.kind);
    expect(result.round.pendingTribute!.finishOrder).toEqual(finished.finishOrder);
    if (result.tributeMode!.kind === 'single') {
      expect(result.round.pendingTribute!.obligations).toHaveLength(1);
      expect(result.round.pendingTribute!.obligations[0]!.selectedCard).toBeNull();
    } else if (result.tributeMode!.kind === 'double') {
      expect(result.round.pendingTribute!.obligations).toHaveLength(2);
      for (const o of result.round.pendingTribute!.obligations) {
        expect(o.selectedCard).toBeNull();
      }
    } else {
      // resist mode — obligations stays empty; declarer dispatches anti_tribute
      expect(result.round.pendingTribute!.obligations).toEqual([]);
    }
  });

  it('AUTO path returns pendingManualTribute=false', () => {
    const rng = seedrandom('next-auto-1');
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

    const result = dealNextRound({ prevRound: finished, session: session1, rng });
    expect(result.pendingManualTribute).toBe(false);
    expect(result.round.pendingTribute).toBeUndefined();
    // Auto path: trick has started.
    expect(result.round.currentTrick).not.toBeNull();
  });
});

describe('dealNextRound — 6P', () => {
  it('runs detectTributeModeMP (tributeMode is populated, not null)', () => {
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
    expect(result.tributeMode).not.toBeNull();
    expect(['single', 'sweep', 'resist']).toContain(result.tributeMode!.kind);
    // Auto path: trick has started, no pending state.
    expect(result.round.currentTrick).not.toBeNull();
    expect(result.round.pendingTribute).toBeUndefined();
  });

  it('sweep tribute: t1 takes positions 1,2,3 → 3-pair sweep, 末游 leads', () => {
    const rng = seedrandom('sweep-6p-1');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '6',
      level: '2',
      owner: null,
      seats: SEATS_6P,
      leader: 'a',
      shuffledDeck: deck,
    });
    // Fabricate a sweep finish order: a/c/e (all t1) take 1,2,3; b/d/f (t2) take 4,5,6.
    // Using the freshly-dealt hands as a starting point we mark the round
    // finished with the engineered order. detectTributeModeMP will check the
    // (random) hands for resist — using a seed where no losing player has both RJs.
    const finished: GameRound = {
      ...round0,
      phase: 'finished',
      finishOrder: ['a', 'c', 'e', 'b', 'd', 'f'],
      currentTrick: null,
    };
    const session0 = createSession({ mode: '6', rules: DEFAULT_MODE_RULES });
    const session1 = applyRoundResult(session0, finished);

    const result = dealNextRound({ prevRound: finished, session: session1, rng });
    // May land as resist if both RJs happen to be on t2 by chance; allow both.
    if (result.tributeMode!.kind === 'sweep') {
      expect(result.tributeMode!.obligations).toHaveLength(3);
      // pairings: f→a (6th→1st), d→c (5th→2nd), b→e (4th→3rd)
      const pairs = result.tributeMode!.obligations.map((o) => `${o.from}→${o.to}`).sort();
      expect(pairs).toEqual(['b→e', 'd→c', 'f→a']);
      // 末游 (f, last in finishOrder) leads after sweep tribute.
      expect(result.round.leader).toBe('f');
    } else {
      expect(result.tributeMode!.kind).toBe('resist');
    }
    expect(result.round.currentTrick).not.toBeNull();
  });

  it('mixed finish → single tribute (last → first), 末游 leads', () => {
    const rng = seedrandom('mixed-6p-1');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '6',
      level: '2',
      owner: null,
      seats: SEATS_6P,
      leader: 'a',
      shuffledDeck: deck,
    });
    // Mixed: t1 has positions 1, 3, 5 (a, c, e); t2 has 2, 4, 6 (b, d, f).
    // No sweep possible because top-3 isn't all same team.
    const finished: GameRound = {
      ...round0,
      phase: 'finished',
      finishOrder: ['a', 'b', 'c', 'd', 'e', 'f'],
      currentTrick: null,
    };
    const session0 = createSession({ mode: '6', rules: DEFAULT_MODE_RULES });
    const session1 = applyRoundResult(session0, finished);

    const result = dealNextRound({ prevRound: finished, session: session1, rng });
    if (result.tributeMode!.kind === 'single') {
      expect(result.tributeMode!.from).toBe('f');
      expect(result.tributeMode!.to).toBe('a');
      expect(result.round.leader).toBe('f');
    } else {
      // Allow resist when both RJs land on losing team by chance.
      expect(result.tributeMode!.kind).toBe('resist');
    }
  });
});

describe('dealNextRound — 8P', () => {
  const SEATS_8P: PlayerSeat[] = [
    { id: 'a', team: 't1', position: 0 },
    { id: 'b', team: 't2', position: 1 },
    { id: 'c', team: 't1', position: 2 },
    { id: 'd', team: 't2', position: 3 },
    { id: 'e', team: 't1', position: 4 },
    { id: 'f', team: 't2', position: 5 },
    { id: 'g', team: 't1', position: 6 },
    { id: 'h', team: 't2', position: 7 },
  ];

  it('sweep tribute: t1 takes positions 1-4 → 4-pair sweep, 末游 leads', () => {
    const rng = seedrandom('sweep-8p-1');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '8',
      level: '2',
      owner: null,
      seats: SEATS_8P,
      leader: 'a',
      shuffledDeck: deck,
    });
    const finished: GameRound = {
      ...round0,
      phase: 'finished',
      finishOrder: ['a', 'c', 'e', 'g', 'b', 'd', 'f', 'h'],
      currentTrick: null,
    };
    const session0 = createSession({ mode: '8', rules: DEFAULT_MODE_RULES });
    const session1 = applyRoundResult(session0, finished);

    const result = dealNextRound({ prevRound: finished, session: session1, rng });
    if (result.tributeMode!.kind === 'sweep') {
      expect(result.tributeMode!.obligations).toHaveLength(4);
      // pairings: h→a (8→1), f→c (7→2), d→e (6→3), b→g (5→4)
      const pairs = result.tributeMode!.obligations.map((o) => `${o.from}→${o.to}`).sort();
      expect(pairs).toEqual(['b→g', 'd→e', 'f→c', 'h→a']);
      expect(result.round.leader).toBe('h');
    } else {
      expect(result.tributeMode!.kind).toBe('resist');
    }
    expect(result.round.currentTrick).not.toBeNull();
  });

  it('mixed finish → single tribute (8th → 1st)', () => {
    const rng = seedrandom('mixed-8p-1');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '8',
      level: '2',
      owner: null,
      seats: SEATS_8P,
      leader: 'a',
      shuffledDeck: deck,
    });
    const finished: GameRound = {
      ...round0,
      phase: 'finished',
      // a (t1) 1st, b (t2) 2nd — top-4 not all same team → no sweep.
      finishOrder: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      currentTrick: null,
    };
    const session0 = createSession({ mode: '8', rules: DEFAULT_MODE_RULES });
    const session1 = applyRoundResult(session0, finished);

    const result = dealNextRound({ prevRound: finished, session: session1, rng });
    if (result.tributeMode!.kind === 'single') {
      expect(result.tributeMode!.from).toBe('h');
      expect(result.tributeMode!.to).toBe('a');
      expect(result.round.leader).toBe('h');
    } else {
      expect(result.tributeMode!.kind).toBe('resist');
    }
  });

  it('manual sweep mode: pendingTribute set with 4-obligation sweep', () => {
    const rng = seedrandom('manual-sweep-8p');
    const deck = shuffleDeck(buildDeck(), rng);
    const round0 = dealRound({
      mode: '8',
      level: '2',
      owner: null,
      seats: SEATS_8P,
      leader: 'a',
      shuffledDeck: deck,
    });
    const finished: GameRound = {
      ...round0,
      phase: 'finished',
      finishOrder: ['a', 'c', 'e', 'g', 'b', 'd', 'f', 'h'],
      currentTrick: null,
    };
    const session0 = createSession({
      mode: '8',
      rules: { ...DEFAULT_MODE_RULES, manualTribute: true },
    });
    const session1 = applyRoundResult(session0, finished);

    const result = dealNextRound({ prevRound: finished, session: session1, rng });
    if (result.tributeMode!.kind === 'sweep') {
      expect(result.pendingManualTribute).toBe(true);
      expect(result.round.pendingTribute).toBeDefined();
      expect(result.round.pendingTribute!.mode).toBe('sweep');
      expect(result.round.pendingTribute!.obligations).toHaveLength(4);
      // Trick NOT started in manual mode — waits for tribute_select commands.
      expect(result.round.currentTrick).toBeNull();
    } else if (result.tributeMode!.kind === 'resist') {
      expect(result.pendingManualTribute).toBe(true);
      expect(result.round.pendingTribute!.mode).toBe('resist');
    }
  });
});

describe('dealNextRound — EXCHANGE-1 card-exchange rule', () => {
  it('opens a card-exchange vote (no trick started) when cardExchange is on', () => {
    const rng = seedrandom('exch-1');
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
    const session0 = createSession({
      mode: '4',
      rules: { ...DEFAULT_MODE_RULES, cardExchange: true },
    });
    const session1 = applyRoundResult(session0, finished);

    const result = dealNextRound({ prevRound: finished, session: session1, rng });

    expect(result.pendingCardExchange).toBe(true);
    expect(result.round.pendingExchange).toBeDefined();
    expect(result.round.pendingExchange!.phase).toBe('vote');
    expect(result.round.pendingExchange!.losers.length).toBeGreaterThan(0);
    expect(result.round.pendingExchange!.cardCount).toBe(3);
    // Trick NOT started — waits for the exchange vote/select commands.
    expect(result.round.currentTrick).toBeNull();
  });

  it('starts the trick normally when cardExchange is off (default)', () => {
    const rng = seedrandom('exch-2');
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

    const result = dealNextRound({ prevRound: finished, session: session1, rng });
    expect(result.pendingCardExchange).toBe(false);
    expect(result.round.pendingExchange).toBeUndefined();
    expect(result.round.currentTrick).not.toBeNull();
  });
});
