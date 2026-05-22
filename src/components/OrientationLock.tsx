// OrientationLock — wraps the game shell, forces landscape via CSS rotate
// when the device is held portrait.
//
// Strategy per docs/research/mobile-landscape-ux.md § Update 2026-05-16:
//   - Desktop / landscape → render children as-is.
//   - Portrait mobile → wrap children in a `.orientation-rotate-active`
//     container that's rotated 90° via CSS, sized to match the swapped
//     viewport dimensions so the rotated content fills the screen.
//   - Inside that wrapper, the CSS custom property `--vp-h` is overridden
//     to `100%` so child styles that read `var(--vp-h, 100dvh)` get the
//     wrapper's logical height instead of the un-rotated viewport's
//     dynamic height (which would overflow).
//   - When a text input takes focus, render children WITHOUT the rotate
//     transform (a `.orientation-rotate-bypass` wrapper) so the IME aligns
//     with the input. We must keep the input mounted — unmounting it closes
//     the keyboard immediately on iOS. The user sees the form in portrait
//     while typing; once focus leaves the input the rotate wrapper returns.
//
// `RotatePrompt` (src/screens/RotatePrompt.tsx) is no longer used in the
// happy path — modern iOS Safari (16+) and Chrome (90+) correctly translate
// pointer events through CSS transform, so the touch-coordinate trap from
// the original § 1.2 analysis no longer applies for our static-layout DOM-
// based card game. The component is retained for an emergency fallback we
// can wire if a specific device exhibits a rotate bug in the field. See
// research doc Update §.

import { useEffect, useState } from 'react';
import { useOrientation, type OrientationState } from '@/lib/orientation';

export interface OrientationLockProps {
  children: React.ReactNode;
  /** Override the orientation state — primarily for tests. */
  overrideOrientation?: OrientationState;
  /** Override input-focused state — primarily for tests. */
  overrideInputFocused?: boolean;
}

function isTextInputElement(el: EventTarget | null): boolean {
  if (!el) return false;
  if (typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement) {
    // Buttons and checkboxes don't open an IME; only text-like inputs do.
    const t = el.type.toLowerCase();
    return (
      t === 'text' ||
      t === 'search' ||
      t === 'tel' ||
      t === 'url' ||
      t === 'email' ||
      t === 'password' ||
      t === 'number'
    );
  }
  if (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) {
    return true;
  }
  if (
    typeof HTMLElement !== 'undefined' &&
    el instanceof HTMLElement &&
    el.isContentEditable
  ) {
    return true;
  }
  return false;
}

export function OrientationLock({
  children,
  overrideOrientation,
  overrideInputFocused,
}: OrientationLockProps): React.JSX.Element {
  const detected = useOrientation();
  const state = overrideOrientation ?? detected;

  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    if (state !== 'portrait-mobile' || overrideInputFocused !== undefined) return;
    if (typeof document === 'undefined') return;
    const onFocusIn = (e: FocusEvent): void => {
      if (isTextInputElement(e.target)) setInputFocused(true);
    };
    const onFocusOut = (e: FocusEvent): void => {
      if (isTextInputElement(e.target)) setInputFocused(false);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [state, overrideInputFocused]);

  const effectiveInputFocused = overrideInputFocused ?? inputFocused;

  if (state === 'portrait-mobile' && effectiveInputFocused) {
    // Text input is open — render children WITHOUT the rotate transform so
    // the IME aligns with the input. The user sees the form in portrait
    // orientation while typing; once focus leaves the input the rotate
    // wrapper returns. We must NOT unmount the input (that closes the
    // keyboard immediately), so we render children at the top level with
    // a flag class for styling. (RotatePrompt is reserved for the deeper
    // emergency case where rotate can't be applied at all.)
    return (
      <div className="orientation-rotate-bypass" data-testid="orientation-rotate-bypass">
        {children}
      </div>
    );
  }

  if (state === 'portrait-mobile') {
    return (
      <div className="orientation-rotate-active" data-testid="orientation-rotate-wrapper">
        {children}
      </div>
    );
  }

  return <>{children}</>;
}
