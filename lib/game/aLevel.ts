// A-level state machine — checks pass condition + tracks A-fail counter.
//
// SYNC: Pure-functional port of sibling scorer's rules.js:20-157 (tracksAFail
// + checkALevelRules). Same semantics; no singleton state. Caller passes the
// full A-level context and receives a diff to apply.
//
// Pass condition (both modes): winning team includes 1st place AND winning
// team does NOT include the last-place finisher. See game-rules.md
// §"A-level rules" for the full decision matrix.
//
// 6/8-player simplification (2026-05): no A-fail counter, no demotion.
// A-level teams stay at A indefinitely until they satisfy the pass condition.

import type { LevelRank } from './levels.js';
import { isALevel } from './levels.js';
import type { GameMode, TeamKey } from './mode.js';
import { positionCount, tracksAFail } from './mode.js';

export interface ALevelInput {
  winnerKey: TeamKey;
  /** Winning team's finishing positions, sorted ascending. */
  ranks: number[];
  mode: GameMode;
  teamLevels: Record<TeamKey, LevelRank>;
  teamAFails: Record<TeamKey, number>;
  /** Team that owns the current round (last winner); null only at round 1. */
  roundOwner: TeamKey | null;
  /** Level being played this round (typically equal to the round owner's level). */
  roundLevel: LevelRank;
  strictA: boolean;
}

export interface ALevelResult {
  /** Which team's A-level is being evaluated this round (null if no team at A). */
  aTeam: TeamKey | null;

  /** True if winning team passed A → game over. */
  finalWin: boolean;

  /** Human-readable Chinese annotation matching sibling scorer's output. */
  aNote: string;

  /**
   * Level overrides — if non-null, replaces the naive upgrade result. Used
   * for A-fail demotion (3 strikes → '2') and "stayed at A" cases.
   */
  winnerNewLevel: LevelRank | null;
  loserNewLevel: LevelRank | null;

  /**
   * A-fail counter changes to apply. Only set when the counter moves.
   * Caller writes these into team state. In 6/8-player, this is always {}.
   */
  newAFails: Partial<Record<TeamKey, number>>;
}

function otherTeam(t: TeamKey): TeamKey {
  return t === 't1' ? 't2' : 't1';
}

/**
 * Evaluate A-level rules after a round result. Returns a diff (level overrides
 * + A-fail counter changes + final-win flag). Caller applies the diff to game
 * state.
 *
 * This function is pure — no IO, no state mutation. It only reads `input`
 * and produces `ALevelResult`.
 */
