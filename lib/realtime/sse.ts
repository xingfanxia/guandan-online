// SSE wire format helpers — serialize ServerEvent to text/event-stream frames,
// emit keepalive comments, and parse frames in tests / client.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.2 "Each SSE message frame"
// (lines ~727-731). Uses the event's `version` field as the SSE `id:` for
// Last-Event-ID resume semantics (NET-2 will consume this).

import type { ServerEvent } from './messages';

/**
 * Serialize a ServerEvent to a single SSE frame string. Frame layout:
 *
 *   id: <version>
 *   event: <type>
 *   data: <JSON payload>
 *   <blank line>
 *
 * The trailing blank line is required by the SSE spec to terminate the frame.
 */
export function formatEvent(event: ServerEvent): string {
  const id = `id: ${event.version}\n`;
  const evt = `event: ${event.type}\n`;
  const data = `data: ${JSON.stringify(event)}\n`;
  return `${id}${evt}${data}\n`;
}

/**
 * Serialize a comment line (no-op frame). Used for keepalives every ~20s to
 * keep proxies / GFW middleboxes from idling the SSE connection. The leading
 * `:` makes the line a comment per SSE spec. Multiline bodies are split so
 * each line is independently a comment (no stray newlines inside the frame).
 */
export function formatComment(body: string): string {
  const lines = body.split('\n').map((l) => `: ${l}`);
  return `${lines.join('\n')}\n\n`;
}

// ─── Parser (used by tests + client EventSource simulator) ───────────────────

export interface ParsedFrame {
  id: string | null;
  event: string | null;
  data: unknown;
}

/**
 * Parse a single SSE frame back into its components. Lenient: accepts frames
 * with or without `event:`, but `data:` is mandatory. Returns the parsed JSON
 * payload (assumes JSON; SSE spec allows other formats but we standardize).
 */
export function parseFrame(frame: string): ParsedFrame {
  const lines = frame.split('\n');
  let id: string | null = null;
  let event: string | null = null;
  let dataRaw: string | null = null;

  for (const line of lines) {
    if (line.startsWith('id: ')) {
      id = line.slice('id: '.length);
    } else if (line.startsWith('event: ')) {
      event = line.slice('event: '.length);
    } else if (line.startsWith('data: ')) {
      dataRaw = line.slice('data: '.length);
    }
  }

  if (dataRaw === null) {
    throw new Error('parseFrame: frame missing data line');
  }
  return { id, event, data: JSON.parse(dataRaw) };
}
