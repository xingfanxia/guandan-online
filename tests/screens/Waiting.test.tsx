// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Waiting } from '@/screens/Waiting';
import { RoomApiError, type PublicRoomState } from '@/lib/api/rooms';
import type { RoomCredentials } from '@/lib/identity';

const HOST_CREDS: RoomCredentials = {
  code: 'K7M2P9',
  playerId: 'p0',
  joinToken: 'jt0',
  hostToken: 'ht0',
  storedAt: 0,
};

const GUEST_CREDS: RoomCredentials = {
  code: 'K7M2P9',
  playerId: 'p2',
  joinToken: 'jt2',
  storedAt: 0,
};

const ROOM_LOBBY_2OF4: PublicRoomState = {
  code: 'K7M2P9',
  mode: '4',
  phase: 'lobby',
  hostId: 'p0',
  members: [
    { id: 'p0', handle: '@阿祥', joinedAt: 0, status: 'connected' },
    { id: 'p1', handle: '@饭团', joinedAt: 1, status: 'connected' },
  ],
  createdAt: 0,
  lastActiveAt: 0,
};

const ROOM_FULL_4: PublicRoomState = {
  ...ROOM_LOBBY_2OF4,
  members: [
    { id: 'p0', handle: '@阿祥', joinedAt: 0, status: 'connected' },
    { id: 'p1', handle: '@饭团', joinedAt: 1, status: 'connected' },
    { id: 'p2', handle: '@泉酱', joinedAt: 2, status: 'connected' },
    { id: 'p3', handle: '@老郭', joinedAt: 3, status: 'connected' },
  ],
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('Waiting', () => {
  it('shows loading state before fetch', () => {
    const getRoomFn = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <Waiting
        code="K7M2P9"
        initialCredentials={HOST_CREDS}
        getRoomFn={getRoomFn}
        pollMs={0}
      />
    );
    expect(screen.getByText(/正在载入/)).toBeInTheDocument();
  });

  it('renders empty slots for missing members', async () => {
    render(
      <Waiting
        code="K7M2P9"
        initialCredentials={HOST_CREDS}
        initialRoom={ROOM_LOBBY_2OF4}
        pollMs={0}
      />
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    // Title is split across <em>2</em>/4 已就绪 — match on the heading.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/2.*4 已就绪/);
  });

  it('disables start when room not full', () => {
    render(
      <Waiting
        code="K7M2P9"
        initialCredentials={HOST_CREDS}
        initialRoom={ROOM_LOBBY_2OF4}
        pollMs={0}
      />
    );
    const startBtn = screen.getByRole('button', { name: /开始游戏/ });
    expect(startBtn).toBeDisabled();
    expect(startBtn).toHaveTextContent(/等 2 座位/);
  });

  it('enables start when full and triggers POST /start', async () => {
    const startFn = vi.fn().mockResolvedValue({ ok: true, version: 1 });
    const navigateFn = vi.fn();
    render(
      <Waiting
        code="K7M2P9"
        initialCredentials={HOST_CREDS}
        initialRoom={ROOM_FULL_4}
        startFn={startFn}
        navigateFn={navigateFn}
        pollMs={0}
      />
    );
    const startBtn = screen.getByRole('button', { name: /开始游戏/ });
    expect(startBtn).not.toBeDisabled();
    fireEvent.click(startBtn);
    await waitFor(() => expect(startFn).toHaveBeenCalledWith('K7M2P9', 'ht0'));
    await waitFor(() =>
      expect(navigateFn).toHaveBeenCalledWith({ kind: 'table', code: 'K7M2P9' })
    );
  });

  it('hides start button for non-host', () => {
    render(
      <Waiting
        code="K7M2P9"
        initialCredentials={GUEST_CREDS}
        initialRoom={ROOM_FULL_4}
        pollMs={0}
      />
    );
    expect(screen.queryByRole('button', { name: /开始游戏/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '离开房间' })).toBeInTheDocument();
  });

  it('detects in_game phase and navigates to /table', async () => {
    const getRoomFn = vi.fn().mockResolvedValue({ ...ROOM_FULL_4, phase: 'in_game' });
    const navigateFn = vi.fn();
    render(
      <Waiting
        code="K7M2P9"
        initialCredentials={HOST_CREDS}
        getRoomFn={getRoomFn}
        navigateFn={navigateFn}
        pollMs={0}
      />
    );
    await waitFor(() =>
      expect(navigateFn).toHaveBeenCalledWith({ kind: 'table', code: 'K7M2P9' })
    );
  });

  it('shows room_not_found error and clears credentials', async () => {
    const getRoomFn = vi.fn().mockRejectedValue(new RoomApiError(404, 'room_not_found'));
    window.localStorage.setItem(
      'guandan.tokens',
      JSON.stringify([HOST_CREDS])
    );
    render(
      <Waiting
        code="K7M2P9"
        initialCredentials={HOST_CREDS}
        getRoomFn={getRoomFn}
        pollMs={0}
      />
    );
    await waitFor(() => expect(screen.getByText(/房间已结束/)).toBeInTheDocument());
    expect(window.localStorage.getItem('guandan.tokens')).toBe('[]');
  });

  it('leave navigates to landing after API call', async () => {
    const leaveFn = vi.fn().mockResolvedValue({ ok: true });
    const navigateFn = vi.fn();
    render(
      <Waiting
        code="K7M2P9"
        initialCredentials={GUEST_CREDS}
        initialRoom={ROOM_FULL_4}
        leaveFn={leaveFn}
        navigateFn={navigateFn}
        pollMs={0}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '离开房间' }));
    await waitFor(() => expect(leaveFn).toHaveBeenCalledWith('K7M2P9', 'jt2'));
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith({ kind: 'landing' }));
  });

  it('marks current player with "我" chip', () => {
    render(
      <Waiting
        code="K7M2P9"
        initialCredentials={GUEST_CREDS}
        initialRoom={ROOM_FULL_4}
        pollMs={0}
      />
    );
    expect(screen.getByText('我')).toBeInTheDocument();
  });

  it('shows host chip on host slot', () => {
    render(
      <Waiting
        code="K7M2P9"
        initialCredentials={HOST_CREDS}
        initialRoom={ROOM_FULL_4}
        pollMs={0}
      />
    );
    // "房主" appears as a topnav label AND as a chip on the host slot
    expect(screen.getAllByText('房主').length).toBeGreaterThanOrEqual(2);
  });
});
