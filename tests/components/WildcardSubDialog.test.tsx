// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  WildcardSubDialog,
  type WildcardCandidate,
} from '@/components/WildcardSubDialog';
import type { Card } from '@lib/game/cards';
import { analyzeHand } from '@lib/game/patterns';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

// Chosen combo: ♥7 (wildcard at level 7) + K + K.
// Candidate interpretations of the wildcard within these three cards.
const chosen: Card[] = [c('hearts', '7'), c('spades', 'K'), c('clubs', 'K', 2)];

function buildCandidates(): WildcardCandidate[] {
  // "三张 K" — wildcard plays as a third K (the plausible / declared reading).
  const tripleK = analyzeHand(chosen, '7')!;
  // A contrived alternative reading for the dialog list (a triple-7-as-pair is
  // not a real second interpretation of these exact cards, so we synthesize a
  // distinct Pattern object just to exercise multi-candidate rendering).
  const altPair: WildcardCandidate = {
    id: 'pair-K',
    pattern: { kind: 'pair', rank: 'K', length: 2, cards: [chosen[1]!, chosen[2]!] },
  };
  return [
    { id: 'triple-K', pattern: tripleK },
    altPair,
  ];
}

describe('WildcardSubDialog', () => {
  it('renders as a modal dialog with the prompt', () => {
    render(
      <WildcardSubDialog
        cards={chosen}
        candidates={buildCandidates()}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole('dialog', { name: '红心通配 — 选择代表' })).toBeInTheDocument();
    expect(screen.getByText('红心通配确认')).toBeInTheDocument();
  });

  it('defaults the selection to the most plausible (defaultIndex) candidate', () => {
    render(
      <WildcardSubDialog
        cards={chosen}
        candidates={buildCandidates()}
        defaultIndex={0}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios[0]!).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]!).toHaveAttribute('aria-checked', 'false');
    // The default candidate carries the 推荐 badge.
    expect(screen.getByText('推荐')).toBeInTheDocument();
  });

  it('surfaces all candidate interpretations as radio options', () => {
    render(
      <WildcardSubDialog
        cards={chosen}
        candidates={buildCandidates()}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    // Labels come from patternLabel: "三张 K" + "一对 K".
    expect(screen.getByText('三张 K')).toBeInTheDocument();
    expect(screen.getByText('一对 K')).toBeInTheDocument();
  });

  it('confirms with the DEFAULT candidate when confirmed without changing selection', () => {
    const onConfirm = vi.fn();
    render(
      <WildcardSubDialog
        cards={chosen}
        candidates={buildCandidates()}
        defaultIndex={0}
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /确认/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0].id).toBe('triple-K');
  });

  it('confirms with the candidate the user picks', () => {
    const onConfirm = vi.fn();
    render(
      <WildcardSubDialog
        cards={chosen}
        candidates={buildCandidates()}
        defaultIndex={0}
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    );
    // Click the second candidate, then confirm.
    fireEvent.click(screen.getByText('一对 K'));
    fireEvent.click(screen.getByRole('button', { name: /确认/ }));
    expect(onConfirm.mock.calls[0]![0].id).toBe('pair-K');
  });

  it('fires onCancel from the 取消 button and on Escape', () => {
    const onCancel = vi.fn();
    render(
      <WildcardSubDialog
        cards={chosen}
        candidates={buildCandidates()}
        onConfirm={() => undefined}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('clamps an out-of-range defaultIndex to 0', () => {
    render(
      <WildcardSubDialog
        cards={chosen}
        candidates={buildCandidates()}
        defaultIndex={99}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios[0]!).toHaveAttribute('aria-checked', 'true');
  });

  it('shows a fallback and disables confirm when there are no candidates', () => {
    render(
      <WildcardSubDialog
        cards={chosen}
        candidates={[]}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByText('无可用解释')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确认/ })).toBeDisabled();
  });
});
