import { describe, expect, it } from 'vitest';
import { applyRoundResult, createSession } from '@lib/game/session';
import type { GameSession } from '@lib/game/session';
import type { GameRound, PlayerSeat } from '@lib/game/round';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';
import type { LevelRank } from '@lib/game/levels';

const SEATS_4P: PlayerSeat[] = [
  { id: 'a', team: 't1', position: 0 },
  { id: 'b', team: 't2', position: 1 },
  { id: 'c', team: 't1', position: 2 },
  { id: 'd', team: 't2', position: 3 },
];

const finishedRound = (
  finishOrder: string[],
  level: LevelRank = '2',
  owner: 't1' | 't2' | null = null
): GameRound => ({
  mode: '4',
  level,
  owner,
  seats: SEATS_4P,
  hands: Object.fromEntries(SEATS_4P.map((s) => [s.id, []])),
  leader: finishOrder[0]!,
  phase: 'finished',
  finishOrder,
  currentTrick: null,
});

describe('createSession — initial state', () => {
  it('starts both teams at level 2 with no A-fails and no round owner', () => {
    const s = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    expect(s.teamLevels).toEqual({ t1: '2', t2: '2' });
    expect(s.teamAFails).toEqual({ t1: 0, t2: 0 });
    expect(s.roundOwner).toBeNull();
    expect(s.finishedRounds).toBe(0);
    expect(s.phase).toBe('in_progress');
    expect(s.winnerTeam).toBeNull();
  });
});

describe('applyRoundResult — basic upgrade', () => {
  it('4P (1,2) → t1 advances by 3 levels (2 → 5)', () => {
    const s0 = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    const round = finishedRound(['a', 'c', 'b', 'd']);
    const s1 = applyRoundResult(s0, round);
    expect(s1.teamLevels['t1']).toBe('5');
    expect(s1.teamLevels['t2']).toBe('2'); // opponents unchanged
    expect(s1.roundOwner).toBe('t1');
    expect(s1.finishedRounds).toBe(1);
    expect(s1.phase).toBe('in_progress');
  });

  it('4P (1,3) → t1 advances by 2 (2 → 4)', () => {
    const s0 = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    const s1 = applyRoundResult(s0, finishedRound(['a', 'b', 'c', 'd']));
    expect(s1.teamLevels['t1']).toBe('4');
  });

  it('4P (1,4) → t1 advances by 1 (2 → 3)', () => {
    const s0 = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    const s1 = applyRoundResult(s0, finishedRound(['a', 'b', 'd', 'c']));
    expect(s1.teamLevels['t1']).toBe('3');
  });

  it('subsequent rounds accumulate level progression', () => {
    let s = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    // Round 1: t1 (1,3) → t1 to 4
    s = applyRoundResult(s, finishedRound(['a', 'b', 'c', 'd']));
    // Round 2: t2 (1,4) → t2 to 3
    s = applyRoundResult(s, finishedRound(['b', 'a', 'c', 'd']));
    expect(s.teamLevels['t1']).toBe('4');
    expect(s.teamLevels['t2']).toBe('3');
    expect(s.finishedRounds).toBe(2);
  });
});

