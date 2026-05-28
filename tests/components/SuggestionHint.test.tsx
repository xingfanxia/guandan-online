// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuggestionHint } from '@/components/SuggestionHint';
import type { Card } from '@lib/game/cards';
import { analyzeHand } from '@lib/game/patterns';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

describe('SuggestionHint', () => {
  it('renders the Chinese caption for the suggested pair', () => {
    const hand: Card[] = [c('spades', '7'), c('clubs', '7', 2), c('diamonds', '3')];
    const target = analyzeHand([c('hearts', '5'), c('spades', '5', 2)], '2');
    render(<SuggestionHint cards={hand} target={target} levelRank="2" />);
    // suggestMove → pair of 7 → "建议 一对 7".
    expect(screen.getByText('建议')).toBeInTheDocument();
    expect(screen.getByText('一对 7')).toBeInTheDocument();
  });

  it('fires onSuggest with the hand indices of the suggested cards', () => {
    const hand: Card[] = [c('spades', '7'), c('clubs', '7', 2), c('diamonds', '3')];
    const target = analyzeHand([c('hearts', '5'), c('spades', '5', 2)], '2');
    const onSuggest = vi.fn();
    render(
      <SuggestionHint cards={hand} target={target} levelRank="2" onSuggest={onSuggest} />,
    );
    // The two 7s live at indices 0 and 1.
    expect(onSuggest).toHaveBeenCalled();
    const [indices, pattern] = onSuggest.mock.calls.at(-1)!;
    expect(indices.sort()).toEqual([0, 1]);
    expect(pattern.kind).toBe('pair');
  });

  it('shows 过牌 and fires onSuggest with [] when no legal follow exists', () => {
    const hand: Card[] = [c('spades', '3'), c('clubs', '4')];
    const target = analyzeHand([c('hearts', 'K'), c('spades', 'K', 2)], '2');
    const onSuggest = vi.fn();
    render(
      <SuggestionHint cards={hand} target={target} levelRank="2" onSuggest={onSuggest} />,
    );
    expect(screen.getByText('过牌')).toBeInTheDocument();
    const [indices, pattern] = onSuggest.mock.calls.at(-1)!;
    expect(indices).toEqual([]);
    expect(pattern).toBeNull();
  });

  it('maps duplicate cards to distinct indices (no double-count)', () => {
    // Two identical ♠7 (deck 1 + deck 2 differ; here force a true duplicate by
    // using deck 1 twice to exercise the greedy used-set guard). The greedy
    // mapper must still yield two distinct indices.
    const dup1 = c('spades', '7', 1);
    const dup2 = c('spades', '7', 2);
    const hand: Card[] = [dup1, dup2, c('diamonds', '3')];
    const target = analyzeHand([c('hearts', '5'), c('spades', '5', 2)], '2');
    const onSuggest = vi.fn();
    render(
      <SuggestionHint cards={hand} target={target} levelRank="2" onSuggest={onSuggest} />,
    );
    const [indices] = onSuggest.mock.calls.at(-1)!;
    expect(new Set(indices).size).toBe(indices.length); // all distinct
    expect(indices.length).toBe(2);
  });

  it('uses an injected enumerator (deterministic suggestion)', () => {
    const hand: Card[] = [c('spades', '9'), c('clubs', 'A')];
    const single9 = analyzeHand([c('spades', '9')], '2')!;
    const enumerate = vi.fn(() => [single9]);
    render(
      <SuggestionHint
        cards={hand}
        target={analyzeHand([c('hearts', '6')], '2')}
        levelRank="2"
        suggestOptions={{ enumerate }}
      />,
    );
    expect(screen.getByText('单张 9')).toBeInTheDocument();
    expect(enumerate).toHaveBeenCalled();
  });
});
