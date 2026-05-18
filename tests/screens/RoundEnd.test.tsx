// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoundEnd } from '@/screens/RoundEnd';

describe('RoundEnd', () => {
  const baseProps = {
    roundNumber: 6,
    resultLabel: '双下',
    levelDelta: 3,
    finishOrder: [
      { handle: '@阿祥', rank: 1 as const },
      { handle: '@泉酱', rank: 2 as const },
      { handle: '@老郭', rank: 3 as const },
      { handle: '@饭团', rank: 4 as const },
    ],
    teamWasLevel: '5' as const,
    teamNowLevel: '8' as const,
    nextLeaderHandle: '@饭团',
    nextRoundHasTribute: true,
    autoAdvanceSeconds: 8,
  };

  it('renders headline + level delta + winner roster', () => {
    render(<RoundEnd {...baseProps} />);
    expect(screen.getByText('双下', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
    // Winner roster appears in both the lede (under the headline) and the
    // detail strip's "阵容" cell — both should match.
    expect(screen.getAllByText(/@阿祥 头游/).length).toBeGreaterThanOrEqual(2);
  });

  it('shows upgrade range in detail strip', () => {
    render(<RoundEnd {...baseProps} />);
    // 5 → 8 appears in the upgrade detail cell
    const upgradeCell = screen
      .getAllByText(/升级/)[0]!
      .closest('.end-detail > div');
    expect(upgradeCell?.textContent).toContain('5');
    expect(upgradeCell?.textContent).toContain('8');
  });

  it('shows next-round leader with 进贡 suffix when tribute is due', () => {
    render(<RoundEnd {...baseProps} />);
    expect(screen.getByText(/@饭团 进贡/)).toBeInTheDocument();
  });

  it('hides 进贡 suffix when no tribute', () => {
    render(<RoundEnd {...baseProps} nextRoundHasTribute={false} />);
    expect(screen.queryByText(/@饭团 进贡/)).not.toBeInTheDocument();
    expect(screen.getByText(/@饭团/)).toBeInTheDocument();
  });

  it('renders 继续 button only when onContinue is provided', () => {
    const { rerender } = render(<RoundEnd {...baseProps} />);
    expect(screen.queryByRole('button', { name: '继续' })).not.toBeInTheDocument();
    const onContinue = vi.fn();
    rerender(<RoundEnd {...baseProps} onContinue={onContinue} />);
    const btn = screen.getByRole('button', { name: '继续' });
    fireEvent.click(btn);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('renders level ladder with was=5 + now=8 highlight', () => {
    const { container } = render(<RoundEnd {...baseProps} />);
    const wasRung = container.querySelector('[data-level="5"]');
    const nowRung = container.querySelector('[data-level="8"]');
    expect(wasRung?.className).toContain('ladder__rung--was');
    expect(nowRung?.className).toContain('ladder__rung--now');
  });
});
