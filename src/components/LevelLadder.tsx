// LevelLadder — 13-rung 2→A level visualizer.
//
// Used by RoundEnd to show the upgrade animation (was=blue / passed=dim / now=red glow)
// and by Victory to display the final level both teams ended on.
//
// Props are pure: `was` is the starting level, `now` is the ending level. The
// component computes `passed` automatically as everything in (was, now).
// Levels are ordered per the Guandan rules: 2 → 3 → ... → 10 → J → Q → K → A.

import type { LevelRank } from '@lib/game/levels';

const LEVELS: readonly LevelRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export interface LevelLadderProps {
  /** Starting level (before round). Highlighted "was". */
  was: LevelRank;
  /** Current level (after upgrade). Highlighted "now". */
  now: LevelRank;
  /** Optional aria label override. */
  ariaLabel?: string;
}

export function LevelLadder({ was, now, ariaLabel }: LevelLadderProps): React.JSX.Element {
  const wasIndex = LEVELS.indexOf(was);
  const nowIndex = LEVELS.indexOf(now);
  // Clamp to handle bad input gracefully (renders without highlighting).
  const lo = Math.min(wasIndex, nowIndex);
  const hi = Math.max(wasIndex, nowIndex);

  return (
    <div
      className="ladder"
      role="img"
      aria-label={ariaLabel ?? `level upgrade from ${was} to ${now}`}
    >
      {LEVELS.map((lvl, i) => {
        // Order matters: `now` wins ties so when was===now the team's current
        // level renders in the red highlight (visually "where they are now").
        let cls = 'ladder__rung';
        if (i === nowIndex) cls += ' ladder__rung--now';
        else if (i === wasIndex) cls += ' ladder__rung--was';
        else if (i > lo && i < hi) cls += ' ladder__rung--passed';
        return (
          <div key={lvl} className={cls} data-level={lvl}>
            {lvl}
          </div>
        );
      })}
    </div>
  );
}
