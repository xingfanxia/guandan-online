// ReportButton — in-game "举报" button + reason-picker modal. (SEC-3)
//
// Rendered next to an opponent at the table. Tapping opens a modal where the
// reporter picks a reason (作弊 / 辱骂 / 挂机 / 其他) and confirms. On confirm
// the component calls `onSubmit({ targetHandle, gameId, reason })` — the parent
// wires this to the /api/report client call (dependency-injected so tests
// don't hit the network).
//
// Mirrors the modal-backdrop / radiogroup / btn styling used by
// WildcardSubDialog + TributeModal. Accessible: role="dialog" + aria-modal,
// radiogroup for the reasons, Escape closes.

import { useEffect, useState } from 'react';
import type { ReportReason } from '@lib/security/reports';

export interface ReportSubmission {
  readonly targetHandle: string;
  readonly gameId: string;
  readonly reason: ReportReason;
}

export interface ReportButtonProps {
  /** Handle of the player being reported. */
  targetHandle: string;
  /** Current game / session id, for dedupe on the server. */
  gameId: string;
  /**
   * Fired when the reporter confirms. Returns a promise so the button can
   * show a pending state and surface failures. Injected by the parent (wires
   * to the /api/report client call).
   */
  onSubmit: (submission: ReportSubmission) => Promise<void>;
  /** Optional label override; defaults to "举报". */
  label?: string;
  /** Disable the trigger (e.g. already reported this player this game). */
  disabled?: boolean;
}

const REASON_LABELS: ReadonlyArray<{ reason: ReportReason; label: string }> = [
  { reason: 'cheating', label: '作弊 / 开挂' },
  { reason: 'abuse', label: '辱骂 / 不当言论' },
  { reason: 'afk', label: '挂机 / 消极游戏' },
  { reason: 'other', label: '其他' },
];

type Status = 'idle' | 'sending' | 'done' | 'error';

export function ReportButton({
  targetHandle,
  gameId,
  onSubmit,
  label = '举报',
  disabled = false,
}: ReportButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('cheating');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Escape closes the modal (only while not mid-send).
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && status !== 'sending') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, status]);

  function openModal(): void {
    setReason('cheating');
    setStatus('idle');
    setErrorMsg(null);
    setOpen(true);
  }

  function close(): void {
    setOpen(false);
  }

  async function confirm(): Promise<void> {
    setStatus('sending');
    setErrorMsg(null);
    try {
      await onSubmit({ targetHandle, gameId, reason });
      setStatus('done');
      // Brief success state, then close.
      window.setTimeout(close, 900);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : '举报失败 — 请重试');
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--ghost btn--sm report-button"
        onClick={openModal}
        disabled={disabled}
        aria-label={`举报 ${targetHandle}`}
      >
        {label}
      </button>

      {open ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`举报 ${targetHandle}`}
        >
          <div className="modal report-modal">
            <h2 className="modal__title">举报 {targetHandle}</h2>
            <p className="modal__label">选择举报原因，我们会复核这局对战记录。</p>

            <div className="report-modal__reasons" role="radiogroup" aria-label="举报原因">
              {REASON_LABELS.map(({ reason: r, label: rl }) => {
                const active = r === reason;
                return (
                  <button
                    key={r}
                    type="button"
                    className={`report-modal__reason ${active ? 'report-modal__reason--active' : ''}`}
                    role="radio"
                    aria-checked={active}
                    disabled={status === 'sending'}
                    onClick={() => setReason(r)}
                  >
                    {rl}
                  </button>
                );
              })}
            </div>

            {status === 'done' ? (
              <p className="modal__label report-modal__ok">已提交，感谢反馈</p>
            ) : null}
            {status === 'error' && errorMsg ? (
              <p className="modal__error">{errorMsg}</p>
            ) : null}

            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={close}
                disabled={status === 'sending'}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={confirm}
                disabled={status === 'sending' || status === 'done'}
              >
                {status === 'sending' ? '提交中…' : '提交举报'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
