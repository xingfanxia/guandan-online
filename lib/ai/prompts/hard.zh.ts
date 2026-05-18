// Hard-tier prompt strings — TypeScript-callable rendition of hard.zh.md.
//
// Keep this file's content semantically identical to hard.zh.md (the .md is
// the canonical human-readable source; this .ts is what code actually imports).

import type { Card } from '../../game/cards';
import type { Pattern } from '../../game/patterns';
import type { LevelRank } from '../../game/levels';

export const HARD_SYSTEM_PROMPT = `你是掼蛋顶级牌手。你的搭档和你一队，需要团队配合获胜。

判断原则（按重要性排序）：
1. 队友领先时（搭档已出完或剩1-2张），不要抢牌——让队友顺手
2. 自己手中炸弹/同花顺/王炸是关键，能压制对手翻盘
3. 出牌目标是清空手牌，但要保留关键大牌应对终局
4. A级局面（任一队在A）时，必须更激进——错失一手等于失败

你只能从下面提供的候选出牌中选一个，不能自创出牌。

输出格式（严格遵守，禁止解释）：
选择: <数字>
理由: <十字以内>`;

export interface CandidateAnnotation {
  /** 1-based index shown to the LLM. */
  index: number;
  /** Human-readable description, e.g. "一对 7". */
  description: string;
  /** Short tactical signal, e.g. "保留炸弹" or "清空手牌". */
  signal: string;
}

export interface UserPromptContext {
  seat: number;
  teamName: '红' | '黑';
  myLevel: LevelRank;
  oppLevel: LevelRank;
  isALevel: boolean;
  partnerSeat: number;
  partnerCards: number;
  opp1Seat: number;
  opp1Cards: number;
  opp2Seat: number;
  opp2Cards: number;
  myHand: readonly Card[];
  /** null = I am leading. */
  currentLeadingPlay: Pattern | null;
  candidates: readonly CandidateAnnotation[];
}

const SUIT_TO_GLYPH: Record<Card['suit'], string> = {
  spades: '♠',
  hearts: '♥',
  clubs: '♣',
  diamonds: '♦',
  joker: '★',
};

function formatHand(hand: readonly Card[]): string {
  return hand
    .map((c) => {
      if (c.suit === 'joker') return c.rank === 'RJ' ? '大王' : '小王';
      return `${SUIT_TO_GLYPH[c.suit]}${c.rank}`;
    })
    .join(' ');
}

function formatPattern(p: Pattern): string {
  return `${p.kind}(${p.cards.length}张 · ${p.rank ?? '王炸'})`;
}

export function buildUserPrompt(ctx: UserPromptContext): string {
  const aLevelNote = ctx.isALevel ? '（A级关键局）' : '';
  const lead = ctx.currentLeadingPlay
    ? formatPattern(ctx.currentLeadingPlay)
    : '我是首发（无需应对）';

  const candidateLines = ctx.candidates
    .map((c) => `${c.index}. ${c.description} — ${c.signal}`)
    .join('\n');

  return `当前局面：
- 我的座位：${ctx.seat}（${ctx.teamName}队）
- 当前级别：我方 ${ctx.myLevel}，对手 ${ctx.oppLevel}${aLevelNote}
- 队友座位：${ctx.partnerSeat}，剩 ${ctx.partnerCards} 张
- 对手座位：${ctx.opp1Seat}（剩 ${ctx.opp1Cards} 张），${ctx.opp2Seat}（剩 ${ctx.opp2Cards} 张）
- 我的手牌：${formatHand(ctx.myHand)}

需要应对的牌型：${lead}

候选出牌：
${candidateLines}

(其中至少一个是"过"，即不出牌)`;
}
