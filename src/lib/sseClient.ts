// Minimal EventSource wrapper for /api/sse/[roomId].
//
// Native EventSource doesn't expose a way to inject custom headers (e.g., a
// Bearer token), so authentication piggybacks the `?token=` query string.
// The server checks both Authorization header (for fetch-based POST routes)
// and `token` query (for SSE).
//
// Reconnection uses native EventSource semantics for `Last-Event-ID`. Server
// publishes events with `id:` lines so the browser includes the last seen id
// on reconnect — the SSE handler at api/sse/[roomId] reads it from the
// `Last-Event-ID` header.
//
// Named-event dispatch: the server emits `event: <type>` per `formatEvent` in
// `lib/realtime/sse.ts`. The SSE spec routes named events through
// `addEventListener(type, ...)`, NOT through `es.onmessage`. We register
// listeners for every known ServerEvent['type'] below so the SPA receives
// every event regardless of name. Adding a new event type to messages.ts
// requires adding its discriminator string to SERVER_EVENT_TYPES — TypeScript
// won't catch the omission because EventSource is untyped, but the listener
// list is intentionally narrow rather than `addEventListener('*', ...)` to
// keep failures loud during development.
//
// Backgrounded-tab recovery: native EventSource transitions to CLOSED when a
// tab is backgrounded past the 270s rotation window without automatic recovery
// on visibilitychange. We attach a `document.visibilitychange` listener that
// re-opens the EventSource when the tab becomes visible AND the socket is in
// CLOSED / CONNECTING. The reconnect path re-reads `getInitialVersion()` so
// the consumer can resume from the latest accumulated lastVersion (which a
// component remount alone would lose).

import type { ServerEvent } from '@lib/realtime/messages';

export interface SseClient {
  /** Close the underlying EventSource. */
  close: () => void;
  /** Last seen event version (monotonic per recipient). */
  readonly lastVersion: number;
}

export interface SseClientOptions {
  roomId: string;
  joinToken: string;
  /** Resume from a known version (e.g., after manual reload). */
  fromVersion?: number;
  /**
   * Read the desired initial version at connect time. Use when the consumer
   * wants the SseClient to ignore a stale `fromVersion` prop and resume from
   * the latest accumulated lastVersion across remounts. Called once on the
   * initial open AND on every visibilitychange-driven reconnect, so the
   * consumer can stash the most recent version in a ref and pass it back
   * here. When present, takes precedence over `fromVersion`.
   */
  getInitialVersion?: () => number;
  onEvent: (event: ServerEvent) => void;
  onError?: (err: Event) => void;
  onClose?: () => void;
}

/** All ServerEvent discriminators. Must stay in sync with messages.ts ServerEvent. */
const SERVER_EVENT_TYPES = [
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
  'exchange_vote_required',
  'exchange_vote_resolved',
  'exchange_select_required',
  'exchange_completed',
] as const;

/**
 * Open an SSE stream to /api/sse/[roomId] and pump parsed ServerEvents
 * through the callback. Returns a handle for explicit close.
 *
 * The returned client owns a single EventSource at a time. On
 * visibilitychange (tab → visible) when the current socket is CLOSED or
 * CONNECTING, it transparently swaps in a fresh EventSource using
 * `getInitialVersion()` (or `fromVersion`) as the resume point.
 */
export function openSseClient(opts: SseClientOptions): SseClient {
  let lastVersion = readResumeVersion(opts);
  let es: EventSource | null = null;
  let closed = false;
  // Round 2 MINOR-1 fix: ensure opts.onClose fires AT MOST ONCE per client
  // lifetime. Pre-fix, the onerror branch (when readyState === CLOSED) and
  // the explicit close() handler could both invoke onClose — fanning out to
  // the consumer's connectionState callback multiple times, producing extra
  // 'closed' transitions and re-render loops in React consumers.
  let closeFired = false;
  const fireOnClose = (): void => {
    if (closeFired) return;
    closeFired = true;
    opts.onClose?.();
  };

  const dispatch = (msg: MessageEvent<string>): void => {
    try {
      const event = JSON.parse(msg.data) as ServerEvent;
      if (typeof event.version === 'number') lastVersion = event.version;
      opts.onEvent(event);
    } catch (err) {
      // Malformed event — log but don't kill the stream.
      console.error('[sseClient] malformed event payload', err);
    }
  };

  function connect(): void {
    if (closed) return;
    const url = new URL(
      `/api/sse/${encodeURIComponent(opts.roomId)}`,
      window.location.origin
    );
    url.searchParams.set('token', opts.joinToken);
    // Prefer the consumer-owned getter when present so reconnects pick up
    // accumulated lastVersion. Fall back to the prop for one-shot opens.
    const resumeFrom = opts.getInitialVersion ? opts.getInitialVersion() : lastVersion;
    if (resumeFrom > 0) url.searchParams.set('fromVersion', String(resumeFrom));
    else if (opts.fromVersion != null) url.searchParams.set('fromVersion', String(opts.fromVersion));

    const next = new EventSource(url.toString());
    next.onmessage = dispatch;
    for (const type of SERVER_EVENT_TYPES) {
      next.addEventListener(type, dispatch as EventListener);
    }
    next.onerror = (err) => {
      opts.onError?.(err);
      if (next.readyState === EventSource.CLOSED) fireOnClose();
    };
    es = next;
  }

  /**
   * Tear down the current EventSource and reconnect. Used by the
   * visibilitychange handler when the socket transitioned to CLOSED while
   * backgrounded — native EventSource doesn't auto-reconnect once it hits
   * CLOSED.
   */
  function reconnect(): void {
    if (closed) return;
    const prev = es;
    if (prev) {
      try { prev.close(); } catch { /* noop */ }
    }
    connect();
  }

  const onVisibilityChange = (): void => {
    if (closed) return;
    if (typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible') return;
    // EventSource is CONNECTING (0) right after open or during browser
    // automatic reconnect; CLOSED (2) means the browser gave up. Both are
    // candidates for us to swap in a fresh socket with our resume version.
    // OPEN (1) means we're actively receiving — leave it alone.
    if (!es || es.readyState !== EventSource.OPEN) {
      reconnect();
    }
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  connect();

  return {
    close: () => {
      closed = true;
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (es) {
        try { es.close(); } catch { /* noop */ }
      }
      // Round 2 MINOR-1 fix: gate via closeFired so we only fire once per
      // client lifetime, even if onerror also tripped CLOSED earlier.
      fireOnClose();
    },
    get lastVersion() {
      return lastVersion;
    },
  };
}

function readResumeVersion(opts: SseClientOptions): number {
  if (opts.getInitialVersion) return opts.getInitialVersion();
  return opts.fromVersion ?? 0;
}
