import { describe, expect, it } from 'vitest';
import {
  isHeartbeat,
  isStreamClosing,
  serverEventType,
} from '@lib/realtime/messages';
import type {
  ServerEvent,
  HeartbeatEvent,
  SnapshotEvent,
  StreamClosingEvent,
} from '@lib/realtime/messages';

// ─── Discriminator coverage (exhaustive never-check via serverEventType) ──────

describe('serverEventType — exhaustive union check', () => {
  it('returns the literal type string for every ServerEvent kind', () => {
    const samples: ServerEvent[] = [
      {
        type: 'snapshot',
        version: 1,
        you: { playerId: 'p1', hand: [], teamId: 't1', partnerId: 'p2' },
        table: {
          currentTurn: 'p1',
          currentTrick: [],
          lastTrick: null,
          teamLevels: { t1: '2', t2: '2' },
          roundOwner: 't1',
          phase: 'playing',
          turnDeadline: '2026-05-18T00:00:00Z',
        },
        players: [],
      },
      { type: 'room_joined', version: 2, player: { id: 'p1', handle: '@p1', team: 't1', handCount: 27, status: 'connected', rank: null } },
      { type: 'room_left', version: 3, playerId: 'p1', reason: 'disconnect' },
      { type: 'deal', version: 4, yourHand: ['5-S-1'], publicHandCounts: { p1: 27, p2: 27, p3: 27, p4: 27 }, roundOwner: 't1' },
      {
        type: 'move_played', version: 5, player: 'p1', cards: ['K-S-1'],
        combinationLabel: 'Single', nextTurn: 'p2', turnDeadline: '2026-05-18T00:00:30Z',
      },
      { type: 'move_passed', version: 6, player: 'p1', nextTurn: 'p2', turnDeadline: '2026-05-18T00:00:30Z' },
      { type: 'trick_won', version: 7, winner: 'p1', nextLeader: 'p3' },
      {
        type: 'tribute_pending', version: 8, direction: 'single',
        obligations: [{ from: 'p4', to: 'p1', constraint: 'highest_non_heart' }],
      },
      { type: 'tribute_resolved', version: 9, exchanged: [{ from: 'p4', to: 'p1', card: 'A-D-1' }] },
      { type: 'round_end', version: 10, winnerTeam: 't1', winnerRanks: [1, 2], upgrade: 3, newLevels: { t1: '5', t2: '2' } },
      { type: 'game_end', version: 11, winnerTeam: 't1', summary: 'pass-A clean' },
      {
        type: 'state_resync', version: 12, reason: 'buffer_exhausted',
        snapshot: {
          type: 'snapshot', version: 12,
          you: { playerId: 'p1', hand: [], teamId: 't1', partnerId: 'p2' },
          table: {
            currentTurn: 'p1', currentTrick: [], lastTrick: null,
            teamLevels: { t1: '2', t2: '2' }, roundOwner: 't1',
            phase: 'playing', turnDeadline: '2026-05-18T00:00:00Z',
          },
          players: [],
        },
      },
      { type: 'turn_advanced', version: 13, currentTurn: 'p2', turnDeadline: '2026-05-18T00:00:30Z' },
      { type: 'heartbeat', version: 14, serverTime: '2026-05-18T00:00:10Z' },
      { type: 'stream_closing', version: 15, retryAfterMs: 100, reason: 'rotation' },
    ];

    const expected = [
      'snapshot', 'room_joined', 'room_left', 'deal', 'move_played',
      'move_passed', 'trick_won', 'tribute_pending', 'tribute_resolved',
      'round_end', 'game_end', 'state_resync', 'turn_advanced', 'heartbeat',
      'stream_closing',
    ];

    expect(samples).toHaveLength(15);
    samples.forEach((ev, i) => {
      expect(serverEventType(ev), `index ${i}`).toBe(expected[i]);
    });
  });
});

// ─── Type guards ──────────────────────────────────────────────────────────────

describe('type guards', () => {
  it('isHeartbeat narrows correctly', () => {
    const hb: HeartbeatEvent = { type: 'heartbeat', version: 1, serverTime: '2026-05-18T00:00:00Z' };
    const sc: StreamClosingEvent = { type: 'stream_closing', version: 2, retryAfterMs: 100, reason: 'rotation' };
    expect(isHeartbeat(hb)).toBe(true);
    expect(isHeartbeat(sc)).toBe(false);
  });

  it('isStreamClosing narrows correctly', () => {
    const hb: HeartbeatEvent = { type: 'heartbeat', version: 1, serverTime: '2026-05-18T00:00:00Z' };
    const sc: StreamClosingEvent = { type: 'stream_closing', version: 2, retryAfterMs: 100, reason: 'rotation' };
    expect(isStreamClosing(sc)).toBe(true);
    expect(isStreamClosing(hb)).toBe(false);
  });
});

// ─── Snapshot event shape (sanity — version on every event) ───────────────────

describe('all events carry version + type', () => {
  it('SnapshotEvent has the expected fields', () => {
    const snap: SnapshotEvent = {
      type: 'snapshot',
      version: 42,
      you: { playerId: 'p1', hand: ['5-S-1', '6-S-1'], teamId: 't1', partnerId: 'p2' },
      table: {
        currentTurn: 'p1',
        currentTrick: [],
        lastTrick: null,
        teamLevels: { t1: '5', t2: '4' },
        roundOwner: 't1',
        phase: 'playing',
        turnDeadline: '2026-05-18T00:00:00Z',
      },
      players: [
        { id: 'p1', handle: '@me', team: 't1', handCount: 2, status: 'connected', rank: null },
      ],
    };
    expect(snap.version).toBe(42);
    expect(snap.type).toBe('snapshot');
    expect(snap.you.hand).toHaveLength(2);
  });
});