describe('applyRoundResult — A-level pass condition (4P strict)', () => {
  it('t1 at A, wins cleanly on own A round → game ends, t1 wins', () => {
    const s0: GameSession = {
      ...createSession({ mode: '4', rules: DEFAULT_MODE_RULES }),
      teamLevels: { t1: 'A', t2: '4' },
      roundOwner: 't1',
    };
    // (1,2) clean win for t1
    const s1 = applyRoundResult(s0, finishedRound(['a', 'c', 'b', 'd'], 'A', 't1'));
    expect(s1.phase).toBe('finished');
    expect(s1.winnerTeam).toBe('t1');
  });

  it('t1 at A, wins on opponent round (strict mode) → stays at A, no game end', () => {
    const s0: GameSession = {
      ...createSession({ mode: '4', rules: DEFAULT_MODE_RULES }),
      teamLevels: { t1: 'A', t2: '4' },
      roundOwner: 't2', // opponent's round
    };
    const s1 = applyRoundResult(s0, finishedRound(['a', 'c', 'b', 'd'], '4', 't2'));
    expect(s1.phase).toBe('in_progress');
    expect(s1.teamLevels['t1']).toBe('A'); // stays
    expect(s1.winnerTeam).toBeNull();
  });

  it('t1 at A, wins dirty (1,4) on own A round → A-fail++ (no game end)', () => {
    const s0: GameSession = {
      ...createSession({ mode: '4', rules: DEFAULT_MODE_RULES }),
      teamLevels: { t1: 'A', t2: '4' },
      roundOwner: 't1',
    };
    // (1,4) dirty win for t1 — partner is last
    const s1 = applyRoundResult(s0, finishedRound(['a', 'b', 'd', 'c'], 'A', 't1'));
    expect(s1.phase).toBe('in_progress');
    expect(s1.teamAFails['t1']).toBe(1);
    expect(s1.winnerTeam).toBeNull();
  });

  it('4P third dirty win at A → demoted to level 2', () => {
    const s0: GameSession = {
      ...createSession({ mode: '4', rules: DEFAULT_MODE_RULES }),
      teamLevels: { t1: 'A', t2: '4' },
      teamAFails: { t1: 2, t2: 0 }, // already 2 strikes
      roundOwner: 't1',
    };
    const s1 = applyRoundResult(s0, finishedRound(['a', 'b', 'd', 'c'], 'A', 't1'));
    expect(s1.teamLevels['t1']).toBe('2'); // demoted
    expect(s1.teamAFails['t1']).toBe(0); // counter reset
    expect(s1.phase).toBe('in_progress');
  });
});

describe('applyRoundResult — 6P / 8P no A-fail counter', () => {
  it('6P at A: dirty win → stays at A, no fail tracked', () => {
    const SEATS_6P: PlayerSeat[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i + 1}`,
      team: (i % 2 === 0 ? 't1' : 't2') as 't1' | 't2',
      position: i,
    }));
    const round: GameRound = {
      mode: '6',
      level: 'A',
      owner: 't1',
      seats: SEATS_6P,
      hands: Object.fromEntries(SEATS_6P.map((s) => [s.id, []])),
      leader: 'p1',
      phase: 'finished',
      // t1 has ranks 1, 5, 6 — p5 (t1) is at rank 6 (last) → DIRTY win
      finishOrder: ['p1', 'p2', 'p4', 'p6', 'p3', 'p5'],
      currentTrick: null,
    };
    const s0: GameSession = {
      ...createSession({ mode: '6', rules: DEFAULT_MODE_RULES }),
      teamLevels: { t1: 'A', t2: '4' },
      roundOwner: 't1',
    };
    const s1 = applyRoundResult(s0, round);
    expect(s1.teamAFails).toEqual({ t1: 0, t2: 0 });
    expect(s1.teamLevels['t1']).toBe('A');
    expect(s1.phase).toBe('in_progress');
  });
});

describe('applyRoundResult — invariants', () => {
  it('throws if the round is not in "finished" phase', () => {
    const s0 = createSession({ mode: '4', rules: DEFAULT_MODE_RULES });
    const unfinished: GameRound = {
      ...finishedRound(['a', 'b', 'c', 'd']),
      phase: 'playing',
    };
    expect(() => applyRoundResult(s0, unfinished)).toThrow(/finished|phase/);
  });

  it('throws if the session is already finished', () => {
    const s: GameSession = {
      ...createSession({ mode: '4', rules: DEFAULT_MODE_RULES }),
      phase: 'finished',
      winnerTeam: 't1',
    };
    expect(() => applyRoundResult(s, finishedRound(['a', 'c', 'b', 'd']))).toThrow(
      /already|finished/i
    );
  });
});
