// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExchangeSelectModal } from '@/screens/ExchangeSelectModal';
import type { Card as GameCard } from '@lib/game/cards';

const c = (suit: GameCard['suit'], rank: GameCard['rank'], deck: GameCard['deck'] = 1): GameCard => ({
  suit,
  rank,
  deck,
});

const HAND: GameCard[] = [
  c('spades', '3'),
  c('spades', '4'),
  c('spades', '5'),
  c('hearts', '6'),
  c('clubs', '7'),
];

describe('ExchangeSelectModal', () => {
  it('shows the direction and required count', () => {
    render(<ExchangeSelectModal hand={HAND} cardCount={2} direction="cw" onSelect={() => {}} />);
    expect(screen.getByRole('dialog', { name: '换牌 · 选牌' })).toBeInTheDocument();
    expect(screen.getAllByText(/顺时针/).length).toBeGreaterThan(0);
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });

  it('confirm is disabled until exactly cardCount are chosen, then fires onSelect', () => {
    const onSelect = vi.fn();
    render(<ExchangeSelectModal hand={HAND} cardCount={2} direction="cw" onSelect={onSelect} />);
    const confirm = screen.getByRole('button', { name: /确认/ });
    expect(confirm).toBeDisabled();

    const options = screen.getAllByRole('option');
    fireEvent.click(options[0]!);
    expect(confirm).toBeDisabled(); // 1/2
    fireEvent.click(options[1]!);
    expect(confirm).not.toBeDisabled(); // 2/2
    fireEvent.click(confirm);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toHaveLength(2);
  });

  it('caps selection at cardCount (extra cards blocked)', () => {
    render(<ExchangeSelectModal hand={HAND} cardCount={1} direction="ccw" onSelect={() => {}} />);
    const options = screen.getAllByRole('option');
    fireEvent.click(options[0]!);
    expect(screen.getByText('1/1')).toBeInTheDocument();
    // A second distinct card is blocked (disabled) once the cap is hit.
    expect(options[1]!).toBeDisabled();
  });
});
