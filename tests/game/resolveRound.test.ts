import { describe, expect, it } from 'vitest';
import { resolveRound } from '@lib/game/resolveRound';
import type { GameRound, PlayerSeat } from '@lib/game/round';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';
import type { TeamKey } from '@lib/game/mode';

const SEATS_4P: PlayerSeat[] = [
  { id: 'a', team: 't1', position: 0 },
  { id: 'b', team: 't2', position: 1 },
  { id: 'c', team: 't1', position: 2 },
  { id: 'd', team: 't2', position: 3 },
];

const SEATS_6P: PlayerSeat[] = [
  // 2 teams of 3 (per game-rules.md § 4 vs 6 vs 8 player modes)
  { id: 'p1', team: 't1', position: 0 },
  { id: 'p2', team: 't2', position: 1 },
  { id: 'p3', team: 't1', position: 2 },
  { id: 'p4', team: 't2', position: 3 },
  { id: 'p5', team: 't1', position: 4 },
  { id: 'p6', team: 't2', position: 5 },
];

const SEATS_8P: PlayerSeat[] = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i}`,
  team: (i % 2 === 0 ? 't1' : 't2') as 't1' | 't2',
  position: i,
}));

/** Build a finished round with a given finishOrder, bypassing the trick state. */
function finishedRound(
  seats: readonly PlayerSeat[],
  finishOrder: string[],
  mode: '4' | '6' | '8'
): GameRound {
  return {
    mode,
    level: '2',
    owner: null,
    seats,
    hands: Object.fromEntries(seats.map((s) => [s.id, []])),
    leader: finishOrder[0]!,
    phase: 'finished',
    finishOrder,
    currentTrick: null,
  };
}

// ─── 4P: fixed-table upgrades ─────────────────────────────────────────────────

describe('resolveRound — 4-player upgrade table', () => {
  it('(1,2): winning team = t1, upgrade = +3', () => {
    // a (t1) 1st, c (t1) 2nd, b (t2) 3rd, d (t2) 4th
    const r = finishedRound(SEATS_4P, ['a', 'c', 'b', 'd'], '4');
    const result = resolveRound(r, DEFAULT_MODE_RULES);
    expect(result.winnerTeam).toBe<TeamKey>('t1');
    expect(result.winnerRanks).toEqual([1, 2]);
    expect(result.upgrade).toBe(3);
  });

  it('(1,3): upgrade = +2', () => {
    // a (t1) 1st, b (t2) 2nd, c (t1) 3rd, d (t2) 4th
    const r = finishedRound(SEATS_4P, ['a', 'b', 'c', 'd'], '4');
    const result = resolveRound(r, DEFAULT_MODE_RULES);
    expect(result.winnerTeam).toBe<TeamKey>('t1');
    expect(result.winnerRanks).toEqual([1, 3]);
    expect(result.upgrade).toBe(2);
  });

  it('(1,4): upgrade = +1', () => {
    // a (t1) 1st, b (t2) 2nd, d (t2) 3rd, c (t1) 4th
    const r = finishedRound(SEATS_4P, ['a', 'b', 'd', 'c'], '4');
    const result = resolveRound(r, DEFAULT_MODE_RULES);
    expect(result.winnerTeam).toBe<TeamKey>('t1');
    expect(result.winnerRanks).toEqual([1, 4]);
    expect(result.upgrade).toBe(1);
  });

  it('winnerTeam derives from 1st-place player, not seat order', () => {
    // b (t2) 1st → winnerTeam = t2
    const r = finishedRound(SEATS_4P, ['b', 'd', 'a', 'c'], '4');
    const result = resolveRound(r, DEFAULT_MODE_RULES);
    expect(result.winnerTeam).toBe<TeamKey>('t2');
    expect(result.winnerRanks).toEqual([1, 2]);
    expect(result.upgrade).toBe(3);
  });
});

// ─── 6P: score-differential upgrade ──────────────────────────────────────────

describe('resolveRound — 6-player score differential', () => {
  it('winning team takes positions 1, 2, 3 → all 3 winning ranks', () => {
    const r = finishedRound(SEATS_6P, ['p1', 'p3', 'p5', 'p2', 'p4', 'p6'], '6');
    const result = resolveRound(r, DEFAULT_MODE_RULES);
    expect(result.winnerTeam).toBe<TeamKey>('t1');
    expect(result.winnerRanks).toEqual([1, 2, 3]);
    // p6 score 5+4+3=12, opponents 3+1+0=4, diff=8 ≥ g3=7 → +3
    expect(result.upgrade).toBe(3);
  });

  it('winning team with (1, 4, 5) → diff 5+3+1−4−3−0 = 2 → +1 level (≥g1=1)', () => {
    const r = finishedRound(SEATS_6P, ['p1', 'p2', 'p4', 'p3', 'p5', 'p6'], '6');
    const result = resolveRound(r, DEFAULT_MODE_RULES);
    expect(result.winnerTeam).toBe<TeamKey>('t1');
    expect(result.winnerRanks).toEqual([1, 4, 5]);
    expect(result.upgrade).toBe(1);
  });
});

// ─── 8P: sweep bonus + score-differential ────────────────────────────────────

describe('resolveRound — 8-player', () => {
  it('sweep (1,2,3,4) same team → +4 levels (special-case)', () => {
    const r = finishedRound(
      SEATS_8P,
      ['s0', 's2', 's4', 's6', 's1', 's3', 's5', 's7'],
      '8'
    );
    const result = resolveRound(r, DEFAULT_MODE_RULES);
    expect(result.winnerTeam).toBe<TeamKey>('t1');
    expect(result.winnerRanks).toEqual([1, 2, 3, 4]);
    expect(result.upgrade).toBe(4);
  });

  it('non-sweep: ranks computed via point-differential', () => {
    // t1: positions 1, 3, 5, 7 (s0, s2, s4, s6)
    // points: 7+5+3+1 = 16; opps 6+4+2+0 = 12; diff = 4
    // t8 thresholds: g3:11, g2:5, g1:0 → diff 4 ≥ g1=0, < g2=5 → +1
    const r = finishedRound(
      SEATS_8P,
      ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'],
      '8'
    );
    const result = resolveRound(r, DEFAULT_MODE_RULES);
    expect(result.winnerTeam).toBe<TeamKey>('t1');
    expect(result.winnerRanks).toEqual([1, 3, 5, 7]);
    expect(result.upgrade).toBe(1);
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('resolveRound — error handling', () => {
  it('throws if round is not in "finished" phase', () => {
    const r: GameRound = {
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      hands: Object.fromEntries(SEATS_4P.map((s) => [s.id, []])),
      leader: 'a',
      phase: 'playing',
      finishOrder: ['a', 'b'],
      currentTrick: null,
    };
    expect(() => resolveRound(r, DEFAULT_MODE_RULES)).toThrow(/finished|phase/);
  });

  it('throws if finishOrder is incomplete', () => {
    const r: GameRound = {
      ...finishedRound(SEATS_4P, ['a', 'b', 'c', 'd'], '4'),
      finishOrder: ['a', 'b'],
    };
    expect(() => resolveRound(r, DEFAULT_MODE_RULES)).toThrow(/finishOrder/i);
  });
});
