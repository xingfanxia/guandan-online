// RotatePrompt — fullscreen overlay shown when mobile device is held portrait.
//
// Per docs/research/mobile-landscape-ux.md § 1.4, this is the PRIMARY UI on
// iOS Safari (where programmatic landscape lock is unavailable), NOT a
// last-resort fallback. The overlay must hide the game completely so the
// player understands rotation is required.

import { lockLandscape } from '@/lib/orientation';

export interface RotatePromptProps {
  /** Optional CTA to attempt fullscreen + orientation lock (Android Chrome path). */
  onLockAttempt?: () => void;
}

export function RotatePrompt({ onLockAttempt }: RotatePromptProps): React.JSX.Element {
  const handleLock = async (): Promise<void> => {
    const ok = await lockLandscape();
    if (ok && onLockAttempt) onLockAttempt();
  };

  return (
    <div
      className="rotate-prompt"
      role="alertdialog"
      aria-label="rotate device prompt"
      aria-live="polite"
    >
      <div className="rotate-prompt__icon" aria-hidden="true">↻</div>
      <h1 className="rotate-prompt__title">请横屏游戏</h1>
      <p className="rotate-prompt__sub">Please rotate your device to landscape</p>
      <button
        type="button"
        className="btn btn--accent-soft rotate-prompt__btn"
        onClick={handleLock}
      >
        尝试全屏锁定 · Lock landscape (Android)
      </button>
    </div>
  );
}
