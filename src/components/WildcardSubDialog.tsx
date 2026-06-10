// WildcardSubDialog — wildcard substitution confirm (红心通配).
//
// Shown when the player's chosen combo includes a 红心级牌 (wildcard). The
// dialog previews how the play WILL BE RULED and asks for confirm/cancel.
//
// Why there is intentionally NO multi-interpretation picker: the wire
// (PlayCommand) carries card ids only — the SERVER derives the pattern via
// the same analyzeHand the client runs (maximal reading per the F13 fix), so
// the client's single candidate IS the binding ruling. Offering a choice
// here would be fake UX: selecting a different reading could not change
// what the table counts. If a declared-interpretation field is ever added
// to the wire, this dialog's candidates[] prop already supports listing
// real alternatives.
//
// Props are fully controlled from the parent: the chosen cards, the candidate
// interpretations (each a Pattern over the same cards with a different wildcard
// assignment), the index of the default (most-plausible) candidate, and the
// confirm/cancel callbacks. The dialog owns only the local "which candidate is
// highlighted" selection state.
//
// Matches the modal-backdrop / btn styling used by Landing's SignInModal and
// TributeModal. Accessible: role="dialog" + aria-modal, radiogroup for the
// candidate list, Escape cancels.

import { useEffect, useState } from 'react';
import type { Card } from '@lib/game/cards';
import type { Pattern } from '@lib/game/patterns';
import { patternLabel, cardLabel } from '@/lib/assist/patternLabel';

export interface WildcardCandidate {
  /** Stable id (e.g. `${rank}-${kind}`) for the radio control. */
  readonly id: string;
  /** The resulting pattern under this wildcard assignment. */
  readonly pattern: Pattern;
}

export interface WildcardSubDialogProps {
  /** The cards the player selected (including the wildcard(s)). */
  cards: readonly Card[];
  /** Candidate interpretations of the wildcard within these cards. */
  candidates: readonly WildcardCandidate[];
  /**
   * Index into `candidates` of the most plausible interpretation. The dialog
   * defaults its selection here. Defaults to 0 when omitted / out of range.
   */
  defaultIndex?: number;
  /** Confirm with the chosen candidate. */
  onConfirm: (candidate: WildcardCandidate) => void;
  /** Cancel — close without committing. */
  onCancel: () => void;
}

export function WildcardSubDialog({
  cards,
  candidates,
  defaultIndex = 0,
  onConfirm,
  onCancel,
}: WildcardSubDialogProps): React.JSX.Element {
  const safeDefault =
    defaultIndex >= 0 && defaultIndex < candidates.length ? defaultIndex : 0;
  const [selected, setSelected] = useState(safeDefault);

  // Escape cancels — standard modal affordance.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const chosen = candidates[selected];

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="红心通配 — 选择代表"
    >
      <div className="modal wildcard-sub">
        <h2 className="modal__title">红心通配确认</h2>
        <p className="modal__label">
          这手牌含红心通配，将按以下组合结算（与服务器判定一致）
        </p>

        <div className="wildcard-sub__cards" aria-hidden="true">
          {cards.map((c, i) => (
            <span
              key={`${c.rank}-${c.suit}-${c.deck}-${i}`}
              className="wildcard-sub__chip"
            >
              {cardLabel(c)}
            </span>
          ))}
        </div>

        {candidates.length === 0 ? (
          <p className="modal__error">无可用解释</p>
        ) : (
          <div
            className="wildcard-sub__options"
            role="radiogroup"
            aria-label="通配解释候选"
          >
            {candidates.map((cand, idx) => {
              const active = idx === selected;
              return (
                <button
                  key={cand.id}
                  type="button"
                  className={`wildcard-sub__option ${active ? 'wildcard-sub__option--active' : ''}`}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelected(idx)}
                >
                  <span className="wildcard-sub__option-label">
                    {patternLabel(cand.pattern)}
                  </span>
                  {idx === safeDefault ? (
                    <span className="wildcard-sub__badge">推荐</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!chosen}
            onClick={() => {
              if (chosen) onConfirm(chosen);
            }}
          >
            {chosen ? `确认 ${patternLabel(chosen.pattern)} →` : '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
