// TurnCountdown — seconds remaining until the wire turnDeadline.
//
// The deadline is enforced server-side by the turn-timeout sweep
// (lib/api/turnTimeout.ts): past it, the server plays a forced move for the
// stalled player (easy strategy) on the next cron tick. The countdown is
// therefore honest — hitting 0 means "the system may move for you any
// moment", which the expired label says outright.

import { useEffect, useState } from 'react';

export interface TurnCountdownProps {
  /** ISO deadline from move_played / move_passed / snapshot. */
  deadline: string | null;
  /** Render (and tick) only when it's the local player's turn. */
  active: boolean;
}

export function TurnCountdown({ deadline, active }: TurnCountdownProps): React.JSX.Element | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline || !active) return undefined;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline, active]);

  if (!deadline || !active) return null;
  const parsed = Date.parse(deadline);
  if (!Number.isFinite(parsed)) return null;
  const remaining = Math.ceil((parsed - nowMs) / 1000);

  if (remaining <= 0) {
    return <span className="turn-countdown turn-countdown--expired">超时 · 系统将代出</span>;
  }
  return (
    <span
      className={
        remaining <= 10 ? 'turn-countdown turn-countdown--low tnum' : 'turn-countdown tnum'
      }
    >
      {remaining}s
    </span>
  );
}
