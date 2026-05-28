// Player assistance — Chinese pattern labels (AI-3).
//
// Maps a Pattern to a short human-readable Chinese caption, e.g.
//   pair of 7  → "一对 7"
//   triple K   → "三张 K"
//   straight   → "顺子"
//   bomb (×4)  → "四炸 9"
//
// Used by SuggestionHint + WildcardSubDialog captions. Pure helper.

import type { Card, NaturalSuit, Rank } from '@lib/game/cards';
import type { Pattern } from '@lib/game/patterns';

const KIND_LABEL: Record<Pattern['kind'], string> = {
  single: '单张',
  pair: '一对',
  triple: '三张',
  fullHouse: '三带二',
  threePairs: '三连对',
  twoTriples: '钢板',
  straight: '顺子',
  flushStraight: '同花顺',
  bomb: '炸弹',
  jokerBomb: '天王炸',
};

const RANK_LABEL: Record<Rank, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8',
  '9': '9', '10': '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
  BJ: '小王', RJ: '大王',
};

const SUIT_SYM: Record<NaturalSuit, string> = {
  spades: '♠',
  hearts: '♥',
  clubs: '♣',
  diamonds: '♦',
};

/** Short label for the rank of a pattern, '' when rank is null (jokerBomb). */
export function rankLabel(rank: Rank | null): string {
  return rank === null ? '' : RANK_LABEL[rank];
}

/**
 * Caption for a suggested play. Examples:
 *   "一对 7", "三张 K", "顺子 至 9", "四炸 9", "天王炸".
 */
export function patternLabel(p: Pattern): string {
  const kind = KIND_LABEL[p.kind];
  switch (p.kind) {
    case 'single':
    case 'pair':
    case 'triple':
    case 'fullHouse':
      return `${kind} ${rankLabel(p.rank)}`;
    case 'straight':
    case 'threePairs':
    case 'twoTriples':
      // Sequence patterns read by their high card.
      return `${kind} 至 ${rankLabel(p.rank)}`;
    case 'flushStraight':
      return `${kind} 至 ${rankLabel(p.rank)}`;
    case 'bomb':
      // 四炸 / 五炸 / … by length.
      return `${BOMB_SIZE_LABEL[p.length] ?? `${p.length} 炸`} ${rankLabel(p.rank)}`;
    case 'jokerBomb':
      return kind;
  }
}

const BOMB_SIZE_LABEL: Record<number, string> = {
  4: '四炸',
  5: '五炸',
  6: '六炸',
  7: '七炸',
  8: '八炸',
};

/** Suited card label, e.g. "♥7". For wildcard interpretation display. */
export function cardLabel(c: Card): string {
  if (c.suit === 'joker') return RANK_LABEL[c.rank];
  return `${SUIT_SYM[c.suit]}${c.rank}`;
}
