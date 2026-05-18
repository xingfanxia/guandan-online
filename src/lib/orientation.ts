// Orientation detection + landscape locking.
//
// Strategy per docs/research/mobile-landscape-ux.md:
// 1. Desktop → effective='landscape', no action needed.
// 2. Mobile portrait → show rotate-prompt overlay (only universally reliable path on iOS Safari).
// 3. Mobile landscape (Android) → screen.orientation.lock('landscape') is optional bonus,
//    but requires fullscreen — gated behind explicit user gesture upstream.
//
// We intentionally do NOT use CSS transform: rotate(90deg) — touch coords + viewport
// units + virtual keyboard all break (see mobile-landscape-ux.md § 1.2).

import { useEffect, useState } from 'react';

export type OrientationState =
  | 'landscape'           // device is landscape — game shows normally
  | 'portrait-mobile'     // mobile in portrait — show rotate prompt
  | 'desktop';            // > 900px viewport, no orientation lock needed

const MOBILE_MAX_WIDTH = 900;

function detect(): OrientationState {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  const mobileWidth = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
  if (!mobileWidth) return 'desktop';
  return portrait ? 'portrait-mobile' : 'landscape';
}

/**
 * React hook that subscribes to orientationchange + resize and returns the
 * current logical orientation state. SSR-safe (returns 'desktop' on first
 * render server-side).
 */
export function useOrientation(): OrientationState {
  const [state, setState] = useState<OrientationState>(() => detect());

  useEffect(() => {
    const update = (): void => setState(detect());
    update();
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);
    const portraitMq = window.matchMedia('(orientation: portrait)');
    portraitMq.addEventListener('change', update);
    return () => {
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('resize', update);
      portraitMq.removeEventListener('change', update);
    };
  }, []);

  return state;
}

/**
 * Attempt to lock orientation to landscape. Requires the document to be in
 * fullscreen (browser security restriction). Returns true on success, false
 * if the API isn't available or the lock failed (including on iOS Safari,
 * which doesn't implement screen.orientation.lock at all).
 *
 * Call this inside a user-gesture event handler (button click) — the
 * fullscreen request itself requires user activation.
 */
export async function lockLandscape(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen();
    }
    type LockableScreen = Screen & { orientation?: { lock?: (t: string) => Promise<void> } };
    const lock = (window.screen as LockableScreen).orientation?.lock;
    if (!lock) return false;
    await lock.call((window.screen as LockableScreen).orientation, 'landscape');
    return true;
  } catch {
    return false;
  }
}
