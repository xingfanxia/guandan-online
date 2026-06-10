// Regression tests for the 2026-06-09 playability audit fixes:
//  1. splitSeats locates the local player by myPlayerId (server-assigned),
//     falling back to NORMALIZED handle compare — server handles are bare
//     lowercase ("axplayer") while client handles are @-prefixed
//     ("@axplayer"), so raw === never matched and no opponents rendered.
//  2. snapshotVersion skip-guard — backlog events at or below the connect
//     snapshot's version are already baked into the snapshot; re-reducing
//     them double-decrements hand counts.
//  3. deal.leader → currentTurn — without it the new round's leader has
//     stale turn state and the action buttons soft-lock.
//  4. round_end / game_end produce the RoundEnd / Victory view state (the
//     screens existed but were never driven by events).

import { describe, expect, it } from 'vitest';
import {
  reduceEvent,
  splitSeats,
} from '@/screens/GameTable4P';
import { handlesEqual } from '@/lib/identity';
import type {
  DealEvent,
  GameEndEvent,
  MovePlayedEvent,
  PlayerSummary,
  RoundEndEvent,
  SnapshotEvent,
} from '@lib/realtime/messages';

const PLAYERS: PlayerSummary[] = [
  { id: 'p0', handle: 'axplayer', team: 't1', handCount: 27, status: 'connected', rank: null },
  { id: 'p1', handle: '@飞飞', team: 't2', handCount: 27, status: 'bot', rank: null },
  { id: 'p2', handle: '@小猪', team: 't1', handCount: 27, status: 'bot', rank: null },
  { id: 'p3', handle: '@团团', team: 't2', handCount: 27, status: 'bot', rank: null },
];

const SNAPSHOT: SnapshotEvent = {
  type: 'snapshot',
  version: 40,
  you: { playerId: 'p0', hand: ['A-S-1', 'K-H-1'], teamId: 't1', partnerId: 'p2' },
  table: {
    currentTurn: 'p0',
    currentTrick: [{ player: 'p3', cards: ['3-C-1'] }],
    lastTrick: null,
    teamLevels: { t1: '5', t2: '3' },
    roundOwner: 't1',
    phase: 'playing',
    turnDeadline: '2026-06-09T00:00:00Z',
  },
  players: PLAYERS,
};

const EMPTY = {
  myHand: [],
  players: new Map<string, PlayerSummary>(),
  teamLevels: { t1: '2', t2: '2' } as const,
  currentTurn: null,
  lastPlayed: null,
  myPlayerId: null,
  myTeam: null,
  partnerId: null,
  tribute: null,
  roundNumber: 1,
  lastRoundWinnerTeam: null,
  exchange: null,
};

describe('handlesEqual — server/client normalization drift', () => {
  it('matches @-prefixed client handle against bare server handle', () => {
    expect(handlesEqual('@axplayer', 'axplayer')).toBe(true);
    expect(handlesEqual('@AXplayer', 'axplayer')).toBe(true);
    expect(handlesEqual('@飞飞', '@飞飞')).toBe(true);
    expect(handlesEqual('@a', '@b')).toBe(false);
    expect(handlesEqual(null, 'a')).toBe(false);
  });
});

describe('snapshot → roster + identity + trick rebuild', () => {
  it('populates players, myPlayerId, currentTurn, and mid-trick lastPlayed', () => {
    const next = reduceEvent(EMPTY, SNAPSHOT, '@axplayer');
    expect(next.players.size).toBe(4);
    expect(next.myPlayerId).toBe('p0');
    expect(next.myTeam).toBe('t1');
    expect(next.currentTurn).toBe('p0');
    expect(next.teamLevels).toEqual({ t1: '5', t2: '3' });
    // Trick rebuilt from table.currentTrick (reload mid-trick).
    expect(next.lastPlayed?.player).toBe('@团团');
    expect(next.lastPlayed?.cards).toHaveLength(1);
    expect(next.snapshotVersion).toBe(40);
  });

  it('splitSeats finds me by playerId despite the handle drift', () => {
    const state = reduceEvent(EMPTY, SNAPSHOT, '@axplayer');
    const seats = splitSeats(state, '@axplayer');
    expect(seats.partner?.id).toBe('p2');
    expect(seats.left?.id).toBe('p1');
    expect(seats.right?.id).toBe('p3');
  });
});

