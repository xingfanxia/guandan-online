// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TributeModal } from '@/screens/TributeModal';
import type { Card } from '@lib/game/cards';

const c = (rank: Card['rank'], suit: Card['suit'], deck: 1 | 2 = 1): Card => ({
  rank,
  suit,
  deck,
});

const KEY = (card: Card) => `${card.rank}-${card.suit}-${card.deck}`;

describe('TributeModal - auto state (S04)', () => {
  it('renders loser → winner card travel with rule hint', () => {
    render(
      <TributeModal
        state={{
          kind: 'auto',
          fromHandle: '@饭团',
          toHandle: '@阿祥',
          card: c('A', 'spades'),
          roundNumber: 6,
          countdownSeconds: 3,
          ruleHint: '进贡牌必须是手中最大点数的非红心通配牌',
        }}
      />
    );
    expect(screen.getByRole('dialog', { name: '进贡阶段' })).toBeInTheDocument();
    expect(screen.getByText(/第 6 局/)).toBeInTheDocument();
    expect(screen.getByText('3s')).toBeInTheDocument();
    expect(screen.getByText(/进贡牌必须是手中最大点数/)).toBeInTheDocument();
    // Both sides render the card
    expect(screen.getAllByLabelText(/A of spades/i)).toHaveLength(2);
  });

  it('omits countdown when undefined', () => {
    render(
      <TributeModal
        state={{
          kind: 'auto',
          fromHandle: '@饭团',
          toHandle: '@阿祥',
          card: c('A', 'spades'),
          roundNumber: 6,
        }}
      />
    );
    expect(screen.queryByText(/^\d+s$/)).not.toBeInTheDocument();
  });
});

describe('TributeModal - pending state (S11)', () => {
  it('renders all hand cards; only candidates are clickable', () => {
    const hand: Card[] = [c('3', 'hearts'), c('A', 'spades'), c('A', 'hearts')];
    const candidates = new Set([KEY(c('A', 'spades')), KEY(c('A', 'hearts'))]);
    render(
      <TributeModal
        state={{
          kind: 'pending',
          loserHandle: '@饭团',
          winnerHandle: '@阿祥',
          hand,
          candidateKeys: candidates,
          roundNumber: 6,
          progressLabel: '1/2',
          countdownSeconds: 12,
        }}
      />
    );
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
    expect(screen.getByText('12s')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    // The non-candidate (3♥) is disabled
    expect(options[0]).toBeDisabled();
    expect(options[1]).not.toBeDisabled();
  });

  it('selecting + confirming fires onConfirm with the chosen card', () => {
    const hand: Card[] = [c('A', 'spades'), c('A', 'hearts')];
    const candidates = new Set([KEY(c('A', 'spades')), KEY(c('A', 'hearts'))]);
    const onConfirm = vi.fn();
    render(
      <TributeModal
        state={{
          kind: 'pending',
          loserHandle: '@饭团',
          winnerHandle: '@阿祥',
          hand,
          candidateKeys: candidates,
          roundNumber: 6,
          countdownSeconds: 12,
        }}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getAllByRole('option')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /确认进贡/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toEqual(c('A', 'spades'));
  });

  it('confirm button is disabled until a candidate is selected', () => {
    render(
      <TributeModal
        state={{
          kind: 'pending',
          loserHandle: '@饭团',
          winnerHandle: '@阿祥',
          hand: [c('A', 'spades')],
          candidateKeys: new Set([KEY(c('A', 'spades'))]),
          roundNumber: 6,
          countdownSeconds: 12,
        }}
      />
    );
    expect(screen.getByRole('button', { name: '确认进贡' })).toBeDisabled();
  });

  it('clicking selected card a second time deselects it', () => {
    const hand: Card[] = [c('A', 'spades')];
    const candidates = new Set([KEY(c('A', 'spades'))]);
    render(
      <TributeModal
        state={{
          kind: 'pending',
          loserHandle: '@饭团',
          winnerHandle: '@阿祥',
          hand,
          candidateKeys: candidates,
          roundNumber: 6,
          countdownSeconds: 12,
        }}
      />
    );
    const option = screen.getAllByRole('option')[0]!;
    fireEvent.click(option);
    expect(option).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(option);
    expect(option).toHaveAttribute('aria-selected', 'false');
  });
});

describe('TributeModal - anti-tribute state (S12)', () => {
  it('renders 抗贡 banner with holder name + countdown', () => {
    render(
      <TributeModal
        state={{
          kind: 'anti-tribute',
          holderHandle: '@饭团',
          roundNumber: 6,
          countdownSeconds: 2,
          nextLeaderHandle: '@饭团',
        }}
      />
    );
    expect(screen.getByRole('dialog', { name: '抗贡' })).toBeInTheDocument();
    expect(screen.getByText('抗 贡')).toBeInTheDocument();
    expect(screen.getByText(/2s 后开始下一局/)).toBeInTheDocument();
  });

  it('does NOT fire onDismiss on backdrop click (avoids accidental dispatch)', () => {
    // F-I3 fix: prior version had onClick on the backdrop, so a stray tap by
    // a winning-team player would POST anti_tribute (server rejected, user
    // confused). Backdrop is now informational-only.
    const onDismiss = vi.fn();
    render(
      <TributeModal
        state={{
          kind: 'anti-tribute',
          holderHandle: '@饭团',
          roundNumber: 6,
          canDeclare: true,
        }}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByRole('dialog', { name: '抗贡' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('fires onDismiss only via explicit 我们抗贡 button when canDeclare', () => {
    const onDismiss = vi.fn();
    render(
      <TributeModal
        state={{
          kind: 'anti-tribute',
          holderHandle: '@饭团',
          roundNumber: 6,
          canDeclare: true,
        }}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '我们抗贡' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('hides 我们抗贡 button when canDeclare is false / unset (winning team)', () => {
    render(
      <TributeModal
        state={{
          kind: 'anti-tribute',
          holderHandle: '@饭团',
          roundNumber: 6,
          // canDeclare not set → winning team or unknown → no CTA
        }}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: '我们抗贡' })).not.toBeInTheDocument();
  });
});

describe('TributeModal - return-pending state (S13)', () => {
  it('shows received card + ≤10 candidates', () => {
    const hand: Card[] = [c('4', 'spades'), c('J', 'clubs')];
    const candidates = new Set([KEY(c('4', 'spades'))]);
    render(
      <TributeModal
        state={{
          kind: 'return-pending',
          winnerHandle: '@阿祥',
          loserHandle: '@饭团',
          hand,
          candidateKeys: candidates,
          receivedCard: c('A', 'spades'),
          roundNumber: 6,
          countdownSeconds: 14,
        }}
      />
    );
    expect(screen.getByRole('dialog', { name: '还贡阶段' })).toBeInTheDocument();
    expect(screen.getByText('收到')).toBeInTheDocument();
    expect(screen.getByText('14s')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options[0]).not.toBeDisabled(); // 4♠
    expect(options[1]).toBeDisabled(); // J♣
  });

  it('confirm fires onConfirm', () => {
    const hand: Card[] = [c('4', 'spades')];
    const onConfirm = vi.fn();
    render(
      <TributeModal
        state={{
          kind: 'return-pending',
          winnerHandle: '@阿祥',
          loserHandle: '@饭团',
          hand,
          candidateKeys: new Set([KEY(c('4', 'spades'))]),
          receivedCard: c('A', 'spades'),
          roundNumber: 6,
          countdownSeconds: 14,
        }}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getAllByRole('option')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /确认还/ }));
    expect(onConfirm).toHaveBeenCalledWith(c('4', 'spades'));
  });
});
