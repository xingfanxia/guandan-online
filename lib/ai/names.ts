// Bot name generator — Chinese-friendly handles with per-tier badge.
//
// SYNC: docs/plan/PLAN.md AI-1 spec ("Chinese-friendly bot name generator
// (@小李 / @豆豆 / @毛毛 / etc.) with tier badge"). Generated names are
// stored in PlayerSummary.handle on the wire; the badge displays next to
// the name in the lobby + scoreboard so opponents can tell what tier they
// face.
//
// Pure-functional. RNG injected; deterministic per seed for replay tests.

export type BotTier = 'easy' | 'medium';

/** Tier-specific decoration shown alongside the handle. */
export const TIER_BADGES: Record<BotTier, string> = {
  easy: '🌱',
  medium: '⚡',
};

/**
 * Cute / common Chinese 2-char names. Deliberately neutral, friendly, and
 * skewed toward the kind of nicknames real Guandan players use online. None
 * collide with @AX-style admin handles.
 */
export const BOT_HANDLE_POOL: readonly string[] = [
  '小李', '小张', '小王', '小刘', '小陈', '小赵',
  '豆豆', '毛毛', '球球', '果果', '糖糖', '萌萌',
  '阿强', '阿明', '阿伟', '阿亮', '阿杰', '阿龙',
  '飞飞', '乐乐', '欢欢', '咪咪', '点点', '团团',
  '小狐', '小熊', '小兔', '小猫', '小狗', '小猪',
];

export interface BotName {
  handle: string;
  badge: string;
}

export function generateBotName(tier: BotTier, rng: () => number): BotName {
  const idx = Math.floor(rng() * BOT_HANDLE_POOL.length);
  const body = BOT_HANDLE_POOL[idx]!;
  return {
    handle: `@${body}`,
    badge: TIER_BADGES[tier],
  };
}
