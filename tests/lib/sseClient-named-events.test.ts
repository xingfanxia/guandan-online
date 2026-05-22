// SSE client unit tests — covers the named-event dispatch bug fix.
//
// Bug: server emits `event: deal` (and other named types) per
// `lib/realtime/sse.ts formatEvent`. Per the SSE spec, named events route to
// addEventListener(name, ...) rather than onmessage. The previous client used
// only `es.onmessage` and silently dropped every event.
//
// These tests:
//   1. Construct a mock EventSource that simulates named-event delivery.
//   2. Verify openSseClient receives every ServerEvent type via the onEvent
//      callback, regardless of whether the event was unnamed (default
//      `message`) or named (`deal`, `move_played`, etc.).

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openSseClient } from '@/lib/sseClient';

// Real EventSource isn't available in jsdom by default; create a minimal stub
// that records listener registrations and fires synthetic events.
class FakeEventSource {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];

  url: string;
  readyState: number = FakeEventSource.OPEN;
  onmessage: ((ev: MessageEvent<string>) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;

  private listeners = new Map<string, Array<(ev: MessageEvent<string>) => void>>();

  constructor(url: string | URL) {
    this.url = url.toString();
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (ev: MessageEvent<string>) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }

  removeEventListener(type: string, fn: (ev: MessageEvent<string>) => void): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    this.listeners.set(
      type,
      arr.filter((f) => f !== fn)
    );
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Test utility — simulate a server-sent named event. */
  emit(eventName: string | null, data: unknown): void {
    const msg = new MessageEvent('message', { data: JSON.stringify(data) });
    if (eventName) {
      for (const fn of this.listeners.get(eventName) ?? []) fn(msg);
    } else {
      this.onmessage?.(msg);
    }
  }
}

describe('openSseClient — named-event dispatch', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    // jsdom doesn't ship EventSource — install our fake.
    (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource =
      FakeEventSource;
  });

  it('passes named "deal" event to onEvent (regression for the silent-drop bug)', () => {
    const onEvent = vi.fn();
    openSseClient({ roomId: 'ABCDEF', joinToken: 'tok', onEvent });
    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0]!;

    es.emit('deal', { type: 'deal', version: 1, yourHand: ['2-S-1'] });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ type: 'deal', version: 1 });
  });

  it('passes every ServerEvent type through the named-event channel', () => {
    const onEvent = vi.fn();
    openSseClient({ roomId: 'ABCDEF', joinToken: 'tok', onEvent });
    const es = FakeEventSource.instances[0]!;

    const types = [
      'snapshot',
      'deal',
      'room_joined',
      'room_left',
      'move_played',
      'move_passed',
      'trick_won',
      'tribute_pending',
      'tribute_resolved',
      'round_end',
      'game_end',
      'state_resync',
      'turn_advanced',
      'heartbeat',
      'stream_closing',
    ] as const;

    types.forEach((type, idx) => {
      es.emit(type, { type, version: idx + 1 });
    });
    expect(onEvent).toHaveBeenCalledTimes(types.length);
    types.forEach((type, idx) => {
      expect(onEvent.mock.calls[idx]![0]).toMatchObject({ type, version: idx + 1 });
    });
  });

  it('still handles unnamed events via onmessage (backward-compat)', () => {
    const onEvent = vi.fn();
    openSseClient({ roomId: 'ABCDEF', joinToken: 'tok', onEvent });
    const es = FakeEventSource.instances[0]!;
    es.emit(null, { type: 'heartbeat', version: 5 });
    expect(onEvent).toHaveBeenCalledWith({ type: 'heartbeat', version: 5 });
  });

  it('updates lastVersion as events stream in', () => {
    const onEvent = vi.fn();
    const client = openSseClient({ roomId: 'ABCDEF', joinToken: 'tok', onEvent });
    const es = FakeEventSource.instances[0]!;
    es.emit('deal', { type: 'deal', version: 4 });
    expect(client.lastVersion).toBe(4);
    es.emit('move_played', { type: 'move_played', version: 7 });
    expect(client.lastVersion).toBe(7);
  });

  it('logs but does not throw on malformed JSON', () => {
    const onEvent = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    openSseClient({ roomId: 'ABCDEF', joinToken: 'tok', onEvent });
    const es = FakeEventSource.instances[0]!;
    // Emit malformed payload directly via the onmessage channel.
    const malformed = new MessageEvent('message', { data: '{not-json' });
    es.onmessage?.(malformed);
    expect(onEvent).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[sseClient] malformed event payload',
      expect.anything()
    );
    errorSpy.mockRestore();
  });

  it('appends token + fromVersion as query params on the URL', () => {
    const onEvent = vi.fn();
    openSseClient({
      roomId: 'ABCDEF',
      joinToken: 'tok-123',
      fromVersion: 10,
      onEvent,
    });
    const url = new URL(FakeEventSource.instances[0]!.url);
    expect(url.pathname).toBe('/api/sse/ABCDEF');
    expect(url.searchParams.get('token')).toBe('tok-123');
    expect(url.searchParams.get('fromVersion')).toBe('10');
  });
});

// ─── F-I1 — visibilitychange reconnect + getInitialVersion ───────────────────