export function checkALevelRules(input: ALevelInput): ALevelResult {
  const {
    winnerKey,
    ranks,
    mode,
    teamLevels,
    teamAFails,
    roundOwner,
    roundLevel,
    strictA,
  } = input;

  const aFailEnabled = tracksAFail(mode);
  const lastPos = positionCount(mode);
  const loserKey = otherTeam(winnerKey);

  // Determine which team is at A-level (and is therefore eligible for win check).
  // Both-at-A: the winner is the team being evaluated (sibling rules.js:46-51).
  let aTeam: TeamKey | null = null;
  const t1AtA = isALevel(teamLevels.t1);
  const t2AtA = isALevel(teamLevels.t2);
  if (t1AtA && t2AtA) aTeam = winnerKey;
  else if (t1AtA) aTeam = 't1';
  else if (t2AtA) aTeam = 't2';

  if (!aTeam) {
    return {
      aTeam: null,
      finalWin: false,
      aNote: '',
      winnerNewLevel: null,
      loserNewLevel: null,
      newAFails: {},
    };
  }

  const winnerHasLast = ranks.includes(lastPos);
  const newAFails: Partial<Record<TeamKey, number>> = {};

  /**
   * Increment A-fail counter for `team`. Returns { count, demoted } in 4P,
   * or null in 6/8P (where this rule is disabled).
   *
   * Side-effect-free: mutations are captured in `newAFails`. Caller applies.
   */
  function recordAFail(team: TeamKey): { count: number; demoted: boolean } | null {
    if (!aFailEnabled) return null;
    const current = teamAFails[team] ?? 0;
    const next = current + 1;
    if (next >= 3) {
      newAFails[team] = 0; // reset counter on demotion
      return { count: next, demoted: true };
    }
    newAFails[team] = next;
    return { count: next, demoted: false };
  }

  // Names for the Chinese annotation. Online doesn't have user-configurable
  // team names — we use the canonical labels (T1 / T2) and let the UI layer
  // substitute display names when rendering. Keeping the note structure
  // verbatim so existing scorer code paths recognize the format.
  const aTeamLabel = aTeam === 't1' ? 'T1' : 'T2';
  const roundOwnerLabel = roundOwner === null ? '未定' : roundOwner === 't1' ? 'T1' : 'T2';

  // Case 1: A-team WON
  if (aTeam === winnerKey) {
    if (winnerHasLast) {
      // Won but partner is last → not a clean win.
      if (roundOwner === aTeam) {
        // Own A round + dirty win → failure
        const fail = recordAFail(aTeam);
        if (fail) {
          // 4-player
          let aNote = `${aTeamLabel} A级失败（在自己的A级胜方含末游）→ A${fail.count}`;
          let winnerNewLevel: LevelRank | null = teamLevels[winnerKey];
          if (fail.demoted) {
            winnerNewLevel = '2';
            aNote += '｜累计3次失败，仅该队重置到2';
          }
          return {
            aTeam,
            finalWin: false,
            aNote,
            winnerNewLevel,
            loserNewLevel: null,
            newAFails,
          };
        }
        // 6/8-player — no failure tracking; stay at A
        return {
          aTeam,
          finalWin: false,
          aNote: `${aTeamLabel} 在自己的A级胜方含末游，不通关，继续打到通关`,
          winnerNewLevel: teamLevels[winnerKey],
          loserNewLevel: null,
          newAFails,
        };
      }

      // Dirty win on opponent's round — never a failure regardless of mode
      const tail = aFailEnabled ? '但A失败不计' : '继续打到通关';
      return {
        aTeam,
        finalWin: false,
        aNote: `${aTeamLabel} 在对方回合（${roundOwnerLabel}的级）胜但含末游，不通关，${tail}`,
        winnerNewLevel: teamLevels[winnerKey],
        loserNewLevel: null,
        newAFails,
      };
    }

    // Clean win (no partner at last) — check strict/lenient A pass condition.
    if (strictA && (roundLevel !== 'A' || roundOwner !== aTeam)) {
      const reason =
        roundLevel !== 'A'
          ? `本局级牌为${roundLevel}，需在自己的A级获胜才能通关`
          : `在${roundOwnerLabel}的回合，需在自己的A级获胜才能通关`;
      return {
        aTeam,
        finalWin: false,
        aNote: `${aTeamLabel} A级胜利（但${reason}）`,
        winnerNewLevel: teamLevels[winnerKey], // stay at A, no upgrade
        loserNewLevel: null,
        newAFails,
      };
    }

    // Pass! Lenient mode OR strict-mode-at-own-A.
    return {
      aTeam,
      finalWin: true,
      aNote: `${aTeamLabel} A级通关（胜方无末游${strictA ? '，在自己的A级' : ''}）`,
      winnerNewLevel: null, // no override; caller's upgrade calc still applies
      loserNewLevel: null,
      newAFails,
    };
  }

  // Case 2: A-team LOST
  if (roundOwner === aTeam) {
    // Own A round, didn't win → failure
    const fail = recordAFail(aTeam);
    if (fail) {
      // 4-player: track, possibly demote (the LOSER, since aTeam !== winnerKey)
      let aNote = `${aTeamLabel} A级失败（在自己的A级未取胜）→ A${fail.count}`;
      let loserNewLevel: LevelRank | null = null;
      if (fail.demoted) {
        loserNewLevel = '2';
        aNote += '｜累计3次失败，仅该队重置到2';
      }
      return {
        aTeam,
        finalWin: false,
        aNote,
        winnerNewLevel: null,
        loserNewLevel,
        newAFails,
      };
    }
    // 6/8: stay at A, keep playing
    return {
      aTeam,
      finalWin: false,
      aNote: `${aTeamLabel} 在自己的A级未取胜，继续打到通关`,
      winnerNewLevel: null,
      loserNewLevel: null,
      newAFails,
    };
  }

  // Loss on opponent's round — never a failure
  const tail = aFailEnabled ? '，A失败不计' : '';
  void loserKey; // suppress unused-var when this branch trims away conditional uses
  return {
    aTeam,
    finalWin: false,
    aNote: `${aTeamLabel} 在对方回合（${roundOwnerLabel}的级）未胜${tail}`,
    winnerNewLevel: null,
    loserNewLevel: null,
    newAFails,
  };
}
