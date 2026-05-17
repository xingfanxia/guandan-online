import { describe, expect, it } from 'vitest';
import { checkALevelRules } from '@lib/game/aLevel';
import type { ALevelInput } from '@lib/game/aLevel';
import type { LevelRank } from '@lib/game/levels';
import type { GameMode, TeamKey } from '@lib/game/mode';

/** Builder for ALevelInput with sensible defaults. */
function input(overrides: Partial<ALevelInput> = {}): ALevelInput {
  return {
    winnerKey: 't1',
    ranks: [1, 2],
    mode: '4',
    teamLevels: { t1: '2', t2: '2' },
    teamAFails: { t1: 0, t2: 0 },
    roundOwner: 't1',
    roundLevel: '2',
    strictA: true,
    ...overrides,
  };
}

describe('checkALevelRules — no team at A', () => {
  it('returns nothing actionable (aTeam: null, finalWin: false)', () => {
    const r = checkALevelRules(input({ teamLevels: { t1: 'K', t2: 'Q' } }));
    expect(r.aTeam).toBeNull();
    expect(r.finalWin).toBe(false);
    expect(r.aNote).toBe('');
  });
});

describe('checkALevelRules — A-team WON cleanly', () => {
  it('4P strict: clean win on own A round → finalWin (PASS)', () => {
    const r = checkALevelRules(
      input({
        teamLevels: { t1: 'A', t2: 'K' },
        roundOwner: 't1',
        roundLevel: 'A',
        ranks: [1, 2], // no last (4P last = 4)
      })
    );
    expect(r.aTeam).toBe('t1');
    expect(r.finalWin).toBe(true);
    expect(r.aNote).toContain('A级通关');
    expect(r.aNote).toContain('在自己的A级');
  });

  it('4P strict: clean win on OPPONENT round → stays at A (not PASS)', () => {
    const r = checkALevelRules(
      input({
        teamLevels: { t1: 'A', t2: 'K' },
        roundOwner: 't2', // opponent's round
        roundLevel: 'K', // not A
        ranks: [1, 2],
      })
    );
    expect(r.finalWin).toBe(false);
    expect(r.winnerNewLevel).toBe('A'); // stays
    expect(r.aNote).toContain('需在自己的A级');
  });

  it('4P strict: clean win at A but not own round → stays', () => {
    const r = checkALevelRules(
      input({
        teamLevels: { t1: 'A', t2: 'K' },
        roundOwner: 't2',
        roundLevel: 'A',
        ranks: [1, 2],
      })
    );
    expect(r.finalWin).toBe(false);
    expect(r.aNote).toContain('需在自己的A级');
  });

  it('4P lenient: clean win on opponent round → finalWin (PASS)', () => {
    const r = checkALevelRules(
      input({
        teamLevels: { t1: 'A', t2: 'K' },
        roundOwner: 't2',
        roundLevel: '5',
        ranks: [1, 2],
        strictA: false,
      })
    );
    expect(r.finalWin).toBe(true);
    expect(r.aNote).toContain('A级通关');
    expect(r.aNote).not.toContain('在自己的A级');
  });
});

describe('checkALevelRules — A-team WON dirty (winner has last)', () => {
  it('4P own A round + dirty win → A-fail++ (A1)', () => {
    const r = checkALevelRules(
      input({
        teamLevels: { t1: 'A', t2: 'K' },
        teamAFails: { t1: 0, t2: 0 },
        roundOwner: 't1',
        roundLevel: 'A',
        ranks: [1, 4], // 4P last = 4
      })
    );
    expect(r.finalWin).toBe(false);
    expect(r.aNote).toMatch(/A1/);
    expect(r.winnerNewLevel).toBe('A'); // stays at A
    expect(r.newAFails).toEqual({ t1: 1 });
  });

  it('4P own A round, third dirty win → demote to 2', () => {
    const r = checkALevelRules(
      input({
        teamLevels: { t1: 'A', t2: 'K' },
        teamAFails: { t1: 2, t2: 0 }, // already at A2
        roundOwner: 't1',
        roundLevel: 'A',
        ranks: [1, 4],
      })
    );
    expect(r.finalWin).toBe(false);
    expect(r.winnerNewLevel).toBe('2'); // demoted
    expect(r.newAFails).toEqual({ t1: 0 }); // counter reset
    expect(r.aNote).toContain('累计3次失败');
  });

  it('4P opponent round + dirty win → no fail (sibling rule)', () => {
    const r = checkALevelRules(
      input({
        teamLevels: { t1: 'A', t2: 'K' },
        teamAFails: { t1: 0, t2: 0 },
        roundOwner: 't2', // opponent's round
        roundLevel: 'K',
        ranks: [1, 4],
      })
    );
    expect(r.finalWin).toBe(false);
    expect(r.newAFails).toEqual({}); // no change
    expect(r.aNote).toContain('A失败不计');
    expect(r.winnerNewLevel).toBe('A');
  });

  it('6P own A round + dirty win → stays at A, NO fail counter', () => {
    const r = checkALevelRules(
      input({
        mode: '6',
        teamLevels: { t1: 'A', t2: 'K' },
        teamAFails: { t1: 0, t2: 0 },
        roundOwner: 't1',
        roundLevel: 'A',
        ranks: [1, 2, 6], // 6P last = 6
      })
    );
    expect(r.finalWin).toBe(false);
    expect(r.newAFails).toEqual({}); // 6P doesn't track
    expect(r.aNote).toContain('继续打到通关');
    expect(r.winnerNewLevel).toBe('A');
  });

  it('8P own A round + dirty win → stays at A, NO fail counter', () => {
    const r = checkALevelRules(
      input({
        mode: '8',
        teamLevels: { t1: 'A', t2: 'K' },
        roundOwner: 't1',
        roundLevel: 'A',
        ranks: [1, 2, 3, 8], // 8P last = 8
      })
    );
    expect(r.finalWin).toBe(false);
    expect(r.newAFails).toEqual({});
    expect(r.winnerNewLevel).toBe('A');
  });
});

