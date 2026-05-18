// Avatar — player chip with optional active-pulse + team color.
//
// Team mapping follows tokens.css:
//   self → blue (team-self / info)
//   partner → blue lighter
//   rival-1 / rival-2 → red / amber
//   For 6/8P teams use 'team-A'..'team-D' variants (per CLAUDE.md memory:
//   avatar fill matches team-color ring exactly).

export type AvatarRole = 'self' | 'partner' | 'rival-1' | 'rival-2' | 'team-A' | 'team-B' | 'team-C' | 'team-D';
export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  /** Display handle (e.g. "@阿祥") — first 2 chars rendered as initials. */
  handle: string;
  role?: AvatarRole;
  size?: AvatarSize;
  /** Show pulse ring (it's their turn). */
  active?: boolean;
  /** Optional click (open profile, etc.). */
  onClick?: () => void;
  ariaLabel?: string;
}

/**
 * Take the first 2 visible chars from the handle, stripping a leading '@'.
 * For Chinese handles this picks the first 1-2 hanzi which is the canonical
 * convention. For Latin handles it picks 2 letters.
 */
function initials(handle: string): string {
  const stripped = handle.startsWith('@') ? handle.slice(1) : handle;
  // Array.from handles surrogate-pair safety for emoji/extended chars.
  const chars = Array.from(stripped).filter((c) => c.trim().length > 0);
  return chars.slice(0, 2).join('').toUpperCase();
}

export function Avatar({
  handle,
  role = 'self',
  size = 'md',
  active = false,
  onClick,
  ariaLabel,
}: AvatarProps): React.JSX.Element {
  const classes = ['avatar', `avatar--${size}`, `avatar--${role}`];
  if (active) classes.push('avatar--active');

  return (
    <div
      className={classes.join(' ')}
      onClick={onClick}
      role={onClick ? 'button' : 'img'}
      aria-label={ariaLabel ?? `${handle}${active ? ' — turn active' : ''}`}
      data-handle={handle}
    >
      {initials(handle)}
    </div>
  );
}
