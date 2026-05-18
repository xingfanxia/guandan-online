import { describe, expect, it } from 'vitest';
import { moveCommandKind, isPlayCommand } from '@lib/realtime/commands';
import type {
  MoveCommand,
  MoveRequest,
  MoveResponse,
  PlayCommand,
} from '@lib/realtime/commands';

describe('moveCommandKind — exhaustive kind discriminator', () => {
  it('returns the literal kind for every MoveCommand variant', () => {
    const samples: MoveCommand[] = [
      { kind: 'play', cards: ['5-S-1', '5-D-1'], fromVersion: 1 },
      { kind: 'pass', fromVersion: 2 },
      { kind: 'tribute_select', targetCard: 'A-H-1', fromVersion: 3 },
      { kind: 'anti_tribute', fromVersion: 4 },
      { kind: 'report_card', cards: ['7-C-1'], fromVersion: 5 },
      { kind: 'ready', fromVersion: 6 },
    ];
    const kinds = samples.map(moveCommandKind);
    expect(kinds).toEqual([
      'play',
      'pass',
      'tribute_select',
      'anti_tribute',
      'report_card',
      'ready',
    ]);
  });
});

describe('isPlayCommand type guard', () => {
  it('narrows to PlayCommand when kind is "play"', () => {
    const cmd: MoveCommand = { kind: 'play', cards: ['5-S-1'], fromVersion: 1 };
    expect(isPlayCommand(cmd)).toBe(true);
    if (isPlayCommand(cmd)) {
      // type narrowing — `cards` is accessible
      const c: PlayCommand = cmd;
      expect(c.cards).toEqual(['5-S-1']);
    }
  });

  it('returns false for non-play commands', () => {
    expect(isPlayCommand({ kind: 'pass', fromVersion: 1 })).toBe(false);
    expect(isPlayCommand({ kind: 'anti_tribute', fromVersion: 1 })).toBe(false);
  });
});

describe('MoveRequest / MoveResponse shape (compile-time)', () => {
  it('MoveRequest carries moveId + command', () => {
    const req: MoveRequest = {
      moveId: '550e8400-e29b-41d4-a716-446655440000',
      command: { kind: 'pass', fromVersion: 1 },
    };
    expect(req.moveId).toContain('-');
    expect(req.command.kind).toBe('pass');
  });

  it('MoveResponse success carries appliedVersion + result', () => {
    const ok: MoveResponse = {
      ok: true,
      appliedVersion: 5,
      result: 'applied',
    };
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.result).toBe('applied');
  });

  it('MoveResponse failure carries named error', () => {
    const err: MoveResponse = {
      ok: false,
      error: 'stale_version',
      details: 'fromVersion 3 < current 5',
    };
    expect(err.ok).toBe(false);
    if (!err.ok) expect(err.error).toBe('stale_version');
  });
});