describe('checkALevelRules — A-team LOST', () => {
  it('4P own A round + loss → fail++ (A1)', () => {
    // T1 is at A, T2 wins
    const r = checkALevelRules(
      input({
        winnerKey: 't2',
        teamLevels: { t1: 'A', t2: 'K' },
        teamAFails: { t1: 0, t2: 0 },
        roundOwner: 't1',
        roundLevel: 'A',
        ranks: [1, 2],
      })
    );
    expect(r.aTeam).toBe('t1');
    expect(r.finalWin).toBe(false);
    expect(r.aNote).toMatch(/A1/);
    expect(r.newAFails).toEqual({ t1: 1 });
  });

  it('4P own A round + third loss → demote loser to 2', () => {
    const r = checkALevelRules(
      input({
        winnerKey: 't2',
        teamLevels: { t1: 'A', t2: 'K' },
        teamAFails: { t1: 2, t2: 0 },
        roundOwner: 't1',
        roundLevel: 'A',
        ranks: [1, 2],
      })
    );
    expect(r.aTeam).toBe('t1');
    expect(r.loserNewLevel).toBe('2'); // T1 demoted
    expect(r.newAFails).toEqual({ t1: 0 });
    expect(r.aNote).toContain('累计3次失败');
  });

  it('4P opponent round + loss → no fail', () => {
    const r = checkALevelRules(
      input({
        winnerKey: 't2',
        teamLevels: { t1: 'A', t2: 'K' },
        roundOwner: 't2', // not A-team's round
        roundLevel: 'K',
        ranks: [1, 2],
      })
    );
    expect(r.newAFails).toEqual({});
    expect(r.aNote).toContain('未胜');
    expect(r.aNote).toContain('A失败不计');
  });

  it('6P own A round + loss → stays at A, no fail', () => {
    const r = checkALevelRules(
      input({
        mode: '6',
        winnerKey: 't2',
        teamLevels: { t1: 'A', t2: 'K' },
        roundOwner: 't1',
        roundLevel: 'A',
        ranks: [1, 2, 3],
      })
    );
    expect(r.newAFails).toEqual({});
    expect(r.aNote).toContain('继续打到通关');
  });
});

describe('checkALevelRules — both teams at A', () => {
  it('winner is the team evaluated', () => {
    const r = checkALevelRules(
      input({
        winnerKey: 't2',
        teamLevels: { t1: 'A', t2: 'A' },
        roundOwner: 't2',
        roundLevel: 'A',
        ranks: [1, 2],
      })
    );
    expect(r.aTeam).toBe('t2');
    expect(r.finalWin).toBe(true);
  });

  it('both at A, winner wins dirty on own round → fail counter increments on winner', () => {
    const r = checkALevelRules(
      input({
        winnerKey: 't1',
        teamLevels: { t1: 'A', t2: 'A' },
        teamAFails: { t1: 0, t2: 0 },
        roundOwner: 't1',
        roundLevel: 'A',
        ranks: [1, 4],
      })
    );
    expect(r.aTeam).toBe('t1');
    expect(r.newAFails).toEqual({ t1: 1 });
  });
});

describe('checkALevelRules — null roundOwner (first round / brand-new game)', () => {
  it("doesn't crash; uses '未定' in note", () => {
    const r = checkALevelRules(
      input({
        winnerKey: 't2',
        teamLevels: { t1: 'A', t2: 'K' },
        roundOwner: null,
        roundLevel: 'A',
        ranks: [1, 2],
      })
    );
    // T1 at A, T2 won → not own A round (roundOwner is null) → no fail
    expect(r.newAFails).toEqual({});
    expect(r.aNote).toContain('未定');
  });
});

// Type guard the test fixture exhaustively
const _modes: GameMode[] = ['4', '6', '8'];
const _teams: TeamKey[] = ['t1', 't2'];
const _levels: LevelRank[] = ['2', 'A'];
void _modes;
void _teams;
void _levels;
