// Level sequence (级牌) — teams climb 2 → A.
//
// SYNC: Mirrors sibling scorer's calculator.js:124-129 (nextLevel) but typed.
// The sequence is invariant across 4 / 6 / 8 player modes; only the upgrade
// math differs (see upgrade.ts).

export const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export type LevelRank = (typeof LEVELS)[number];

const LEVEL_INDEX: ReadonlyMap<LevelRank, number> = new Map(
  LEVELS.map((rank, i) => [rank, i])
);

/** Numeric position of a level in the climb (0='2' ... 12='A'). */
export function levelIndex(level: LevelRank): number {
  return LEVEL_INDEX.get(level) ?? 0;
}

/**
 * Advance a level by `increment` rungs, clamped at 'A'.
 *
 * Clamping at A is intentional — a team cannot upgrade past A via this
 * function. A-level win conditions are evaluated separately in aLevel.ts.
 *
 * Negative increments are clamped at the floor ('2') — used by demotion paths
 * (3-strike A-fail in 4P mode resets to 2 via direct setter, not this fn,
 * but defensive clamp keeps callers safe).
 */
export function nextLevel(current: LevelRank, increment: number): LevelRank {
  const i = levelIndex(current);
  const target = i + increment;
  const clamped = Math.max(0, Math.min(LEVELS.length - 1, target));
  return LEVELS[clamped]!;
}

/** True if `level` is the terminal climb level. */
export function isALevel(level: LevelRank): boolean {
  return level === 'A';
}
