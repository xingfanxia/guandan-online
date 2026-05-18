// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Victory } from '@/screens/Victory';

describe('Victory', () => {
  const baseProps = {
    winningTeam: 't1' as const,
    winningTeamLabel: '我方',
    winningRoster: [
      { handle: '@阿祥', avatarClass: 'avatar--self' },
      { handle: '@泉酱', avatarClass: 'avatar--partner' },
    ],
    finalLevel: 'A' as const,
    duration: '47:18',
    roundCount: 13,
  };

  it('renders 胜 rune + winning team + roster', () => {
    render(<Victory {...baseProps} />);
    expect(screen.getByText('胜')).toBeInTheDocument();
    expect(screen.getByText('我方')).toBeInTheDocument();
    expect(screen.getByText(/47:18/)).toBeInTheDocument();
    expect(screen.getByText(/13 局/)).toBeInTheDocument();
    expect(screen.getByText('@阿祥')).toBeInTheDocument();
    expect(screen.getByText('@泉酱')).toBeInTheDocument();
  });

  it('shows MVP when handle is provided', () => {
    render(<Victory {...baseProps} mvpHandle="@阿祥" />);
    // MVP key label
    expect(screen.getByText('MVP')).toBeInTheDocument();
    // The mvpHandle appears in the MVP cell (in addition to the roster).
    expect(screen.getAllByText('@阿祥').length).toBeGreaterThanOrEqual(2);
  });

  it('hides MVP when not provided', () => {
    render(<Victory {...baseProps} />);
    expect(screen.queryByText('MVP')).not.toBeInTheDocument();
  });

  it('return button fires onReturn', () => {
    const onReturn = vi.fn();
    render(<Victory {...baseProps} onReturn={onReturn} />);
    fireEvent.click(screen.getByRole('button', { name: /返回首页/ }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('share button appears only when onShare is provided', () => {
    const { rerender } = render(<Victory {...baseProps} />);
    expect(screen.queryByRole('button', { name: '分享战报' })).not.toBeInTheDocument();
    const onShare = vi.fn();
    rerender(<Victory {...baseProps} onShare={onShare} />);
    fireEvent.click(screen.getByRole('button', { name: '分享战报' }));
    expect(onShare).toHaveBeenCalledTimes(1);
  });
});
