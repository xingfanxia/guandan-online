import { describe, it, expect, vi } from 'vitest';
import { chooseHardMove, parseLLMChoice, type GenerateResult, type HardContext } from '@lib/ai/hard';
import { createMemoryBudgetClient } from '@lib/ai/budget';
import type { Card } from '@lib/game/cards';
import type { Pattern } from '@lib/game/patterns';
import { analyzeHand } from '@lib/game/patterns';

const c = (rank: Card['rank'], suit: Card['suit'], deck: Card['deck'] = 1): Card => ({ rank, suit, deck });

const HAND: Card[] = [
  c('3', 'hearts'), c('3', 'spades'),
  c('K', 'clubs'), c('K', 'diamonds'),
];

function ctxWithGenerate(
  generate: HardContext['generate'],
  override: Partial<HardContext> = {},
): HardContext {
  return {
    hand: HAND,
    target: null,
    levelRank: '2',
    lastPlayer: 'opp',
    me: 'me',
    partner: 'partner',
    partnerHandCount: 12,
    opponentHandCounts: [12, 13],
    budget: createMemoryBudgetClient(0),
    featureEnabled: true,
    timeoutMs: 1000,
    generate,
    prompt: {
      seat: 1,
      teamName: '红',
      myLevel: '2',
      oppLevel: '2',
      isALevel: false,
      partnerSeat: 3,
      partnerCards: 12,
      opp1Seat: 2,
      opp1Cards: 12,
      opp2Seat: 4,
      opp2Cards: 13,
    },
    ...override,
  };
}

describe('parseLLMChoice', () => {
  const annotated = [
    { index: 1, description: 'A', signal: 's', decision: { kind: 'play', pattern: { kind: 'pair', rank: '3', length: 2, cards: [] } as unknown as Pattern } as const },
    { index: 2, description: 'B', signal: 's', decision: { kind: 'play', pattern: { kind: 'pair', rank: 'K', length: 2, cards: [] } as unknown as Pattern } as const },
    { index: 3, description: '过', signal: 'pass', decision: { kind: 'pass' } as const },
  ];

  it('parses 选择: 2 format', () => {
    const ch = parseLLMChoice('选择: 2\n理由: 保大', annotated);
    expect(ch?.index).toBe(2);
  });

  it('parses Choice: 1 (English)', () => {
    const ch = parseLLMChoice('Choice: 1', annotated);
    expect(ch?.index).toBe(1);
  });

  it('parses 选择: 过 as pass candidate', () => {
    const ch = parseLLMChoice('选择: 过', annotated);
    expect(ch?.decision.kind).toBe('pass');
  });

  it('parses 选择: pass as pass candidate', () => {
    const ch = parseLLMChoice('选择: pass', annotated);
    expect(ch?.decision.kind).toBe('pass');
  });

  it('returns null for malformed output (no 选择:)', () => {
    expect(parseLLMChoice('garbage text', annotated)).toBeNull();
  });

  it('returns null for out-of-range index', () => {
    expect(parseLLMChoice('选择: 99', annotated)).toBeNull();
  });
});

describe('chooseHardMove', () => {
  it('falls back to Medium pick when featureEnabled=false', async () => {
    const generate = vi.fn();
    const move = await chooseHardMove(ctxWithGenerate(generate, { featureEnabled: false }));
    expect(generate).not.toHaveBeenCalled();
    expect(move.kind).toBe('play');
  });

  it('falls back to Medium pick when budget exhausted', async () => {
    const generate = vi.fn();
    const budget = createMemoryBudgetClient(100);
    const move = await chooseHardMove(ctxWithGenerate(generate, { budget }));
    expect(generate).not.toHaveBeenCalled();
    expect(move.kind).toBe('play');
  });

  it('calls LLM and uses its choice when affordable + feature on', async () => {
    const generate = vi.fn().mockResolvedValue({
      text: '选择: 1\n理由: 试',
      costUsd: 0.001,
    } satisfies GenerateResult);
    const move = await chooseHardMove(ctxWithGenerate(generate));
    expect(generate).toHaveBeenCalledOnce();
    expect(move.kind).toBe('play');
  });

  it('records cost via budget client', async () => {
    const budget = createMemoryBudgetClient(0);
    const generate = vi.fn().mockResolvedValue({ text: '选择: 1', costUsd: 0.05 });
    await chooseHardMove(ctxWithGenerate(generate, { budget }));
    expect(await budget.currentSpend()).toBeCloseTo(0.05);
  });

  it('falls back when LLM throws (timeout or net error)', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('network'));
    const move = await chooseHardMove(ctxWithGenerate(generate));
    expect(move.kind).toBe('play');
  });

  it('falls back when LLM returns garbage', async () => {
    const generate = vi.fn().mockResolvedValue({ text: 'I dunno' });
    const move = await chooseHardMove(ctxWithGenerate(generate));
    expect(move.kind).toBe('play');
  });

  it('returns pass when target unbeatable and LLM picks pass', async () => {
    const target = analyzeHand([c('A', 'hearts'), c('A', 'spades')], '2'); // unbeatable by pair-3
    if (!target) throw new Error('expected target');
    const handPair3: Card[] = [c('3', 'hearts'), c('3', 'spades')];
    const generate = vi.fn();
    const move = await chooseHardMove(ctxWithGenerate(generate, { hand: handPair3, target }));
    expect(move.kind).toBe('pass');
    expect(generate).not.toHaveBeenCalled();
  });

  it('skips LLM (no choice) when leading with single legal play', async () => {
    const generate = vi.fn();
    const single: Card[] = [c('5', 'hearts')];
    const move = await chooseHardMove(ctxWithGenerate(generate, { hand: single, target: null }));
    expect(move.kind).toBe('play');
    expect(generate).not.toHaveBeenCalled();
  });
});
