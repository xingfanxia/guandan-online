// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExchangeVoteModal } from '@/screens/ExchangeVoteModal';

describe('ExchangeVoteModal', () => {
  it('renders the ballot with the card count', () => {
    render(<ExchangeVoteModal cardCount={3} onVote={() => {}} />);
    expect(screen.getByRole('dialog', { name: '换牌投票' })).toBeInTheDocument();
    expect(screen.getByText(/每位玩家交换 3 张牌/)).toBeInTheDocument();
  });

  it('fires onVote(true) on 赞成换牌', () => {
    const onVote = vi.fn();
    render(<ExchangeVoteModal cardCount={3} onVote={onVote} />);
    fireEvent.click(screen.getByRole('button', { name: '赞成换牌' }));
    expect(onVote).toHaveBeenCalledWith(true);
  });

  it('fires onVote(false) on 不换', () => {
    const onVote = vi.fn();
    render(<ExchangeVoteModal cardCount={3} onVote={onVote} />);
    fireEvent.click(screen.getByRole('button', { name: '不换' }));
    expect(onVote).toHaveBeenCalledWith(false);
  });

  it('disables both buttons while busy', () => {
    render(<ExchangeVoteModal cardCount={3} onVote={() => {}} busy />);
    expect(screen.getByRole('button', { name: '赞成换牌' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '不换' })).toBeDisabled();
  });
});
