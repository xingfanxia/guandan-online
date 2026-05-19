import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeCostUsd,
  DEEPSEEK_CHAT_RATES,
  DEFAULT_GATEWAY_MODEL,
  createGatewayGenerate,
} from '@lib/ai/gateway';

// Mock the 'ai' module so generateText calls go through a controllable spy.
// The hoisted spy is captured into a top-level `generateText` mock that each
// test can configure.
const generateText = vi.fn();
vi.mock('ai', () => ({
  generateText: (args: unknown) => generateText(args),
}));

beforeEach(() => {
  generateText.mockReset();
});

describe('computeCostUsd', () => {
  it('returns 0 when usage is undefined', () => {
    expect(computeCostUsd(undefined)).toBe(0);
  });

  it('returns 0 when both token counts are 0', () => {
    expect(computeCostUsd({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it('computes 1M input tokens × 0.27 USD = 0.27', () => {
    expect(
      computeCostUsd({ inputTokens: 1_000_000, outputTokens: 0 }, DEEPSEEK_CHAT_RATES),
    ).toBeCloseTo(0.27, 6);
  });

  it('computes 1M output tokens × 1.10 USD = 1.10', () => {
    expect(
      computeCostUsd({ inputTokens: 0, outputTokens: 1_000_000 }, DEEPSEEK_CHAT_RATES),
    ).toBeCloseTo(1.1, 6);
  });

  it('combines input + output at deepseek-chat rates', () => {
    // 500 input × 0.27/1M + 200 output × 1.10/1M = 0.000135 + 0.00022 = 0.000355
    const cost = computeCostUsd({ inputTokens: 500, outputTokens: 200 });
    expect(cost).toBeCloseTo(0.000355, 8);
  });

  it('treats missing fields as zero (degenerate response)', () => {
    expect(computeCostUsd({ inputTokens: 100 })).toBeGreaterThan(0);
    expect(computeCostUsd({ outputTokens: 100 })).toBeGreaterThan(0);
  });

  it('honors a custom rate table', () => {
    const cost = computeCostUsd(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { inputPerMillion: 1, outputPerMillion: 2 },
    );
    expect(cost).toBeCloseTo(3, 6);
  });
});

describe('createGatewayGenerate', () => {
  it("calls generateText with the default model string 'deepseek/deepseek-chat'", async () => {
    generateText.mockResolvedValue({
      text: 'choice: 1',
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    const fn = createGatewayGenerate();
    const ctrl = new AbortController();
    await fn({ system: 'sys', prompt: 'p', signal: ctrl.signal });
    expect(generateText).toHaveBeenCalledTimes(1);
    const args = generateText.mock.calls[0]![0] as Record<string, unknown>;
    expect(args['model']).toBe(DEFAULT_GATEWAY_MODEL);
    expect(args['system']).toBe('sys');
    expect(args['prompt']).toBe('p');
    expect(args['abortSignal']).toBe(ctrl.signal);
  });

  it('returns the response text + computed cost', async () => {
    generateText.mockResolvedValue({
      text: 'choice: 3',
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    const fn = createGatewayGenerate();
    const ctrl = new AbortController();
    const result = await fn({ system: 's', prompt: 'p', signal: ctrl.signal });
    expect(result.text).toBe('choice: 3');
    expect(result.costUsd).toBeCloseTo(0.27, 6);
  });

  it('honors a custom model override', async () => {
    generateText.mockResolvedValue({ text: '', usage: { inputTokens: 0, outputTokens: 0 } });
    const fn = createGatewayGenerate({ model: 'openai/gpt-4o-mini' });
    await fn({ system: '', prompt: '', signal: new AbortController().signal });
    const args = generateText.mock.calls[0]![0] as Record<string, unknown>;
    expect(args['model']).toBe('openai/gpt-4o-mini');
  });

  it('propagates errors from the SDK (caught by hard.ts try/catch)', async () => {
    generateText.mockRejectedValue(new Error('network down'));
    const fn = createGatewayGenerate();
    await expect(
      fn({ system: '', prompt: '', signal: new AbortController().signal }),
    ).rejects.toThrow('network down');
  });

  it('returns costUsd=0 when SDK omits usage entirely', async () => {
    generateText.mockResolvedValue({ text: 'ok' });
    const fn = createGatewayGenerate();
    const result = await fn({ system: '', prompt: '', signal: new AbortController().signal });
    expect(result.costUsd).toBe(0);
  });
});
