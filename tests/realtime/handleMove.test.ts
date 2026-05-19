import { describe, expect, it } from 'vitest';
import { handleMoveCommand } from '@lib/realtime/handleMove';
import { startTrick } from '@lib/game/round';
import type { GameRound, PlayerSeat } from '@lib/game/round';
import type { Card } from '@lib/game/cards';
import type { MoveCommand } from '@lib/realtime/commands';

const SEATS_4P: PlayerSeat[] = [
  { id: 'a', team: 't1', position: 0 },
  { id: 'b', team: 't2', position: 1 },
  { id: 'c', team: 't1', position: 2 },
  { id: 'd', team: 't2', position: 3 },
];

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

function buildRound(handsByPos: readonly (readonly Card[])[]): GameRound {
  const hands: Record<string, Card[]> = {};
  for (let i = 0; i < SEATS_4P.length; i++) {
    hands[SEATS_4P[i]!.id] = [...handsByPos[i]!];
  }
  return {
    mode: '4',
    level: '2',
    owner: null,
    seats: SEATS_4P,
    hands,
    leader: 'a',
    phase: 'playing',
    finishOrder: [],
    currentTrick: null,
  };
}

// ─── play command happy path ──────────────────────────────────────────────────

describe('handleMoveCommand — play', () => {
  it('applies a valid play; returns ok with bumped version', () => {
    const r = startTrick(
      buildRound([
        [c('spades', '7')],
        [c('hearts', '5')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    const cmd: MoveCommand = { kind: 'play', cards: ['7-S-1'], fromVersion: 10 };
    const { newRound, response } = handleMoveCommand(r, 'a', cmd, 10);
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.appliedVersion).toBe(11);
      expect(response.result).toBe('applied');
    }
    expect(newRound.hands['a']).toEqual([]); // card removed
    expect(newRound.currentTrick?.bestPlayer).toBe('a');
  });
});

// ─── error: stale_version ────────────────────────────────────────────────────

describe('handleMoveCommand — stale_version', () => {
  it('rejects when command.fromVersion < currentVersion', () => {
    const r = startTrick(
      buildRound([
        [c('spades', '7')],
        [c('hearts', '5')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    const cmd: MoveCommand = { kind: 'play', cards: ['7-S-1'], fromVersion: 3 };
    const { newRound, response } = handleMoveCommand(r, 'a', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toBe('stale_version');
    expect(newRound).toBe(r); // unchanged
  });
});

// ─── error: not_your_turn ────────────────────────────────────────────────────

describe('handleMoveCommand — not_your_turn', () => {
  it('rejects when player is not the currentPlayer of the trick', () => {
    const r = startTrick(
      buildRound([
        [c('spades', '7')],
        [c('hearts', '5')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    // Trick currentPlayer is 'a'. b tries to play.
    const cmd: MoveCommand = { kind: 'play', cards: ['5-H-1'], fromVersion: 10 };
    const { response } = handleMoveCommand(r, 'b', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toBe('not_your_turn');
  });

  it('also rejects play attempt when there is no active trick (lobby/etc)', () => {
    const r = buildRound([
      [c('spades', '7')],
      [c('hearts', '5')],
      [c('clubs', '5')],
      [c('diamonds', '5')],
    ]);
    // No startTrick called — currentTrick is null
    const cmd: MoveCommand = { kind: 'play', cards: ['7-S-1'], fromVersion: 10 };
    const { response } = handleMoveCommand(r, 'a', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toBe('not_your_turn');
  });
});

// ─── error: invalid_move ─────────────────────────────────────────────────────

describe('handleMoveCommand — invalid_move', () => {
  it('rejects when the play does not form a valid pattern', () => {
    const r = startTrick(
      buildRound([
        [c('spades', '7'), c('hearts', '8')], // mixed-rank pair → invalid
        [c('hearts', '5')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    const cmd: MoveCommand = { kind: 'play', cards: ['7-S-1', '8-H-1'], fromVersion: 10 };
    const { response } = handleMoveCommand(r, 'a', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toBe('invalid_move');
  });

  it('rejects when a played card is not in the player\'s hand', () => {
    const r = startTrick(
      buildRound([
        [c('spades', '7')],
        [c('hearts', '5')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    // a only has 7S; tries to play 5H
    const cmd: MoveCommand = { kind: 'play', cards: ['5-H-1'], fromVersion: 10 };
    const { response } = handleMoveCommand(r, 'a', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toBe('invalid_move');
  });
});

// ─── pass command ────────────────────────────────────────────────────────────

describe('handleMoveCommand — pass', () => {
  it('rejects pass by leader of an empty trick', () => {
    const r = startTrick(
      buildRound([
        [c('spades', '7')],
        [c('hearts', '5')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    const cmd: MoveCommand = { kind: 'pass', fromVersion: 10 };
    const { response } = handleMoveCommand(r, 'a', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toBe('invalid_move');
  });

  it('accepts pass by follower after leader played', () => {
    let r = startTrick(
      buildRound([
        [c('spades', '7')],
        [c('hearts', '5')],
        [c('clubs', '5')],
        [c('diamonds', '5')],
      ])
    );
    // a plays first
    const playCmd: MoveCommand = { kind: 'play', cards: ['7-S-1'], fromVersion: 10 };
    r = handleMoveCommand(r, 'a', playCmd, 10).newRound;

    // b passes
    const passCmd: MoveCommand = { kind: 'pass', fromVersion: 11 };
    const { response } = handleMoveCommand(r, 'b', passCmd, 11);
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.appliedVersion).toBe(12);
  });
});

// ─── unimplemented commands ──────────────────────────────────────────────────

describe('handleMoveCommand — not-yet-implemented commands', () => {
  const r = startTrick(
    buildRound([
      [c('spades', '7')],
      [c('hearts', '5')],
      [c('clubs', '5')],
      [c('diamonds', '5')],
    ])
  );

  it('report_card → invalid_move with TRIBUTE-1 details', () => {
    const cmd: MoveCommand = { kind: 'report_card', cards: ['5-S-1'], fromVersion: 10 };
    const { response } = handleMoveCommand(r, 'a', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toBe('invalid_move');
      expect(response.details).toContain('TRIBUTE-1');
    }
  });

  it('ready → invalid_move (not implemented)', () => {
    const cmd: MoveCommand = { kind: 'ready', fromVersion: 10 };
    const { response } = handleMoveCommand(r, 'a', cmd, 10);
    expect(response.ok).toBe(false);
  });
});

// ─── tribute_select / anti_tribute dispatch ─────────────────────────────────

describe('handleMoveCommand — tribute_select dispatch', () => {
  // Round shell with a pending single-tribute state and the loser holding the
  // card they're about to give up.
  function buildTributeRound(): import('@lib/game/round').GameRound {
    const round = buildRound([
      [c('clubs', '5')],            // a (winner, will receive)
      [c('hearts', '6')],            // b
      [c('clubs', '7')],             // c
      [c('spades', 'A'), c('clubs', '3')], // d (loser, tributes the Ace)
    ]);
    return {
      ...round,
      pendingTribute: {
        mode: 'single',
        obligations: [{ from: 'd', to: 'a', selectedCard: null }],
        finishOrder: ['a', 'b', 'c', 'd'],
      },
    };
  }

  it('finalizes when the right player picks a valid card', () => {
    const r = buildTributeRound();
    const cmd: MoveCommand = {
      kind: 'tribute_select',
      targetCard: 'A-S-1',
      fromVersion: 10,
    };
    const { newRound, response } = handleMoveCommand(r, 'd', cmd, 10);
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.appliedVersion).toBe(11);
      expect(response.result).toBe('applied');
    }
    expect(newRound.pendingTribute).toBeUndefined();
    expect(newRound.hands['a']).toContainEqual(c('spades', 'A'));
    // 末游 (d) leads
    expect(newRound.leader).toBe('d');
  });

  it("skips the trick-based 'not_your_turn' check (no trick in tribute phase)", () => {
    // The round has no currentTrick (it's null in tribute phase). tribute_select
    // must still dispatch through to selectTributeCard.
    const r = buildTributeRound();
    expect(r.currentTrick).toBeNull();
    const cmd: MoveCommand = {
      kind: 'tribute_select',
      targetCard: 'A-S-1',
      fromVersion: 10,
    };
    const { response } = handleMoveCommand(r, 'd', cmd, 10);
    // Would have been 'not_your_turn' under the old logic
    expect(response.ok).toBe(true);
  });

  it('returns invalid_move when the round has no pendingTribute', () => {
    const r = buildRound([
      [c('clubs', '5')],
      [c('hearts', '6')],
      [c('clubs', '7')],
      [c('spades', 'A')],
    ]);
    const cmd: MoveCommand = {
      kind: 'tribute_select',
      targetCard: 'A-S-1',
      fromVersion: 10,
    };
    const { response } = handleMoveCommand(r, 'd', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toBe('invalid_move');
      expect(response.details).toMatch(/no pending tribute/);
    }
  });

  it('returns invalid_move when the wrong player tries to select', () => {
    const r = buildTributeRound();
    const cmd: MoveCommand = {
      kind: 'tribute_select',
      targetCard: 'A-S-1',
      fromVersion: 10,
    };
    // 'b' has no obligation
    const { response } = handleMoveCommand(r, 'b', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toBe('invalid_move');
      expect(response.details).toMatch(/no tribute obligation/);
    }
  });

  it('returns invalid_move when the cardId is malformed', () => {
    const r = buildTributeRound();
    const cmd: MoveCommand = {
      kind: 'tribute_select',
      targetCard: 'garbage',
      fromVersion: 10,
    };
    const { response } = handleMoveCommand(r, 'd', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toBe('invalid_move');
      expect(response.details).toMatch(/decode/);
    }
  });
});

describe('handleMoveCommand — anti_tribute dispatch', () => {
  function buildResistRound(): import('@lib/game/round').GameRound {
    const round = buildRound([
      [c('clubs', '5')],
      [c('joker', 'RJ')],
      [c('clubs', '6')],
      [c('joker', 'RJ', 2)],
    ]);
    return {
      ...round,
      pendingTribute: {
        mode: 'resist',
        obligations: [],
        finishOrder: ['a', 'b', 'c', 'd'],
      },
    };
  }

  it('finalizes (no swap) when a losing-team player declares', () => {
    const r = buildResistRound();
    const cmd: MoveCommand = { kind: 'anti_tribute', fromVersion: 10 };
    const { newRound, response } = handleMoveCommand(r, 'd', cmd, 10);
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.appliedVersion).toBe(11);
    expect(newRound.pendingTribute).toBeUndefined();
    // Hands unchanged
    expect(newRound.hands['a']).toEqual([c('clubs', '5')]);
    expect(newRound.hands['d']).toEqual([c('joker', 'RJ', 2)]);
    // 头游 (a) leads on resist
    expect(newRound.leader).toBe('a');
  });

  it('returns invalid_move when called by a winning-team player', () => {
    const r = buildResistRound();
    const cmd: MoveCommand = { kind: 'anti_tribute', fromVersion: 10 };
    const { response } = handleMoveCommand(r, 'a', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toBe('invalid_move');
      expect(response.details).toMatch(/winning team/);
    }
  });

  it('returns invalid_move when no pendingTribute on round', () => {
    const r = buildRound([
      [c('clubs', '5')],
      [c('joker', 'RJ')],
      [c('clubs', '6')],
      [c('joker', 'RJ', 2)],
    ]);
    const cmd: MoveCommand = { kind: 'anti_tribute', fromVersion: 10 };
    const { response } = handleMoveCommand(r, 'd', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toBe('invalid_move');
      expect(response.details).toMatch(/no pending tribute/);
    }
  });

  it('returns invalid_move when pending mode is not resist', () => {
    const round = buildRound([
      [c('clubs', '5')],
      [c('hearts', '6')],
      [c('clubs', '7')],
      [c('spades', 'A')],
    ]);
    const r = {
      ...round,
      pendingTribute: {
        mode: 'single' as const,
        obligations: [{ from: 'd', to: 'a', selectedCard: null }],
        finishOrder: ['a', 'b', 'c', 'd'],
      },
    };
    const cmd: MoveCommand = { kind: 'anti_tribute', fromVersion: 10 };
    const { response } = handleMoveCommand(r, 'd', cmd, 10);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toBe('invalid_move');
      expect(response.details).toMatch(/only valid in resist mode/);
    }
  });
});
