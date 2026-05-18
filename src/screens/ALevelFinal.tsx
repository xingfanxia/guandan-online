// ALevelFinal — banner overlay for the A-level decisive round (demos S07).
//
// Rendered ABOVE the active GameTable when the game enters A-level. Wraps its
// children inside a tinted container so the background's color temperature
// shifts to warm-red, and pins a fixed banner at the top with the strict-mode
// rule reminder + A-fail counter.
//
// State (whoseAHead, failCount, strictMode) is fed via props; the move
// handler emits A-level transition events when applyRoundResult flips into
// A-level on the session.

import type { TeamKey } from '@lib/game/mode';

export interface ALevelFinalProps {
  /** Which team is at A (always at least one for this banner to render). */
  aTeam: TeamKey;
  /** Friendly label for the A team (e.g. "我方" / "队 A" / "@阿祥 + @泉酱"). */
  aTeamLabel: string;
  /** Strict A mode: must win at the A team's own A round. */
  strictMode: boolean;
  /** A-fail count and threshold (e.g. 0/3 in strict mode). */
  failCount: number;
  /** Cap on consecutive A-fails. */
  failCap: number;
  /** Whether it's the A team's OWN round (vs opponent A round). */
  isOwnRound: boolean;
  /** Children render inside the tinted container (typically GameTable*P). */
  children: React.ReactNode;
}

export function ALevelFinal({
  aTeamLabel,
  strictMode,
  failCount,
  failCap,
  isOwnRound,
  children,
}: ALevelFinalProps): React.JSX.Element {
  const titleSuffix = isOwnRound ? 'A 头 · 必须头游赢出' : '对方 A · 顶住';
  return (
    <div className="a-final">
      <div className="a-final-banner">
        <div className="a-final-banner__eyebrow">
          决胜局{strictMode ? ' · 严格 A 模式' : ' · 宽松 A 模式'}
        </div>
        <div className="a-final-banner__title">
          {aTeamLabel} <em>{titleSuffix}</em>
        </div>
        {strictMode ? (
          <div className="a-final-banner__counter">
            A 失利 {failCount}/{failCap}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
