// Resolve a finished round into a level-upgrade result.
//
// SYNC: docs/research/game-rules.md § "Round end & level progression" — this
// is the bridge from CORE-2 round state (finishOrder) to CORE-1 calculateUpgrade.
// A-level rule application (checkALevelRules) is left to the caller because it
// depends on session-level state (team levels, A-fail counters) not held in
// the round.

import { calculateUpgrade } from './upgrade.js';
import type { UpgradeDetails } from './upgrade.js';
import type { ModeRules, TeamKey } from './mode.js';
import type { GameRound } from './round.js';

export interface RoundResult {
  winnerTeam: TeamKey;
  /** Winning team's finishing positions, 1-indexed and sorted ascending. */
  winnerRanks: number[];
  /** Levels the winning team advances (0..4, where 4 is the 8P sweep bonus). */
  upgrade: number;
  details: UpgradeDetails;
}

export function resolveRound(round: GameRound, rules: ModeRules): RoundResult {
  if (round.phase !== 'finished') {
    throw new Error(`resolveRound: round phase is "${round.phase}", expected "finished"`);
  }
  if (round.finishOrder.length !== round.seats.length) {
    throw new Error(
      `resolveRound: finishOrder has ${round.finishOrder.length} entries, expected ${round.seats.length}`
    );
  }

  const firstId = round.finishOrder[0]!;
  const firstSeat = round.seats.find((s) => s.id === firstId);
  if (!firstSeat) {
    throw new Error(`resolveRound: 1st-place player "${firstId}" not found in seats`);
  }
  const winnerTeam = firstSeat.team;

  // Build the winning team's finishing ranks (1-indexed positions in
  // finishOrder, filtered to winnerTeam members, sorted ascending).
  const winnerRanks: number[] = [];
  for (let i = 0; i < round.finishOrder.length; i++) {
    const seat = round.seats.find((s) => s.id === round.finishOrder[i]);
    if (seat && seat.team === winnerTeam) {
      winnerRanks.push(i + 1);
    }
  }
  winnerRanks.sort((a, b) => a - b);

  const upgradeResult = calculateUpgrade({
    mode: round.mode,
    ranks: winnerRanks,
    rules,
  });

  return {
    winnerTeam,
    winnerRanks,
    upgrade: upgradeResult.upgrade,
    details: upgradeResult.details,
  };
}
