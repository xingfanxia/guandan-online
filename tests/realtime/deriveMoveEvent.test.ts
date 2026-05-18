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

    const events = deriveMoveEvent(
      'p0',
      command,
      preRound,
      postRound,
      1,
      TURN_DEADLINE
    );
    expect(events).toHaveLength(1);
    const event = events[0]!;
    if (event.type !== 'move_played') {
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

    const events = deriveMoveEvent(
      'p0',
      command,
      preRound,
      postRound,
      1,
      TURN_DEADLINE
    );
    expect(events).toHaveLength(1);
    const event = events[0]!;
    if (event.type !== 'move_played') throw new Error('expected move_played');
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
    const passer = round.currentTrick!.currentPlayer;
    const passCommand: PassCommand = { kind: 'pass', fromVersion: 1 };
    const postRound: GameRound = {
      ...round,
      currentTrick: { ...round.currentTrick!, currentPlayer: 'p2' },
    };

    const events = deriveMoveEvent(
      passer,
      passCommand,
      round,
      postRound,
      2,
      TURN_DEADLINE
    );
    expect(events).toHaveLength(1);
    const event = events[0]!;
    if (event.type !== 'move_passed') throw new Error('expected move_passed');
    expect(event.player).toBe(passer);
    expect(event.nextTurn).toBe('p2');
    expect(event.version).toBe(2);
  });
});

describe('deriveMoveEvent — trick_won emission', () => {
  it('appends a trick_won event when the move ends the current trick', () => {
    const round = buildBaseRound();
    const preRound: GameRound = {
      ...round,
      currentTrick: { ...round.currentTrick!, currentPlayer: 'p0' },
    };
    // Construct a post-state where the trick has ended:
    //   - currentTrick: null
    //   - leader: 'p0' (the winner of the previous trick becomes leader)
    // Best player was p3 (last played before the closing pass).
    const trickWithWinner = {
      ...round.currentTrick!,
      bestPlayer: 'p3',
    };
    const preWithWinner: GameRound = {
      ...round,
      currentTrick: trickWithWinner,
    };
    const postRound: GameRound = {
      ...round,
      currentTrick: null,
      leader: 'p3',
    };
    const events = deriveMoveEvent(
      'p0',
      { kind: 'pass', fromVersion: 1 },
      preWithWinner,
      postRound,
      2,
      TURN_DEADLINE
    );
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('move_passed');
    expect(events[0]?.version).toBe(2);
    const trickEvent = events[1]!;
    if (trickEvent.type !== 'trick_won') throw new Error('expected trick_won');
    expect(trickEvent.winner).toBe('p3');
    expect(trickEvent.nextLeader).toBe('p3');
    expect(trickEvent.version).toBe(3); // appliedVersion + 1
    // Silence the unused-binding linter for preRound (the test fixture is
    // wired to demonstrate both pre and post-state branches).
    expect(preRound.currentTrick?.currentPlayer).toBe('p0');
  });
});

describe('deriveMoveEvent — non-play kinds return empty array', () => {
  it.each([
    ['tribute_select', { kind: 'tribute_select', targetCard: '5-S-1', fromVersion: 0 }],
    ['anti_tribute', { kind: 'anti_tribute', fromVersion: 0 }],
    ['report_card', { kind: 'report_card', cards: ['5-S-1'], fromVersion: 0 }],
    ['ready', { kind: 'ready', fromVersion: 0 }],
  ])('returns [] for command kind %s', (_label, command) => {
    const round = buildBaseRound();
    const events = deriveMoveEvent(
      'p0',
      command as MoveCommand,
      round,
      round,
      0,
      TURN_DEADLINE
    );
    expect(events).toEqual([]);
  });
});
