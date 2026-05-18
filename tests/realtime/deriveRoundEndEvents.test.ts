// Behavior tests for deriveRoundEndEvents.

import { describe, expect, it } from 'vitest';
import { deriveRoundEndEvents } from '@lib/realtime/deriveRoundEndEvents';
import type { GameSession } from '@lib/game/session';
import type { RoundResult } from '@lib/game/resolveRound';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

function baseSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    teamLevels: { t1: '2', t2: '2' },
    teamAFails: { t1: 0, t2: 0 },
    roundOwner: null,
    finishedRounds: 0,
    phase: 'in_progress',
    winnerTeam: null,
    ...overrides,
  };
}

function sampleResult(overrides: Partial<RoundResult> = {}): RoundResult {
  return {
    winnerTeam: 't1',
    winnerRanks: [1, 2],
    upgrade: 3,
    details: { kind: '4p-table', position: [1, 2] },
    ...overrides,
  } as RoundResult;
}

describe('deriveRoundEndEvents — round_end only (game continues)', () => {
  it('emits a single round_end at baseVersion', () => {
    const pre = baseSession();
    const post = baseSession({
      teamLevels: { t1: '5', t2: '2' },
      roundOwner: 't1',
      finishedRounds: 1,
    });
    const events = deriveRoundEndEvents({
      preSession: pre,
      postSession: post,
      result: sampleResult(),
      baseVersion: 7,
    });
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.type).toBe('round_end');
    expect(e.version).toBe(7);
    if (e.type === 'round_end') {
      expect(e.winnerTeam).toBe('t1');
      expect(e.winnerRanks).toEqual([1, 2]);
      expect(e.upgrade).toBe(3);
      expect(e.newLevels).toEqual({ t1: '5', t2: '2' });
    }
  });

  it('does not mutate the postSession.teamLevels reference', () => {
    const post = baseSession({
      teamLevels: { t1: '5', t2: '2' },
      finishedRounds: 1,
    });
    const events = deriveRoundEndEvents({
      preSession: baseSession(),
      postSession: post,
      result: sampleResult(),
      baseVersion: 0,
    });
    if (events[0]?.type === 'round_end') {
      // Mutating the event's newLevels must not bleed back into the session.
      events[0].newLevels.t1 = '10';
    }
    expect(post.teamLevels.t1).toBe('5');
  });
});

describe('deriveRoundEndEvents — round_end + game_end (game finished)', () => {
  it('emits both events at sequential versions', () => {
    const post = baseSession({
      teamLevels: { t1: 'A', t2: '6' },
      roundOwner: 't1',
      finishedRounds: 4,
      phase: 'finished',
      winnerTeam: 't1',
    });
    const events = deriveRoundEndEvents({
      preSession: baseSession({ teamLevels: { t1: 'A', t2: '6' }, roundOwner: 't1' }),
      postSession: post,
      result: sampleResult({ upgrade: 1 }),
      baseVersion: 10,
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('round_end');
    expect(events[0]?.version).toBe(10);
    expect(events[1]?.type).toBe('game_end');
    expect(events[1]?.version).toBe(11);
    if (events[1]?.type === 'game_end') {
      expect(events[1].winnerTeam).toBe('t1');
      expect(events[1].summary).toMatch(/Team t1 wins/);
      expect(events[1].summary).toMatch(/4 rounds/);
    }
  });

  it('handles the rare path where postSession.winnerTeam is null by falling back to result.winnerTeam', () => {
    const post = baseSession({
      phase: 'finished',
      winnerTeam: null, // unusual but defensible
      finishedRounds: 1,
    });
    const events = deriveRoundEndEvents({
      preSession: baseSession(),
      postSession: post,
      result: sampleResult({ winnerTeam: 't2' }),
      baseVersion: 0,
    });
    expect(events).toHaveLength(2);
    if (events[1]?.type === 'game_end') {
      expect(events[1].winnerTeam).toBe('t2');
    }
  });

  it('summary uses singular "round" when finishedRounds === 1', () => {
    const events = deriveRoundEndEvents({
      preSession: baseSession(),
      postSession: baseSession({
        phase: 'finished',
        winnerTeam: 't1',
        finishedRounds: 1,
      }),
      result: sampleResult(),
      baseVersion: 0,
    });
    if (events[1]?.type === 'game_end') {
      expect(events[1].summary).toMatch(/1 round\./);
    }
  });
});