describe('openSseClient — visibilitychange reconnect (F-I1)', () => {
  // Track every opened client so each test can dispose its own listener.
  // Without this, a leftover document.visibilitychange listener from an
  // earlier test fires during the next test's dispatchEvent and reconnects
  // its (now-closed) EventSource → extra FakeEventSource instances appear.
  const clients: Array<{ close: () => void }> = [];

  beforeEach(() => {
    FakeEventSource.instances = [];
    clients.length = 0;
    (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource =
      FakeEventSource;
  });

  afterEach(() => {
    for (const c of clients) {
      try {
        c.close();
      } catch {
        /* noop */
      }
    }
    clients.length = 0;
  });

  function open(opts: Parameters<typeof openSseClient>[0]): ReturnType<typeof openSseClient> {
    const c = openSseClient(opts);
    clients.push(c);
    return c;
  }

  function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
  }

  it('reopens the EventSource when tab becomes visible AND prior socket is CLOSED', () => {
    setVisibility('visible');
    open({ roomId: 'ABCDEF', joinToken: 'tok', onEvent: vi.fn() });
    expect(FakeEventSource.instances).toHaveLength(1);
    const first = FakeEventSource.instances[0]!;

    // Simulate the browser closing the socket (e.g., past the 270s rotation
    // window while backgrounded).
    first.readyState = FakeEventSource.CLOSED;

    // Tab becomes visible — the visibilitychange handler should detect the
    // CLOSED state and open a fresh EventSource.
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(FakeEventSource.instances.length).toBe(2);
  });

  it('does NOT reconnect while the existing socket is OPEN', () => {
    setVisibility('visible');
    open({ roomId: 'ABCDEF', joinToken: 'tok', onEvent: vi.fn() });
    expect(FakeEventSource.instances).toHaveLength(1);
    const first = FakeEventSource.instances[0]!;
    first.readyState = FakeEventSource.OPEN;

    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeEventSource.instances.length).toBe(1);
  });

  it('does NOT reconnect when tab is hidden', () => {
    setVisibility('visible');
    open({ roomId: 'ABCDEF', joinToken: 'tok', onEvent: vi.fn() });
    const first = FakeEventSource.instances[0]!;
    first.readyState = FakeEventSource.CLOSED;
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeEventSource.instances.length).toBe(1);
  });

  it('uses getInitialVersion() as the resume version on reconnect', () => {
    setVisibility('visible');
    let storedVersion = 42;
    open({
      roomId: 'ABCDEF',
      joinToken: 'tok',
      getInitialVersion: () => storedVersion,
      onEvent: vi.fn(),
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    // Initial URL picks up version=42.
    expect(new URL(FakeEventSource.instances[0]!.url).searchParams.get('fromVersion')).toBe('42');

    // Bump consumer-owned version, simulate close + reconnect.
    storedVersion = 99;
    FakeEventSource.instances[0]!.readyState = FakeEventSource.CLOSED;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(new URL(FakeEventSource.instances[1]!.url).searchParams.get('fromVersion')).toBe('99');
  });

  it('close() removes the visibilitychange listener', () => {
    setVisibility('visible');
    const client = open({ roomId: 'ABCDEF', joinToken: 'tok', onEvent: vi.fn() });
    expect(FakeEventSource.instances).toHaveLength(1);
    client.close();
    // Simulate a stale visibilitychange after close — no new EventSource
    // should be created.
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeEventSource.instances.length).toBe(1);
  });
});

// ─── Round 2 MINOR-1 — onClose fires at most once per client lifetime ────────

describe('openSseClient — onClose single-invocation gate (Round 2 MINOR-1)', () => {
  // Pre-fix bug: onClose could fire from (a) onerror when readyState reached
  // CLOSED, AND again from (b) explicit close(). React consumers using onClose
  // to drive connectionState transitions then re-rendered for each invocation,
  // causing flicker / unnecessary work.

  const clients: Array<{ close: () => void }> = [];

  beforeEach(() => {
    FakeEventSource.instances = [];
    clients.length = 0;
    (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource =
      FakeEventSource;
  });

  afterEach(() => {
    for (const c of clients) {
      try { c.close(); } catch { /* noop */ }
    }
    clients.length = 0;
  });

  it('multiple onerror events with readyState=CLOSED → onClose fires exactly once', () => {
    const onClose = vi.fn();
    const client = openSseClient({
      roomId: 'ABCDEF',
      joinToken: 'tok',
      onEvent: vi.fn(),
      onClose,
    });
    clients.push(client);
    const es = FakeEventSource.instances[0]!;

    // Simulate multiple onerror invocations after socket reaches CLOSED.
    es.readyState = FakeEventSource.CLOSED;
    es.onerror?.(new Event('error'));
    es.onerror?.(new Event('error'));
    es.onerror?.(new Event('error'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('onerror→CLOSED followed by explicit close() → onClose still fires only once', () => {
    const onClose = vi.fn();
    const client = openSseClient({
      roomId: 'ABCDEF',
      joinToken: 'tok',
      onEvent: vi.fn(),
      onClose,
    });
    const es = FakeEventSource.instances[0]!;

    es.readyState = FakeEventSource.CLOSED;
    es.onerror?.(new Event('error')); // first invocation
    expect(onClose).toHaveBeenCalledTimes(1);

    client.close(); // second invocation pre-fix; same after fix
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
