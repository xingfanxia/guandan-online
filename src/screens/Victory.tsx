// Victory — game-end celebration screen.
//
// Shown when the session transitions to phase=finished. Surfaces the winning
// team (with their roster + final level), an optional MVP highlight, and
// share/replay actions. Auto-redirect is the caller's responsibility (room is
// already TTL'd; viewers can dismiss back to landing).
//
// Visual: gold-tinted radial-gradient backdrop + large "胜" rune + winning
// team's avatars stacked horizontally. No demos S-number — extrapolated from
// the design system + plan-spec.

import type { LevelRank } from '@lib/game/levels';
import type { TeamKey } from '@lib/game/mode';

export interface VictoryRosterMember {
  readonly handle: string;
  readonly avatarClass?: string;
  readonly seatLabel?: string;
}

export interface VictoryProps {
  /** Winning team key. */
  winningTeam: TeamKey;
  /** Winning team friendly label (e.g. "我方"). */
  winningTeamLabel: string;
  /** Winning team's roster (2 for 4P, 3 for 6P, 4 for 8P). */
  winningRoster: readonly VictoryRosterMember[];
  /** Final level the winning team reached. */
  finalLevel: LevelRank;
  /** Game duration (e.g. "47:18"). */
  duration?: string;
  /** Number of rounds played. */
  roundCount: number;
  /** Optional MVP — player whose contribution stood out (often last-call winner). */
  mvpHandle?: string;
  /** Return to landing handler. */
  onReturn?: () => void;
  /** Share game handler. */
  onShare?: () => void;
}

export function Victory(props: VictoryProps): React.JSX.Element {
  return (
    <div className="victory" role="dialog" aria-modal="true" aria-label="游戏结束">
      <div className="victory__card">
        <div className="victory__eyebrow">
          {props.duration ?? ''} · {props.roundCount} 局
        </div>
        <div className="victory__rune">胜</div>
        <div className="victory__sub">
          <em>{props.winningTeamLabel}</em> 通关 · 终级 {props.finalLevel}
        </div>
        <div className="victory__roster">
          {props.winningRoster.map((m) => (
            <div key={m.handle} className="victory__roster-item">
              <div
                className={`avatar avatar--lg ${m.avatarClass ?? 'avatar--self'}`}
                aria-label={m.handle}
              >
                {m.handle.replace(/^@/, '').slice(0, 2).toUpperCase()}
              </div>
              <span>{m.handle}</span>
              {m.seatLabel ? (
                <span style={{ color: 'var(--ink-3)' }}>{m.seatLabel}</span>
              ) : null}
            </div>
          ))}
        </div>
        {props.mvpHandle ? (
          <div className="end-detail" style={{ width: '100%', maxWidth: 420 }}>
            <div>
              <div className="end-detail__key">MVP</div>
              <div className="end-detail__val">
                <em>{props.mvpHandle}</em>
              </div>
            </div>
            <div>
              <div className="end-detail__key">最终</div>
              <div className="end-detail__val">通 A</div>
            </div>
          </div>
        ) : null}
        <div className="victory__actions">
          {props.onShare ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={props.onShare}
            >
              分享战报
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={props.onReturn}
          >
            返回首页 →
          </button>
        </div>
      </div>
    </div>
  );
}
