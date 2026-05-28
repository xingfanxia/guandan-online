// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EndgameAssist } from '@/components/EndgameAssist';
import type { Card } from '@lib/game/cards';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

// A small, fully-clearable hand: pair of K + pair of 3 → two leads empty it.
const fourCard: Card[] = [
  c('spades', 'K'),
  c('clubs', 'K', 2),
  c('diamonds', '3'),
  c('spades', '3', 2),
];

describe('EndgameAssist', () => {
  it('renders nothing when disabled (default off)', () => {
    const { container } = render(<EndgameAssist cards={fourCard} levelRank="2" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the hand exceeds the threshold even if enabled', () => {
    const sevenCard: Card[] = [
      c('spades', '2'), c('clubs', '3'), c('diamonds', '4'),
      c('spades', '5'), c('clubs', '6'), c('diamonds', '8'), c('spades', '9'),
    ];
    const { container } = render(
      <EndgameAssist cards={sevenCard} levelRank="2" enabled />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the clearing line when enabled AND hand ≤ 6', () => {
    render(<EndgameAssist cards={fourCard} levelRank="2" enabled />);
    expect(screen.getByText('收官线')).toBeInTheDocument();
    // Greedy cheapest-non-bomb leads dump the two low 3s as singles first,
    // then the K-pair finishes: 单张 3 · 单张 3 · 一对 K. The meaningful
    // property is that the line accounts for all 4 cards.
    const steps = screen.getAllByRole('listitem');
    expect(steps.length).toBeGreaterThanOrEqual(2);
    const labels = steps.map((el) => el.textContent);
    // Final step clears the K-pair.
    expect(labels).toContain('一对 K');
    // Low 3s are dumped as the cheapest legal leads.
    expect(labels.filter((l) => l === '单张 3').length).toBe(2);
  });

  it('marks the line complete (no 需手动调整 note) when the hand fully clears', () => {
    render(<EndgameAssist cards={fourCard} levelRank="2" enabled />);
    expect(screen.queryByText('需手动调整')).not.toBeInTheDocument();
  });

  it('renders nothing for an empty hand even when enabled', () => {
    const { container } = render(<EndgameAssist cards={[]} levelRank="2" enabled />);
    expect(container.firstChild).toBeNull();
  });

  it('honors a custom threshold', () => {
    // threshold=3 means a 4-card hand is over the limit → nothing renders.
    const { container } = render(
      <EndgameAssist cards={fourCard} levelRank="2" enabled threshold={3} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('lists a single finisher step for a one-combo hand', () => {
    const pairK: Card[] = [c('spades', 'K'), c('clubs', 'K', 2)];
    render(<EndgameAssist cards={pairK} levelRank="2" enabled />);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(1);
    expect(steps[0]!).toHaveTextContent('一对 K');
  });
});