describe('snapshotVersion skip-guard', () => {
  const base = reduceEvent(EMPTY, SNAPSHOT, '@axplayer');

  const movePlayed = (version: number): MovePlayedEvent => ({
    type: 'move_played',
    version,
    player: 'p1',
    cards: ['4-C-1'],
    combinationLabel: 'single',
    nextTurn: 'p2',
    turnDeadline: '2026-06-09T00:00:30Z',
  });

  it('skips backlog events at or below the snapshot version', () => {
    const next = reduceEvent(base, movePlayed(40), '@axplayer');
    expect(next).toBe(base); // untouched — no double decrement
    expect(next.players.get('p1')?.handCount).toBe(27);
  });

  it('applies live events above the snapshot version', () => {
    const next = reduceEvent(base, movePlayed(41), '@axplayer');
    expect(next.players.get('p1')?.handCount).toBe(26);
    expect(next.currentTurn).toBe('p2');
  });

  it('still applies modal-state events at or below the snapshot version', () => {
    const next = reduceEvent(
      base,
      {
        type: 'tribute_pending',
        version: 39,
        direction: 'single',
        obligations: [{ from: 'p0', to: 'p2', constraint: 'highest_non_heart' }],
      },
      '@axplayer',
    );
    expect(next.tribute).not.toBeNull();
  });
});

describe('deal — leader + public count reset + finishOrder reset', () => {
  const base = reduceEvent(EMPTY, SNAPSHOT, '@axplayer');

  const deal: DealEvent = {
    type: 'deal',
    version: 41,
    yourHand: ['2-S-1'],
    publicHandCounts: { p0: 27, p1: 27, p2: 27, p3: 27 },
    roundOwner: 't1',
    leader: 'p2',
  };

  it('sets currentTurn from the deal leader (cross-round soft-lock fix)', () => {
    const next = reduceEvent(base, deal, '@axplayer');
    expect(next.currentTurn).toBe('p2');
    expect(next.players.get('p1')?.handCount).toBe(27);
    expect(next.finishOrder).toEqual([]);
  });

  it('keeps prior currentTurn when leader is absent (legacy log entries)', () => {
    const { leader: _leader, ...legacy } = deal;
    const next = reduceEvent(base, legacy as DealEvent, '@axplayer');
    expect(next.currentTurn).toBe('p0');
  });
});

describe('round_end / game_end views', () => {
  const base = reduceEvent(EMPTY, SNAPSHOT, '@axplayer');

  it('round_end captures the RoundEnd overlay view with was/now levels', () => {
    // p2 then p0 finish first.
    let s = reduceEvent(
      base,
      {
        ...({
          type: 'move_played',
          version: 41,
          player: 'p2',
          cards: Array.from({ length: 27 }, () => '4-S-1'),
          combinationLabel: 'single',
          nextTurn: 'p3',
          turnDeadline: 'now',
        } as MovePlayedEvent),
      },
      '@axplayer',
    );
    expect(s.finishOrder).toEqual([{ id: 'p2', handle: '@小猪' }]);

    const roundEnd: RoundEndEvent = {
      type: 'round_end',
      version: 42,
      winnerTeam: 't1',
      winnerRanks: [1, 3],
      upgrade: 2,
      newLevels: { t1: '7', t2: '3' },
    };
    s = reduceEvent(s, roundEnd, '@axplayer');
    expect(s.roundEndView).toEqual({
      roundNumber: 1,
      winnerTeam: 't1',
      upgrade: 2,
      wasLevel: '5',
      nowLevel: '7',
      finishOrder: [{ id: 'p2', handle: '@小猪' }],
    });
    expect(s.teamLevels.t1).toBe('7');
  });

  it('game_end captures the Victory view', () => {
    const gameEnd: GameEndEvent = {
      type: 'game_end',
      version: 43,
      winnerTeam: 't1',
      summary: 't1 通关',
    };
    const s = reduceEvent(base, gameEnd, '@axplayer');
    expect(s.gameEndView).toEqual({ winnerTeam: 't1', summary: 't1 通关' });
  });
});
