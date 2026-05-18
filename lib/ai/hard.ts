// Hard AI tier — LLM-backed bot with rule-based fallback.
//
// Routing per Vercel session guidance: prefer `"provider/model"` strings
// through the Vercel AI Gateway over provider-specific packages. The
// generator function is dependency-injected so tests can mock it.
//
// Strategy:
//   1. Use Medium tier to enumerate + rank top N candidate plays (default 8).
//   2. Annotate each candidate with a short tactical signal.
//   3. Hand the list to the LLM via gateway model string (default 'deepseek/deepseek-chat').
//   4. Parse the response — strict regex on `选择: <n>|pass|过`.
//   5. On ANY failure (timeout / malformed / non-existent index / budget cap /
//      feature flag off), fall back to the Medium top pick.
//
// Failure modes covered:
//   - LLM down / network error → caught, fall back.
//   - LLM picks invalid index → parse returns null, fall back.
//   - Timeout via AbortSignal.timeout(3000) → caught, fall back.
//   - Budget exhausted → skipped, fall back.
//   - FEATURE_AI_HARD env var !== 'true' → skipped, fall back.

import type { Card } from '../game/cards';
import type { Pattern } from '../game/patterns';
import type { LevelRank } from '../game/levels';
import type { PlayerId } from '../game/round';
import { enumerateLegalPlays } from './enumerate';
import { decidePartnerCoop, rankByCoop } from './coop';
import { canAffordHardMove, type BudgetClient } from './budget';
import {
  HARD_SYSTEM_PROMPT,
  buildUserPrompt,
  type CandidateAnnotation,
  type UserPromptContext,
} from './prompts/hard.zh';

export type HardMove =
  | { kind: 'play'; pattern: Pattern }
  | { kind: 'pass' };

export interface HardContext {
  hand: readonly Card[];
  target: Pattern | null;
  levelRank: LevelRank;
  lastPlayer: PlayerId | null;
  me: PlayerId;
  partner: PlayerId;
  partnerHandCount: number;
  opponentHandCounts: readonly number[];

  /** Display fields for the LLM prompt. */
  prompt: Omit<UserPromptContext, 'myHand' | 'currentLeadingPlay' | 'candidates'>;

  /** Budget guardrail. Pass createMemoryBudgetClient() if you don't have one. */
  budget: BudgetClient;

  /**
   * LLM call. Defaults to a thunk that throws — production must inject the
   * Vercel AI SDK `generateText({ model: 'deepseek/deepseek-chat', ... })`
   * via this surface. Kept as a function so tests can mock without spinning
   * up actual model calls.
   */
  generate: (input: GenerateInput) => Promise<GenerateResult>;

  /** Number of candidates to surface to the LLM. Default 8. */
  candidateCount?: number;

  /** Override the FEATURE_AI_HARD env-var check. Tests pass true; prod reads env. */
  featureEnabled?: boolean;

  /** Request timeout in ms. Default 3000. */
  timeoutMs?: number;
}

export interface GenerateInput {
  system: string;
  prompt: string;
  signal: AbortSignal;
}

export interface GenerateResult {
  text: string;
  /** Optional usage info; if provided, hard.ts records the cost. */
  costUsd?: number;
}

const DEFAULT_CANDIDATE_COUNT = 8;
const DEFAULT_TIMEOUT_MS = 3000;

