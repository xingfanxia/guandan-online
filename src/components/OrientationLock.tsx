// OrientationLock — wraps the game shell, swaps in RotatePrompt when needed.
//
// Strategy: on mobile portrait, render RotatePrompt only. Desktop + mobile
// landscape render children unchanged. This is intentionally NOT a CSS
// transform rotate — see docs/research/mobile-landscape-ux.md § 1.2 for why.

import { useOrientation, type OrientationState } from '@/lib/orientation';
import { RotatePrompt } from '@/screens/RotatePrompt';

export interface OrientationLockProps {
  children: React.ReactNode;
  /** Override the orientation state — primarily for tests. */
  overrideOrientation?: OrientationState;
}

export function OrientationLock({
  children,
  overrideOrientation,
}: OrientationLockProps): React.JSX.Element {
  const detected = useOrientation();
  const state = overrideOrientation ?? detected;

  if (state === 'portrait-mobile') {
    return <RotatePrompt />;
  }

  return <>{children}</>;
}
