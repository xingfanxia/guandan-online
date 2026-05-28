// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortButton } from '@/components/SortButton';
import type { Card } from '@lib/game/cards';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

const unsorted: Card[] = [
  c('spades', '3'),
  c('joker', 'RJ'),
  c('clubs', 'A'),
];

describe('SortButton', () => {
  it('renders the default 理牌 label', () => {
    render(<SortButton cards={unsorted} levelRank="2" onSort={() => undefined} />);
    expect(screen.getByRole('button', { name: '理牌' })).toBeInTheDocument();
  });

  it('fires onSort with the reordered (descending-power) cards on click', () => {
    const onSort = vi.fn();
    render(<SortButton cards={unsorted} levelRank="2" onSort={onSort} />);
    fireEvent.click(screen.getByRole('button', { name: '理牌' }));
    expect(onSort).toHaveBeenCalledTimes(1);
    const [sorted, result] = onSort.mock.calls[0]!;
    // RJ (16) > A (13) > 3 (2).
    expect(sorted.map((x: Card) => x.rank)).toEqual(['RJ', 'A', '3']);
    // Second arg carries the cluster grouping.
    expect(result.clusters.map((g: { rank: string }) => g.rank)).toEqual(['RJ', 'A', '3']);
  });

  it('is disabled for an empty hand', () => {
    render(<SortButton cards={[]} levelRank="2" onSort={() => undefined} />);
    expect(screen.getByRole('button', { name: '理牌' })).toBeDisabled();
  });

  it('honors a custom label and disabled prop', () => {
    render(
      <SortButton cards={unsorted} levelRank="2" onSort={() => undefined} label="整理" disabled />,
    );
    const btn = screen.getByRole('button', { name: '理牌' });
    expect(btn).toHaveTextContent('整理');
    expect(btn).toBeDisabled();
  });

  it('does not fire onSort when disabled', () => {
    const onSort = vi.fn();
    render(<SortButton cards={unsorted} levelRank="2" onSort={onSort} disabled />);
    fireEvent.click(screen.getByRole('button', { name: '理牌' }));
    expect(onSort).not.toHaveBeenCalled();
  });
});