export async function chooseHardMove(ctx: HardContext): Promise<HardMove> {
  const plays = enumerateLegalPlays(ctx.hand, ctx.target, ctx.levelRank);
  const fallback = chooseFallback(plays, ctx);

  // Feature flag off → skip LLM.
  const featureEnabled = ctx.featureEnabled ?? process.env['FEATURE_AI_HARD'] === 'true';
  if (!featureEnabled) return fallback;

  // Budget guardrail → skip LLM.
  const affordable = await canAffordHardMove(ctx.budget);
  if (!affordable) return fallback;

  // Leader with single legal play → no choice to make.
  if (ctx.target === null && plays.length === 1) {
    return { kind: 'play', pattern: plays[0]! };
  }
  // No legal beat → must pass.
  if (ctx.target !== null && plays.length === 0) {
    return { kind: 'pass' };
  }

  const candidatePool = topCandidatesForPrompt(plays, ctx);
  const annotations = annotateCandidates(candidatePool, ctx);

  // Append the "pass" sentinel (followers can pass; leaders cannot).
  const annotated: AnnotatedCandidate[] = [...annotations];
  if (ctx.target !== null) {
    annotated.push({
      index: annotated.length + 1,
      description: '过',
      signal: '保牌不出',
      decision: { kind: 'pass' },
    });
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const promptCtx: UserPromptContext = {
      ...ctx.prompt,
      myHand: ctx.hand,
      currentLeadingPlay: ctx.target,
      candidates: annotated.map(toAnnotation),
    };
    const result = await ctx.generate({
      system: HARD_SYSTEM_PROMPT,
      prompt: buildUserPrompt(promptCtx),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (typeof result.costUsd === 'number') {
      await ctx.budget.recordCost(result.costUsd);
    }

    const choice = parseLLMChoice(result.text, annotated);
    if (choice) return choice.decision;
  } catch {
    // Any error → silent fallback.
  }

  return fallback;
}

interface AnnotatedCandidate extends CandidateAnnotation {
  decision: HardMove;
}

function toAnnotation(c: AnnotatedCandidate): CandidateAnnotation {
  return { index: c.index, description: c.description, signal: c.signal };
}

function topCandidatesForPrompt(plays: readonly Pattern[], ctx: HardContext): Pattern[] {
  const coopCtx = {
    lastPlayer: ctx.lastPlayer,
    me: ctx.me,
    partner: ctx.partner,
    partnerHandCount: ctx.partnerHandCount,
    opponentHandCounts: ctx.opponentHandCounts,
    levelRank: ctx.levelRank,
    myHandCount: ctx.hand.length,
  };
  const advice = decidePartnerCoop(coopCtx);
  const ranked = rankByCoop(plays, advice, ctx.levelRank);
  return ranked.slice(0, ctx.candidateCount ?? DEFAULT_CANDIDATE_COUNT);
}

function annotateCandidates(plays: readonly Pattern[], ctx: HardContext): AnnotatedCandidate[] {
  return plays.map((p, i): AnnotatedCandidate => ({
    index: i + 1,
    description: describe(p),
    signal: tacticalSignal(p, ctx),
    decision: { kind: 'play', pattern: p },
  }));
}

function describe(p: Pattern): string {
  const kindLabel: Record<Pattern['kind'], string> = {
    single: '单张',
    pair: '一对',
    triple: '三张',
    fullHouse: '三带二',
    threePairs: '三连对',
    twoTriples: '钢板',
    straight: '顺子',
    flushStraight: '同花顺',
    bomb: '炸弹',
    jokerBomb: '王炸',
  };
  const rankPart = p.rank === null ? '' : ` ${p.rank}`;
  const lenPart = p.length > 1 ? ` ×${p.length}` : '';
  return `${kindLabel[p.kind]}${rankPart}${lenPart}`;
}

function tacticalSignal(p: Pattern, ctx: HardContext): string {
  if (p.kind === 'jokerBomb') return '王炸';
  if (p.kind === 'bomb') return '保留炸弹';
  if (p.cards.length === ctx.hand.length) return '清空手牌';
  if (ctx.target === null) return '首发';
  return '应对';
}

function chooseFallback(plays: readonly Pattern[], ctx: HardContext): HardMove {
  // No legal play as follower → pass.
  if (ctx.target !== null && plays.length === 0) return { kind: 'pass' };
  if (plays.length === 0) {
    throw new Error('chooseHardMove: leading with no legal plays — caller bug');
  }
  const top = topCandidatesForPrompt(plays, ctx);
  return { kind: 'play', pattern: top[0]! };
}

export function parseLLMChoice(
  text: string,
  candidates: readonly AnnotatedCandidate[],
): AnnotatedCandidate | null {
  const m = text.match(/(?:选择|choice)\s*[:：]\s*(\d+|pass|过)/i);
  if (!m || !m[1]) return null;
  const token = m[1].toLowerCase();
  if (token === 'pass' || token === '过') {
    return candidates.find((c) => c.decision.kind === 'pass') ?? null;
  }
  const idx = parseInt(token, 10) - 1;
  return candidates[idx] ?? null;
}
