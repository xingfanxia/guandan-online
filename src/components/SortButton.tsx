// SortButton — "理牌" control. Sorts the hand into combo clusters and fires
// onSort with the reordered card array.
//
// Pure presentational + a single click handler. The actual sort lives in
// src/lib/assist/sort.ts (sortAndGroup); this component just wires the button
// to it and hands the reordered array back to the parent (which owns hand
// state). Matches the existing `btn btn--ghost` styling used by the in-table
// 理牌 button in GameTable4P.

import type { Card } from '@lib/game/cards';
import type { LevelRank } from '@lib/game/levels';
import { sortAndGroup, type SortResult } from '@/lib/assist/sort';

export interface SortButtonProps {
  /** Current hand to sort. */
  cards: readonly Card[];
  /** Level rank — drives wildcard + power ordering. */
  levelRank: LevelRank;
  /**
   * Called with the reordered cards (and the full SortResult, so the parent
   * can also use the cluster grouping for display if desired).
   */
  onSort: (sorted: readonly Card[], result: SortResult) => void;
  /** Button label override. Defaults to "理牌". */
  label?: string;
  /** Optional className passthrough; defaults to the ghost-button styling. */
  className?: string;
  disabled?: boolean;
}

export function SortButton({
  cards,
  levelRank,
  onSort,
  label = '理牌',
  className = 'btn btn--ghost',
  disabled = false,
}: SortButtonProps): React.JSX.Element {
  function handleClick(): void {
    const result = sortAndGroup(cards, levelRank);
    onSort(result.sorted, result);
  }

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={disabled || cards.length === 0}
      aria-label="理牌"
    >
      {label}
    </button>
  );
}
