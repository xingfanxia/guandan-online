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
  onEvent: (event: ServerEvent) => void;
  onError?: (err: Event) => void;
  onClose?: () => void;
}

/**
 * Open an SSE stream to /api/sse/[roomId] and pump parsed ServerEvents
 * through the callback. Returns a handle for explicit close.
 */
export function openSseClient(opts: SseClientOptions): SseClient {
  const url = new URL(`/api/sse/${encodeURIComponent(opts.roomId)}`, window.location.origin);
  url.searchParams.set('token', opts.joinToken);
  if (opts.fromVersion != null) url.searchParams.set('fromVersion', String(opts.fromVersion));

  const es = new EventSource(url.toString());
  let lastVersion = opts.fromVersion ?? 0;

  es.onmessage = (msg: MessageEvent<string>) => {
    try {
      const event = JSON.parse(msg.data) as ServerEvent;
      if (typeof event.version === 'number') lastVersion = event.version;
      opts.onEvent(event);
    } catch (err) {
      // Malformed event — log but don't kill the stream.
      console.error('[sseClient] malformed event payload', err);
    }
  };

  es.onerror = (err) => {
    opts.onError?.(err);
    if (es.readyState === EventSource.CLOSED) opts.onClose?.();
  };

  return {
    close: () => {
      es.close();
      opts.onClose?.();
    },
    get lastVersion() {
      return lastVersion;
    },
  };
}
