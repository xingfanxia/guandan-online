import { describe, expect, it } from 'vitest';
import { buildLobbyGameState } from '@lib/realtime/buildLobbyGameState';
import type { RoomState } from '@lib/room/lifecycle';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

function lobbyRoom(memberIds: readonly string[]): RoomState {
  return {
    code: 'A2B3C4',
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: 'p0',
    hostToken: 'host-tok',
    members: memberIds.map((id, i) => ({
      id,
      handle: `@${id}`,
      joinToken: `jt-${i}`,
      joinedAt: 0,
      status: 'connected' as const,
    })),
    phase: 'lobby',
    createdAt: 0,
    lastActiveAt: 0,
    eventVersion: 0,
  };
}

describe('buildLobbyGameState', () => {
  it('populates hands with empty arrays for every member', () => {
    const state = buildLobbyGameState(lobbyRoom(['p0', 'p1', 'p2']));
    expect(state.hands).toEqual({ p0: [], p1: [], p2: [] });
  });

  it('alternates teams by member index', () => {
    const state = buildLobbyGameState(lobbyRoom(['p0', 'p1', 'p2', 'p3']));
    expect(state.teams).toEqual({ p0: 't1', p1: 't2', p2: 't1', p3: 't2' });
  });

  it('uses member handles', () => {
    const state = buildLobbyGameState(lobbyRoom(['p0', 'p1']));
    expect(state.handles['p0']).toBe('@p0');
    expect(state.handles['p1']).toBe('@p1');
  });

  it('returns empty hands so leak detector trivially passes', () => {
    // Smoke check: no opponent cards to leak since hands are all empty.
    const state = buildLobbyGameState(lobbyRoom(['p0', 'p1']));
    for (const id of Object.keys(state.hands)) {
      expect(state.hands[id]).toEqual([]);
    }
  });

  it('returns null ranks for everyone', () => {
    const state = buildLobbyGameState(lobbyRoom(['p0', 'p1']));
    expect(state.ranks).toEqual({ p0: null, p1: null });
  });
});
