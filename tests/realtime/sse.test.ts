import { describe, expect, it } from 'vitest';
import { formatEvent, formatComment, parseFrame } from '@lib/realtime/sse';
import type { ServerEvent } from '@lib/realtime/messages';

const heartbeat: ServerEvent = {
  type: 'heartbeat',
  version: 7,
  serverTime: '2026-05-18T00:00:10Z',
};

const streamClosing: ServerEvent = {
  type: 'stream_closing',
  version: 99,
  retryAfterMs: 100,
  reason: 'rotation',
};

// ─── formatEvent: produces a valid SSE frame ──────────────────────────────────

describe('formatEvent — SSE wire format', () => {
  it('emits id, event, data, and trailing blank line', () => {
    const out = formatEvent(heartbeat);
    const lines = out.split('\n');
    expect(lines[0]).toBe('id: 7');
    expect(lines[1]).toBe('event: heartbeat');
    expect(lines[2]?.startsWith('data: ')).toBe(true);
    expect(lines[3]).toBe(''); // blank separator
    expect(lines[4]).toBe(''); // final newline
  });

  it('data line is valid JSON containing the event', () => {
    const out = formatEvent(heartbeat);
    const dataLine = out.split('\n').find((l) => l.startsWith('data: '))!;
    const payload = JSON.parse(dataLine.slice('data: '.length));
    expect(payload).toEqual(heartbeat);
  });

  it('terminates with exactly one blank line (two newlines)', () => {
    const out = formatEvent(streamClosing);
    expect(out.endsWith('\n\n')).toBe(true);
    expect(out.endsWith('\n\n\n')).toBe(false);
  });

  it('preserves the event version in the id field for Last-Event-ID semantics', () => {
    const out = formatEvent(streamClosing);
    expect(out).toContain('id: 99');
  });
});

// ─── formatComment: SSE comment line ──────────────────────────────────────────

describe('formatComment — keepalive comments', () => {
  it('produces a leading-colon line + blank separator', () => {
    const out = formatComment('heartbeat');
    expect(out).toBe(': heartbeat\n\n');
  });

  it('escapes newlines in the comment body (must not break the frame)', () => {
    const out = formatComment('line1\nline2');
    // each line gets prefixed with ': ' so the comment is well-formed
    expect(out).toBe(': line1\n: line2\n\n');
  });
});

// ─── parseFrame: round-trip helper used by tests + client ────────────────────

describe('parseFrame', () => {
  it('round-trips an event through formatEvent + parseFrame', () => {
    const out = formatEvent(heartbeat);
    const parsed = parseFrame(out);
    expect(parsed.id).toBe('7');
    expect(parsed.event).toBe('heartbeat');
    expect(parsed.data).toEqual(heartbeat);
  });

  it('handles a frame without an event line (data-only)', () => {
    const raw = 'id: 5\ndata: {"x":1}\n\n';
    const parsed = parseFrame(raw);
    expect(parsed.id).toBe('5');
    expect(parsed.event).toBeNull();
    expect(parsed.data).toEqual({ x: 1 });
  });

  it('throws if frame is missing data line', () => {
    expect(() => parseFrame('id: 5\nevent: heartbeat\n\n')).toThrow(/data/i);
  });
});
