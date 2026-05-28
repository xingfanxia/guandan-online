// Game-mode constants (4 / 6 / 8 player).
//
// SYNC: Mirrors sibling scorer's core/config.js:21-64 default rule values.
// The scorer exposes these as runtime-configurable preferences; this port
// surfaces them as defaults + types. Per-room overrides land in ROOM-2.

export type GameMode = '4' | '6' | '8';
export type TeamKey = 't1' | 't2';

/** Positions a winning 4-player team can hold (sorted). */
export type FourPlayerPositions = '1,2' | '1,3' | '1,4';

/** Per-mode rule configuration. Shape matches sibling scorer for cross-app sanity. */
export interface ModeRules {
  /** 4P upgrade table: positions (1,2)→+3, (1,3)→+2, (1,4)→+1. */
  c4: Record<FourPlayerPositions, number>;

  /** 6P score-difference thresholds: ≥g3→+3 levels, ≥g2→+2, ≥g1→+1. */
  t6: { g3: number; g2: number; g1: number };

  /** 6P position points (1st through 6th place). */
  p6: Readonly<Record<number, number>>;

  /** 8P score-difference thresholds. */
  t8: { g3: number; g2: number; g1: number };

  /** 8P position points (1st through 8th place). */
  p8: Readonly<Record<number, number>>;

  /** Require 1st-place finish on winning team to upgrade (6P / 8P only). */
  must1: boolean;

  /** Strict A-mode: must win during own A-level round. */
  strictA: boolean;

  /**
   * Manual tribute mode (4P only). When false (default), `dealNextRound` auto-
   * picks tribute + return cards server-side and starts the next round's trick
   * in one step. When true, `dealNextRound` instead sets `pendingTribute` on
   * the new round and waits for players to dispatch `tribute_select` /
   * `anti_tribute` commands; the trick only starts once the manual flow
   * finalizes (all obligations satisfied or resist declared).
   *
   * Has no effect on 6P / 8P rounds — those skip tribute entirely.
   */
  manualTribute: boolean;

  /**
   * Heart card of current level acts as wildcard. Default true.
   * Display-only at v1 — `cards.ts isWildcard` already implements this
   * unconditionally; the toggle is preserved on RoomState so a future
   * engine pass can branch on it.
   */
  wildcardHeart: boolean;

  /** Allow declaring "last call" (报警) on the last card. Display-only at v1. */
  lastCallDeclare: boolean;

  /**
   * Allow steel-plate pattern (钢板 — 三连对的同点数变体). Default true.
   * Display-only at v1 — pattern enumeration already includes it.
   */
  steelPlate: boolean;

  /**
   * Allow tri-pair pattern (三连对). Default false in some regional rulesets.
   * Display-only at v1.
   */
  triPair: boolean;

  /**
   * Straight-flush outranks 5-bomb (同花顺 > 5 炸). Default true.
   * Display-only at v1 — `bomb.ts` already implements this ordering.
   */
  straightFlushAboveBomb5: boolean;

  /**
   * EXCHANGE-1: optional card-exchange (换牌). Default false. When true, after
   * tribute resolves the losing team votes; if > 50% vote yes, every player
   * exchanges 3 cards with a neighbor in a server-randomized direction before
   * the next round's first trick. No effect when off — the trick starts
   * immediately as before.
   */
  cardExchange: boolean;
}

/** Canonical defaults — mirror sibling scorer's live config (config.js:22-54). */
export const DEFAULT_MODE_RULES: ModeRules = {
  c4: { '1,2': 3, '1,3': 2, '1,4': 1 },

  t6: { g3: 7, g2: 4, g1: 1 },
  p6: { 1: 5, 2: 4, 3: 3, 4: 3, 5: 1, 6: 0 },

  t8: { g3: 11, g2: 5, g1: 0 },
  p8: { 1: 7, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 0 },

  must1: true,
  strictA: true,
  manualTribute: false,
  wildcardHeart: true,
  lastCallDeclare: false,
  steelPlate: true,
  triPair: false,
  straightFlushAboveBomb5: true,
  cardExchange: false,
};

/** Number of finishing positions for a given mode. */
export function positionCount(mode: GameMode): 4 | 6 | 8 {
  return mode === '4' ? 4 : mode === '6' ? 6 : 8;
}

/** Number of player-ranks the winning team contributes per round. */
export function winningRankCount(mode: GameMode): 2 | 3 | 4 {
  return mode === '4' ? 2 : mode === '6' ? 3 : 4;
}

/**
 * A-fail counter (3-strike demotion to level 2) is 4P-only since the
 * 2026-05 simplification. In 6P / 8P, A-level teams stay at A until they
 * satisfy the pass condition. See sibling scorer's rules.js:20-22.
 */
export function tracksAFail(mode: GameMode): boolean {
  return mode === '4';
}
