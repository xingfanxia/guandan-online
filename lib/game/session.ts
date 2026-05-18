// Session orchestration — multi-round state and game-end detection.
//
// Ties together CORE-1 (calculateUpgrade, checkALevelRules) and CORE-2
// (GameRound + resolveRound) into the session-level loop:
//   1. Caller deals a round (CORE-2 dealRound).
//   2. Players play tricks until round.phase === 'finished'.
//   3. Caller passes the finished round + current session here.
//   4. applyRoundResult returns the next session — levels updated, A-level
//      rules applied, game-end detected if conditions met.
//
// SYNC: docs/research/game-rules.md § "Round end & level progression" +
// § "A-level rules (A级规则)". Implementation mirrors sibling scorer's
// rules.js (already ported into aLevel.ts) and config.js defaults.

import { checkALevelRules } from './aLevel';
import { nextLevel } from './levels';
import type { LevelRank } from './levels';
import type { ModeRules, GameMode, TeamKey } from './mode';
import { resolveRound } from './resolveRound';
import type { GameRound } from './round';

export type SessionPhase = 'in_progress' | 'finished';

export interface GameSession {
  mode: GameMode;
  rules: ModeRules;
  teamLevels: Record<TeamKey, LevelRank>;
  teamAFails: Record<TeamKey, number>;
  /** Whose A-test the upcoming round is. Null until first round completes. */
  roundOwner: TeamKey | null;
  /** Number of rounds completed so far. */
  finishedRounds: number;
  phase: SessionPhase;
  /** Set on game end. */
  winnerTeam: TeamKey | null;
}

// ─── Initial state ────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  mode: GameMode;
  rules: ModeRules;
}

export function createSession(input: CreateSessionInput): GameSession {
  return {
    mode: input.mode,
    rules: input.rules,
    teamLevels: { t1: '2', t2: '2' },
    teamAFails: { t1: 0, t2: 0 },
    roundOwner: null,
    finishedRounds: 0,
    phase: 'in_progress',
    winnerTeam: null,
  };
}

// ─── applyRoundResult: transition session given a finished round ──────────────

export function applyRoundResult(
  session: GameSession,
  round: GameRound
): GameSession {
  if (session.phase === 'finished') {
    throw new Error(
      `applyRoundResult: session already finished (winner ${session.winnerTeam})`
    );
  }
  if (round.phase !== 'finished') {
    throw new Error(
      `applyRoundResult: round phase is "${round.phase}", expected "finished"`
    );
  }

  // 1. Identify the winning team + level upgrade.
  const result = resolveRound(round, session.rules);
  const winnerTeam = result.winnerTeam;

  // 2. Apply A-level rules (handles strict-A, A-fail counter, demotion).
  //    For 6P/8P the aLevel module already skips A-fail tracking per
  //    project_rules_change_2026-05; pass mode through unchanged.
  const aLevelResult = checkALevelRules({
    winnerKey: winnerTeam,
    ranks: result.winnerRanks,
    mode: round.mode,
    teamLevels: session.teamLevels,
    teamAFails: session.teamAFails,
    roundOwner: session.roundOwner,
    roundLevel: round.level,
    strictA: session.rules.strictA,
  });

  // 3. Build new team levels: start from current, then apply normal upgrade
  //    + any A-level adjustments returned by checkALevelRules.
  const newLevels: Record<TeamKey, LevelRank> = { ...session.teamLevels };

  // Default: winner team advances by `upgrade` levels (clamped at A).
  newLevels[winnerTeam] = nextLevel(session.teamLevels[winnerTeam], result.upgrade);

  // A-level layer overrides for the A-team (whoever was at A):
  //   - winnerNewLevel: non-null → force this level (e.g., demote to '2' on
  //     3rd strike, or stay at 'A' on opponent-round dirty win)
  //   - loserNewLevel: non-null → force the LOSING team's level (demotion)
  // The aLevel types use `LevelRank | null` where null = "no override".
  if (aLevelResult.aTeam !== null) {
    if (aLevelResult.winnerNewLevel !== null) {
      newLevels[winnerTeam] = aLevelResult.winnerNewLevel;
    }
    if (aLevelResult.loserNewLevel !== null) {
      // Loser team is the OTHER team from the winner.
      const loserTeam: TeamKey = winnerTeam === 't1' ? 't2' : 't1';
      newLevels[loserTeam] = aLevelResult.loserNewLevel;
    }
  }

  // 4. Build new A-fail map (delta-merge per aLevelResult.newAFails).
  const newAFails: Record<TeamKey, number> = { ...session.teamAFails };
  for (const [team, count] of Object.entries(aLevelResult.newAFails) as [
    TeamKey,
    number,
  ][]) {
    newAFails[team] = count;
  }

  // 5. Game end? checkALevelRules sets finalWin === true when pass-A is met.
  const finished = aLevelResult.finalWin;

  return {
    ...session,
    teamLevels: newLevels,
    teamAFails: newAFails,
    roundOwner: winnerTeam, // winner sets the next round's A-level frame
    finishedRounds: session.finishedRounds + 1,
    phase: finished ? 'finished' : 'in_progress',
    winnerTeam: finished ? winnerTeam : null,
  };
}
