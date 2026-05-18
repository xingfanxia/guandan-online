// Behavior tests for deriveMoveEvent. The play/pass paths are the only
// move-command kinds wired through handleMoveCommand at this stage; the
// others return null.

import { describe, expect, it } from 'vitest';
import { deriveMoveEvent } from '@lib/realtime/deriveMoveEvent';
import type {
  MoveCommand,
  PassCommand,
  PlayCommand,
} from '@lib/realtime/commands';
import { dealRound, startTrick, playCards } from '@lib/game/round';
import type { GameRound, PlayerSeat } from '@lib/game/round';
import { buildDeck, shuffleDeck } from '@lib/game/cards';
import { encodeCards } from '@lib/realtime/cardCodec';
import seedrandom from 'seedrandom';

function buildBaseRound(): GameRound {
  const seats: readonly PlayerSeat[] = [
    { id: 'p0', team: 't1', position: 0 },
    { id: 'p1', team: 't2', position: 1 },
    { id: 'p2', team: 't1', position: 2 },
    { id: 'p3', team: 't2', position: 3 },
  ];
  const rng = seedrandom('derive-move-event-test');
  const shuffled = shuffleDeck(buildDeck(), () => rng());
  return startTrick(
    dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats,
      leader: 'p0',
      shuffledDeck: shuffled,
    })
  );
}

const TURN_DEADLINE = '2026-05-18T00:00:30Z';

describe('deriveMoveEvent — play', () => {
  it('emits a move_played event with combinationLabel from pattern.kind', () => {
    const preRound = buildBaseRound();
    const p0Hand = preRound.hands['p0']!;
    const card = p0Hand[0]!; // single card → 'single' pattern
    const cards = encodeCards([card]);
    const command: PlayCommand = { kind: 'play', cards, fromVersion: 0 };
    const postRound = playCards(preRound, [card]);

    const event = deriveMoveEvent(
      'p0',
      command,
      preRound,
      postRound,
      1,
      TURN_DEADLINE
    );
    expect(event).not.toBeNull();
    if (!event || event.type !== 'move_played') {
      throw new Error('expected move_played event');
    }
    expect(event.player).toBe('p0');
    expect(event.cards).toEqual(cards);
    expect(event.combinationLabel).toBe('single');
    expect(event.version).toBe(1);
    expect(event.turnDeadline).toBe(TURN_DEADLINE);
  });

  it('nextTurn is the new currentPlayer when the trick continues', () => {
    const preRound = buildBaseRound();
    const card = preRound.hands['p0']![0]!;
    const command: PlayCommand = {
      kind: 'play',
      cards: encodeCards([card]),
      fromVersion: 0,
    };
    const postRound = playCards(preRound, [card]);

    const event = deriveMoveEvent(
      'p0',
      command,
      preRound,
      postRound,
      1,
      TURN_DEADLINE
    );
    if (event?.type !== 'move_played') throw new Error('expected move_played');
    expect(event.nextTurn).toBe(postRound.currentTrick?.currentPlayer);
    expect(event.nextTurn).not.toBe('p0');
  });
});

describe('deriveMoveEvent — pass', () => {
  it('emits a move_passed event', () => {
    // For a pass test we need a non-empty trick. Walk through one play first
    // so the trick has a bestPattern before p1 passes.
    let round = buildBaseRound();
    const p0Card = round.hands['p0']![0]!;
    round = playCards(round, [p0Card]);
    // Now p1 (or whoever currentTrick.currentPlayer is) can pass.
    const passer = round.currentTrick!.currentPlayer;
    const passCommand: PassCommand = { kind: 'pass', fromVersion: 1 };
    // simulate pass via round.ts pass() — but we don't need the actual
    // newRound here; just need the deriver to label the event correctly.
    // Use a stub postRound matching shape.
    const postRound: GameRound = {
      ...round,
      currentTrick: { ...round.currentTrick!, currentPlayer: 'p2' },
    };

    const event = deriveMoveEvent(
      passer,
      passCommand,
      round,
      postRound,
      2,
      TURN_DEADLINE
    );
    if (event?.type !== 'move_passed') throw new Error('expected move_passed');
    expect(event.player).toBe(passer);
    expect(event.nextTurn).toBe('p2');
    expect(event.version).toBe(2);
  });
});

describe('deriveMoveEvent — non-play kinds return null', () => {
  it.each([
    ['tribute_select', { kind: 'tribute_select', targetCard: '5-S-1', fromVersion: 0 }],
    ['anti_tribute', { kind: 'anti_tribute', fromVersion: 0 }],
    ['report_card', { kind: 'report_card', cards: ['5-S-1'], fromVersion: 0 }],
    ['ready', { kind: 'ready', fromVersion: 0 }],
  ])('returns null for command kind %s', (_label, command) => {
    const round = buildBaseRound();
    const event = deriveMoveEvent(
      'p0',
      command as MoveCommand,
      round,
      round,
      0,
      TURN_DEADLINE
    );
    expect(event).toBeNull();
  });
});
