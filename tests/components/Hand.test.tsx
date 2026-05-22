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

// ─── Round 2 MINOR-2 — roving tabindex ─────────────────────────────────────

describe('Hand — Round 2 MINOR-2: roving tabindex', () => {
  // Pre-fix: every card was a tab stop (27 stops for a 4P hand) — noisy.
  // Post-fix: only the focused card has tabIndex=0, rest have -1; arrow keys
  // move focus within the hand; Tab from a card exits to next focusable element.

  function clickable(cards: readonly GameCard[]): readonly GameCard[] {
    // onCardClick must be provided so Card renders a <button>; otherwise
    // we get <div>s with no tabIndex contract.
    return cards;
  }

  it('on mount, only the first card has tabIndex=0', () => {
    const { container } = render(
      <Hand cards={clickable(sample)} levelRank="2" onCardClick={() => undefined} />,
    );
    const buttons = container.querySelectorAll('button.card');
    expect(buttons.length).toBeGreaterThan(1);
    expect(buttons[0]!.getAttribute('tabindex')).toBe('0');
    for (let i = 1; i < buttons.length; i++) {
      expect(buttons[i]!.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('ArrowRight moves focus to next card and shifts tabIndex=0', () => {
    const { container } = render(
      <Hand cards={clickable(sample)} levelRank="2" onCardClick={() => undefined} />,
    );
    const buttons = container.querySelectorAll('button.card');
    const first = buttons[0]! as HTMLButtonElement;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });

    const updated = container.querySelectorAll('button.card');
    expect(updated[0]!.getAttribute('tabindex')).toBe('-1');
    expect(updated[1]!.getAttribute('tabindex')).toBe('0');
  });

  it('ArrowLeft from card 0 stays at 0 (clamped, no wrap)', () => {
    const { container } = render(
      <Hand cards={clickable(sample)} levelRank="2" onCardClick={() => undefined} />,
    );
    const buttons = container.querySelectorAll('button.card');
    const first = buttons[0]! as HTMLButtonElement;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowLeft' });

    const updated = container.querySelectorAll('button.card');
    expect(updated[0]!.getAttribute('tabindex')).toBe('0');
  });

  it('Tab from inside hand exits to next focusable element (only one card is a tab stop)', () => {
    // The contract for roving-tabindex: only ONE element in the group is a
    // tab stop. We assert this by counting tabindex="0" elements.
    const { container } = render(
      <Hand cards={clickable(sample)} levelRank="2" onCardClick={() => undefined} />,
    );
    const tabStops = container.querySelectorAll('button.card[tabindex="0"]');
    expect(tabStops.length).toBe(1);
  });
});
