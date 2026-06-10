// Client ↔ server wire-contract test for POST /api/room/[code]/move.
//
// REGRESSION: the table screens used to build the body as a FLAT spread
// ({ kind, cards, fromVersion, moveId }) while the server requires the
// command NESTED ({ moveId, command: {...} }). Every UI play/pass failed
// with invalid_move ("command must be an object") and the response was
// silently dropped — the game looked frozen. This test round-trips the
// client builder through the server parser so the two layers can never
// drift apart silently again.

import { describe, expect, it } from 'vitest';
import { buildMoveBody } from '@/lib/api/moveClient';
import { parseMoveBody } from '@lib/api/move';
import type { MoveCommand } from '@lib/realtime/commands';

const COMMANDS: MoveCommand[] = [
  { kind: 'play', cards: ['A-S-1', 'A-H-2'], fromVersion: 7 },
  { kind: 'pass', fromVersion: 8 },
  { kind: 'tribute_select', targetCard: 'K-D-1', fromVersion: 9 },
  { kind: 'anti_tribute', fromVersion: 10 },
  { kind: 'exchange_vote', vote: true, fromVersion: 11 },
  { kind: 'exchange_select', cards: ['3-C-1'], fromVersion: 12 },
];

describe('move wire contract — client buildMoveBody ↔ server parseMoveBody', () => {
  it.each(COMMANDS.map((c) => [c.kind, c] as const))(
    'client %s body parses on the server',
    (_kind, cmd) => {
      const body = buildMoveBody(cmd, 'move-test-1');
      // Simulate the JSON round-trip the real request goes through.
      const parsed = parseMoveBody(JSON.parse(JSON.stringify(body)));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.moveId).toBe('move-test-1');
        expect(parsed.value.command.kind).toBe(cmd.kind);
        expect(parsed.value.command.fromVersion).toBe(cmd.fromVersion);
      }
    },
  );

  it('rejects the legacy FLAT shape (the bug this contract pins down)', () => {
    const flat = { kind: 'play', cards: ['A-S-1'], fromVersion: 4, moveId: 'm1' };
    const parsed = parseMoveBody(flat);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/command/);
    }
  });

  it('generates a unique moveId when none is supplied', () => {
    const a = buildMoveBody({ kind: 'pass', fromVersion: 1 });
    const b = buildMoveBody({ kind: 'pass', fromVersion: 1 });
    expect(a.moveId).not.toBe(b.moveId);
    expect(a.moveId.length).toBeGreaterThan(8);
  });
});
