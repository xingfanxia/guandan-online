// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Hand } from '@/components/Hand';
import type { Card as GameCard } from '@lib/game/cards';

const sample: GameCard[] = [
  { suit: 'hearts', rank: '5', deck: 1 },
  { suit: 'hearts', rank: '7', deck: 1 }, // wildcard when level=7
  { suit: 'spades', rank: 'K', deck: 1 },
  { suit: 'diamonds', rank: '10', deck: 2 },
];

describe('Hand', () => {
  it('renders one .card child per input card', () => {
    const { container } = render(<Hand cards={sample} levelRank="2" />);
    expect(container.querySelectorAll('.card')).toHaveLength(sample.length);
  });

  it('marks hearts-of-current-level as wildcard', () => {
    const { container } = render(<Hand cards={sample} levelRank="7" />);
    const wilds = container.querySelectorAll('.card--wild');
    expect(wilds).toHaveLength(1);
    expect(wilds[0]?.getAttribute('data-rank')).toBe('7');
    expect(wilds[0]?.getAttribute('data-suit')).toBe('hearts');
  });

  it('does NOT mark wildcard when faceDown is true', () => {
    const { container } = render(<Hand cards={sample} levelRank="7" faceDown />);
    expect(container.querySelectorAll('.card--wild')).toHaveLength(0);
    expect(container.querySelectorAll('.card--back')).toHaveLength(sample.length);
  });

  it('lifts cards whose index is in liftedIndices', () => {
    const lifted = new Set([0, 2]);
    const { container } = render(<Hand cards={sample} levelRank="2" liftedIndices={lifted} />);
    const liftedEls = container.querySelectorAll('.card--lifted');
    expect(liftedEls).toHaveLength(2);
  });

  it('invokes onCardClick with index + card on tap', () => {
    const handler = vi.fn();
    const { container } = render(<Hand cards={sample} levelRank="2" onCardClick={handler} />);
    const cards = container.querySelectorAll('.card');
    fireEvent.click(cards[1]!);
    expect(handler).toHaveBeenCalledWith(1, sample[1]);
  });

  it('uses size prop for child cards', () => {
    const { container } = render(<Hand cards={sample} levelRank="2" size="md" />);
    expect(container.querySelectorAll('.card--md')).toHaveLength(sample.length);
  });

  it('passes ariaLabel through to container', () => {
    render(<Hand cards={sample} levelRank="2" ariaLabel="my-hand" />);
    expect(screen.getByLabelText('my-hand')).toBeInTheDocument();
  });

  it('handles 27-card 4P deal (max for landscape width)', () => {
    const big: GameCard[] = Array.from({ length: 27 }, (_, i) => ({
      suit: 'spades' as const,
      rank: '2' as const,
      deck: ((i % 2) + 1) as 1 | 2,
    }));
    const { container } = render(<Hand cards={big} levelRank="2" />);
    expect(container.querySelectorAll('.card')).toHaveLength(27);
  });
});
