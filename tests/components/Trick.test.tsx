// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Trick } from '@/components/Trick';
import type { Card as GameCard } from '@lib/game/cards';

const pair: GameCard[] = [
  { suit: 'hearts', rank: 'K', deck: 1 },
  { suit: 'spades', rank: 'K', deck: 2 },
];

describe('Trick', () => {
  it('renders trick--empty when no cards yet', () => {
    const { container } = render(<Trick cards={[]} levelRank="2" />);
    expect(container.querySelector('.trick--empty')).toBeInTheDocument();
    expect(container.querySelectorAll('.card')).toHaveLength(0);
  });

  it('renders played stack with cards', () => {
    const { container } = render(<Trick cards={pair} levelRank="2" patternLabel="对子" authorHandle="@阿祥" />);
    expect(container.querySelectorAll('.played-stack .card')).toHaveLength(2);
    expect(screen.getByText('对子')).toBeInTheDocument();
    expect(screen.getByText('@阿祥')).toBeInTheDocument();
  });

  it('omits meta block when neither authorHandle nor patternLabel is given', () => {
    const { container } = render(<Trick cards={pair} levelRank="2" />);
    expect(container.querySelector('.trick__meta')).toBeNull();
  });

  it('uses md size by default', () => {
    const { container } = render(<Trick cards={pair} levelRank="2" />);
    expect(container.querySelectorAll('.card--md')).toHaveLength(2);
  });
});
