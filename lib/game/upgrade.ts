// Upgrade calculation — given a round's winning-team finishing positions,
// compute how many levels the team advances.
//
// SYNC: Pure-functional port of sibling scorer's calculator.js:139-224
// (calculateUpgrade). Two structural differences:
//   1. No singleton config — caller passes ModeRules explicitly
//   2. No console.error — invalid input returns { upgrade: 0, error: ... }
// Semantics MUST stay byte-identical so cross-app result sync stays
// well-defined when AUTH-2 ships.

import type { FourPlayerPositions, GameMode, ModeRules } from './mode.js';
import { winningRankCount } from './mode.js';

export interface UpgradeInput {
  mode: GameMode;
  /** Winning team's finishing positions, sorted ascending. */
  ranks: number[];
  rules: ModeRules;
  /** Override mode-wide must1 preference for this calc (defaults to rules.must1). */
  must1?: boolean;
}

export interface UpgradeDetails {
  mode: '4-player' | '6-player' | '8-player';
  combination?: FourPlayerPositions;
  upgradeTable?: ModeRules['c4'];
  ourScore?: number;
  oppScore?: number;
  difference?: number;
  hasFirstPlace?: boolean;
  thresholds?: ModeRules['t6'] | ModeRules['t8'];
  sweepBonus?: true;
}

export interface UpgradeResult {
  upgrade: number;
  details: UpgradeDetails;
  error?: string;
}

/** Sum array entries (port of calculator.js:83-89). */
function sum(arr: readonly number[]): number {
  let total = 0;
  for (const n of arr) total += n;
  return total;
}

/** Sum of points for ranks (port of calculator.js:97-103, with safe lookup). */
function scoreSum(ranks: readonly number[], pointMap: Readonly<Record<number, number>>): number {
  let total = 0;
  for (const r of ranks) total += pointMap[r] ?? 0;
  return total;
}

/** Tier function: convert score difference to upgrade level 0–3. */
function tier(diff: number, thresholds: { g3: number; g2: number; g1: number }): number {
  if (diff >= thresholds.g3) return 3;
  if (diff >= thresholds.g2) return 2;
  if (diff >= thresholds.g1) return 1;
  return 0;
}

export function calculateUpgrade(input: UpgradeInput): UpgradeResult {
  const { mode, ranks, rules } = input;
  const must1 = input.must1 ?? rules.must1;

  const expected = winningRankCount(mode);
  if (!Array.isArray(ranks) || ranks.length !== expected) {
    return {
      upgrade: 0,
      details: { mode: `${mode}-player` as UpgradeDetails['mode'] },
      error: `mode ${mode} requires ${expected} ranks, got ${ranks?.length}`,
    };
  }

  // 4-player: fixed table by winning team's two positions.
  if (mode === '4') {
    const key = `${ranks[0]},${ranks[1]}` as FourPlayerPositions;
    const upgrade = rules.c4[key] ?? 0;
    return {
      upgrade,
      details: {
        mode: '4-player',
        combination: key,
        upgradeTable: rules.c4,
      },
    };
  }

  // 6-player: score differential between teams.
  if (mode === '6') {
    const ourScore = scoreSum(ranks, rules.p6);
    const allPoints = [1, 2, 3, 4, 5, 6].map((r) => rules.p6[r] ?? 0);
    const oppScore = sum(allPoints) - ourScore;
    const diff = ourScore - oppScore;
    const hasFirstPlace = ranks.includes(1);
    const upgrade = must1 && !hasFirstPlace ? 0 : tier(diff, rules.t6);
    return {
      upgrade,
      details: {
        mode: '6-player',
        ourScore,
        oppScore,
        difference: diff,
        hasFirstPlace,
        thresholds: rules.t6,
      },
    };
  }

  // 8-player: sweep bonus (1-2-3-4 same team = +4) takes priority over diff calc.
  if (ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3 && ranks[3] === 4) {
    return {
      upgrade: 4,
      details: { mode: '8-player', sweepBonus: true },
    };
  }

  const ourScore = scoreSum(ranks, rules.p8);
  const allPoints = [1, 2, 3, 4, 5, 6, 7, 8].map((r) => rules.p8[r] ?? 0);
  const oppScore = sum(allPoints) - ourScore;
  const diff = ourScore - oppScore;
  const hasFirstPlace = ranks.includes(1);
  const upgrade = must1 && !hasFirstPlace ? 0 : tier(diff, rules.t8);
  return {
    upgrade,
    details: {
      mode: '8-player',
      ourScore,
      oppScore,
      difference: diff,
      hasFirstPlace,
      thresholds: rules.t8,
    },
  };
}
