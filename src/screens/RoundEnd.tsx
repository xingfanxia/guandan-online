// RoundEnd — per-round results screen (demos S06).
//
// Shows: result label (e.g. "双下 +3"), winner roster, level ladder visualizing
// the upgrade jump, and a 4-column detail strip (result / lineup / upgrade /
// next round). Auto-advances after `autoAdvanceSeconds` if the host (or any
// client) doesn't dismiss.
//
// Pure props; the move-handler emits round_end events that the GameTable
// reducer translates into this state.

import { LevelLadder } from '@/components/LevelLadder';
import type { LevelRank } from '@lib/game/levels';

export interface RoundEndProps {
  roundNumber: number;
  /** Headline result label (e.g. "双下", "单上", "通关 +4"). */
  resultLabel: string;
  /** Numeric upgrade bonus to highlight (e.g. 3 for 双下). */
  levelDelta: number;
  /** Ordered finish list: first → last. */
  finishOrder: ReadonlyArray<{ handle: string; rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 }>;
  /** Winning team's prior level. */
  teamWasLevel: LevelRank;
  /** Winning team's new level. */
  teamNowLevel: LevelRank;
  /** Next round's leader handle. */
  nextLeaderHandle: string;
  /** Whether the next round triggers tribute. */
  nextRoundHasTribute?: boolean;
  /** Auto-advance countdown in seconds. */
  autoAdvanceSeconds: number;
  /** Click handler for "continue immediately" button. */
  onContinue?: () => void;
}

export function RoundEnd(props: RoundEndProps): React.JSX.Element {
  const winners = props.finishOrder.slice(0, 2);
  const winnerLabel = winners
    .map((w, i) => `${w.handle} ${rankLabel(i)}`)
    .join(' · ');

  return (
    <div className="end-stage" role="dialog" aria-modal="true" aria-label="回合结束">
      <div className="end-card">
        <div className="end-eyebrow">第 {props.roundNumber} 局 · 结束</div>
        <h2 className="end-head">
          {props.resultLabel} <em>+{props.levelDelta}</em>
        </h2>
        <p className="end-sub">{winnerLabel}</p>

        <LevelLadder was={props.teamWasLevel} now={props.teamNowLevel} />

        <div className="end-detail">
          <div>
            <div className="end-detail__key">结果</div>
            <div className="end-detail__val">{props.resultLabel}</div>
          </div>
          <div>
            <div className="end-detail__key">阵容</div>
            <div className="end-detail__val">{winnerLabel}</div>
          </div>
          <div>
            <div className="end-detail__key">升级</div>
            <div className="end-detail__val">
              {props.teamWasLevel} → <em>{props.teamNowLevel}</em>
            </div>
          </div>
          <div>
            <div className="end-detail__key">下局起手</div>
            <div className="end-detail__val tnum">
              {props.autoAdvanceSeconds}s ·{' '}
              <em>
                {props.nextLeaderHandle}
                {props.nextRoundHasTribute ? ' 进贡' : ''}
              </em>
            </div>
          </div>
        </div>

        {props.onContinue ? (
          <div className="end-detail" style={{ marginTop: 16, gridTemplateColumns: '1fr' }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={props.onContinue}
            >
              继续
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function rankLabel(zeroIndex: number): string {
  switch (zeroIndex) {
    case 0:
      return '头游';
    case 1:
      return '二游';
    case 2:
      return '三游';
    default:
      return '末游';
  }
}
