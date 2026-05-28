// ExchangeVoteModal — shown to losing-team voters during EXCHANGE-1's vote
// phase. Mirrors the tribute-veil overlay pattern (see TributeModal.tsx) but
// is a simple binary ballot: 赞成换牌 / 不换.
//
// The optional card-exchange rule (per-room) lets the losing team collectively
// vote on whether to run a card swap this round. Each eligible loser sees this
// modal; tapping a button POSTs an ExchangeVoteCommand and resolves the modal
// for that player.
//
// Purely props-driven so it can be unit-tested in isolation.

export interface ExchangeVoteModalProps {
  /** Number of cards each player will exchange if the vote passes. */
  cardCount: number;
  /** Fired with the player's yes/no ballot. */
  onVote: (vote: boolean) => void;
  /** Disable both buttons while a vote is in flight. */
  busy?: boolean;
}

export function ExchangeVoteModal({
  cardCount,
  onVote,
  busy = false,
}: ExchangeVoteModalProps): React.JSX.Element {
  return (
    <div
      className="tribute-veil"
      role="dialog"
      aria-modal="true"
      aria-label="换牌投票"
    >
      <div className="exchange-modal">
        <div className="tribute-eyebrow">换牌阶段 · 败方投票</div>
        <h2 className="tribute-title">
          是否发起 <em>换牌</em>？
        </h2>
        <p className="tribute-lede">
          换牌通过后，每位玩家交换 {cardCount} 张牌。需达到票数门槛才生效，过半数败方同意即开始换牌。
        </p>
        <div className="exchange-modal__vote">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onVote(true)}
            disabled={busy}
            aria-label="赞成换牌"
          >
            赞成换牌
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => onVote(false)}
            disabled={busy}
            aria-label="不换"
          >
            不换
          </button>
        </div>
      </div>
    </div>
  );
}
