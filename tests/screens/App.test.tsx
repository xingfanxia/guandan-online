// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Stub the SSE-heavy table components so App's routing can be tested without
// opening EventSource connections. Each stub renders an identifiable marker.
vi.mock('@/screens/GameTable4P', () => ({
  GameTable4P: (p: { roomId: string }) => <div>TABLE4P:{p.roomId}</div>,
}));
vi.mock('@/screens/GameTableMP', () => ({
  GameTableMP: (p: { roomId: string; mode: string }) => (
    <div>TABLEMP:{p.mode}:{p.roomId}</div>
  ),
}));
// Landing / CreateRoom / Waiting are real but lightweight; only getRoom needs
// control for the TableSwitch fetch.
const getRoom = vi.fn();
vi.mock('@/lib/api/rooms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/rooms')>();
  return { ...actual, getRoom: (...a: unknown[]) => getRoom(...a) };
});
import { storeCredentials } from '@/lib/identity';
import App from '@/App';

function setHash(h: string): void {
  window.location.hash = h;
}

describe('App routing', () => {
  beforeEach(() => {
    getRoom.mockReset();
    localStorage.clear();
    setHash('');
  });
  afterEach(() => {
    setHash('');
  });

  it('renders Landing at #/', () => {
    setHash('#/');
    render(<App />);
    // Landing has a sign-in / join affordance; assert it mounted (not a table).
    expect(screen.queryByText(/TABLE4P|TABLEMP/)).not.toBeInTheDocument();
  });

  it('shows MissingCreds when navigating to a table without stored creds', () => {
    setHash('#/table?code=K7M2P9');
    render(<App />);
    expect(screen.getByText(/需要先加入房间/)).toBeInTheDocument();
  });

  it('TableSwitch shows loading then dispatches to GameTable4P for a 4P room', async () => {
    storeCredentials({
      code: 'K7M2P9',
      playerId: 'p0',
      joinToken: 'jt0',
      handle: '@me',
      storedAt: 0,
    });
    getRoom.mockResolvedValue({ code: 'K7M2P9', mode: '4', phase: 'lobby', hostId: 'p0', members: [] });
    setHash('#/table?code=K7M2P9');
    render(<App />);
    expect(screen.getByText(/连接 K7M2P9/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('TABLE4P:K7M2P9')).toBeInTheDocument());
  });

  it('TableSwitch dispatches to GameTableMP for a 6P room', async () => {
    storeCredentials({
      code: 'R3R8K1',
      playerId: 'p0',
      joinToken: 'jt0',
      handle: '@me',
      storedAt: 0,
    });
    getRoom.mockResolvedValue({ code: 'R3R8K1', mode: '6', phase: 'lobby', hostId: 'p0', members: [] });
    setHash('#/table?code=R3R8K1');
    render(<App />);
    await waitFor(() => expect(screen.getByText('TABLEMP:6:R3R8K1')).toBeInTheDocument());
  });

  it('TableSwitch surfaces a fetch error', async () => {
    storeCredentials({
      code: 'E5E5E5',
      playerId: 'p0',
      joinToken: 'jt0',
      handle: '@me',
      storedAt: 0,
    });
    getRoom.mockRejectedValue(new Error('room_not_found'));
    setHash('#/table?code=E5E5E5');
    render(<App />);
    await waitFor(() => expect(screen.getByText(/无法载入房间/)).toBeInTheDocument());
    expect(screen.getByText(/room_not_found/)).toBeInTheDocument();
  });
});
