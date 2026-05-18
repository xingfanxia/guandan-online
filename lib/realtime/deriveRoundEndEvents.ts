// Derive round_end (and optional game_end) AuthorEvents from a finished round
// transition. Pure function — takes the resolved RoundResult plus the
// pre/post sessions, returns events ready for publishEvent.
//
// Called from the move handler AFTER deriveMoveEvent's move_played + trick_won
// emission. Versioning convention: each round_end / game_end event gets the
// NEXT sequential version after the move handler's last derived event. The
// caller is responsible for incrementing `baseVersion` before passing it in.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.2 — RoundEndEvent +
// GameEndEvent shape. SYNC: lib/game/session.ts § applyRoundResult.

import type { TeamKey } from '../game/mode';
import type { GameSession } from '../game/session';
import type { RoundResult } from '../game/resolveRound';
import type { AuthorEvent } from './buildClientPayload';

export interface DeriveRoundEndInput {
  /** Session state BEFORE applyRoundResult (for diff context if ever needed). */
  preSession: GameSession;
  /** Session state AFTER applyRoundResult — drives newLevels / winnerTeam. */
  postSession: GameSession;
  /** Output of resolveRound for the finished GameRound. */
  result: RoundResult;
  /**
   * The version AT which the round_end event should be assigned. game_end (if
   * emitted) gets `baseVersion + 1`. Caller (move handler) computes this from
   * the last per-recipient event version it emitted for this turn.
   */
  baseVersion: number;
}

/**
 * Returns [round_end] when the round ended but the game continues;
 * returns [round_end, game_end] when applyRoundResult set phase='finished'.
 * Always at least one event since this is only called on finished rounds.
 */
export function deriveRoundEndEvents(
  input: DeriveRoundEndInput
): AuthorEvent[] {
  const { postSession, result, baseVersion } = input;

  const roundEnd: AuthorEvent = {
    type: 'round_end',
    version: baseVersion,
    winnerTeam: result.winnerTeam,
    winnerRanks: [...result.winnerRanks],
    upgrade: result.upgrade,
    newLevels: { ...postSession.teamLevels },
  };

  if (postSession.phase !== 'finished') {
    return [roundEnd];
  }

  // Game ended this round. winnerTeam must be set when phase === 'finished'
  // (applyRoundResult enforces this); fall back to the round winner if not
  // for some reason (defense in depth — shouldn't fire under normal flow).
  const gameWinner: TeamKey = postSession.winnerTeam ?? result.winnerTeam;
  const gameEnd: AuthorEvent = {
    type: 'game_end',
    version: baseVersion + 1,
    winnerTeam: gameWinner,
    summary: buildSummary(gameWinner, postSession.finishedRounds),
  };
  return [roundEnd, gameEnd];
}

function buildSummary(winner: TeamKey, rounds: number): string {
  const roundWord = rounds === 1 ? 'round' : 'rounds';
  return `Team ${winner} wins the game after ${rounds} ${roundWord}.`;
}
