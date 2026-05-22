// TributeModal — fullscreen overlay rendered between rounds for the tribute
// phase. Encapsulates all four tribute substates per demos S04 / S11 / S12 / S13:
//
//   `auto`          — server-picked card, animates loser → winner (S04)
//   `pending`       — player-pick mode, loser taps a card from the
//                     same-rank top-candidates (S11)
//   `anti-tribute`  — fullscreen banner when loser holds 2 红王 (S12)
//   `return-pending`— winner picks a ≤10 card to return (S13)
//
// The component is purely props-driven so it can be unit-tested in isolation.
// Hookup to the realtime layer (TributeRequiredEvent / TributeCompletedEvent /
// AntiTributeEvent) lands when TRIBUTE-1 wires those into the move handler.

import { useState } from 'react';
import { Card } from '@/components/Card';
import type { Card as GameCard } from '@lib/game/cards';

export interface TributeAutoState {
  kind: 'auto';
  fromHandle: string;
  fromAvatarClass?: string;
  toHandle: string;
  toAvatarClass?: string;
  card: GameCard;
  /** Round number for the eyebrow ("第 6 局"). */
  roundNumber: number;
  /** Optional countdown seconds for the chip ("3s"). */
  countdownSeconds?: number;
  /** Optional rule explanation string. */
  ruleHint?: string;
}

export interface TributePendingState {
  kind: 'pending';
  loserHandle: string;
  winnerHandle: string;
  /** All cards in the loser's hand. Disabled rendering for non-candidates. */
  hand: readonly GameCard[];
  /** Set of card keys (`rank-suit-deck`) eligible for selection. */
  candidateKeys: ReadonlySet<string>;
  /** Round number (eyebrow). */
  roundNumber: number;
  /** "1/2" progress label when multiple tributes are due (4P 双下). */
  progressLabel?: string;
  /** Seconds remaining in the player's pick window. */
  countdownSeconds: number;
}

export interface TributeAntiState {
  kind: 'anti-tribute';
  /** Handle of the player(s) holding the double red jokers. */
  holderHandle: string;
  holderAvatarClass?: string;
  roundNumber: number;
  /** Optional next-round lead handle ("Y 起手"). */
  nextLeaderHandle?: string;
  /** Optional auto-advance countdown seconds. */
  countdownSeconds?: number;
  /**
   * When true, show the explicit "我们抗贡" CTA that fires onDismiss
   * (=> anti_tribute command to server). Should only be true for players
   * on the losing team — others see the banner as informational only.
   * Defaults to false; the parent component opts in when it can
   * authoritatively determine team membership.
   */
  canDeclare?: boolean;
}

export interface TributeReturnState {
  kind: 'return-pending';
  winnerHandle: string;
  loserHandle: string;
  /** Winner's hand. Non-eligible cards render at 0.3 opacity. */
  hand: readonly GameCard[];
  candidateKeys: ReadonlySet<string>;
  /** Card just received from the loser. */
  receivedCard: GameCard;
  roundNumber: number;
  countdownSeconds: number;
}

export type TributeState =
  | TributeAutoState
  | TributePendingState
  | TributeAntiState
  | TributeReturnState;

export interface TributeModalProps {
  state: TributeState;
  /** Called when the user confirms their picked card (pending / return states only). */
  onConfirm?: (card: GameCard) => void;
  /** Called when the user dismisses anti-tribute banner before auto-advance. */
  onDismiss?: () => void;
}

export function TributeModal(props: TributeModalProps): React.JSX.Element {
  switch (props.state.kind) {
    case 'auto':
      return <AutoTribute state={props.state} />;
    case 'pending':
      return (
        <PendingTribute
          state={props.state}
          onConfirm={props.onConfirm}
        />
      );
    case 'anti-tribute':
      return <AntiTribute state={props.state} onDismiss={props.onDismiss} />;
    case 'return-pending':
      return (
        <ReturnTribute
          state={props.state}
          onConfirm={props.onConfirm}
        />
      );
  }
}

function AutoTribute({ state }: { state: TributeAutoState }): React.JSX.Element {
  return (
    <div
      className="tribute-veil"
      role="dialog"
      aria-modal="true"
      aria-label="进贡阶段"
    >
      <div className="tribute-panel">
        <header className="tribute-head">
          <div>
            <div className="tribute-eyebrow">
              第 {state.roundNumber} 局 · 进贡阶段
            </div>
            <h2 className="tribute-title">
              {state.fromHandle} 进贡 <em>一张大牌</em> 给 {state.toHandle}
            </h2>
          </div>
          {state.countdownSeconds !== undefined ? (
            <span className="chip chip--accent mono">{state.countdownSeconds}s</span>
          ) : null}
        </header>
        <div className="tribute-anim">
          <div className="tribute-side">
            <div className={`avatar avatar--md ${state.fromAvatarClass ?? 'avatar--rival-1'}`}>
              {avatarInitials(state.fromHandle)}
            </div>
            <span className="tribute-side-label">{state.fromHandle} · 末游</span>
            <Card card={state.card} size="md" />
          </div>
          <div className="tribute-arrow" aria-hidden="true">→</div>
          <div className="tribute-side">
            <div className={`avatar avatar--md ${state.toAvatarClass ?? 'avatar--self'}`}>
              {avatarInitials(state.toHandle)}
            </div>
            <span className="tribute-side-label">{state.toHandle} · 头游</span>
            <Card card={state.card} size="md" className="tribute-flyer" />
          </div>
        </div>
        {state.ruleHint ? (
          <div className="tribute-rule">
            <em>规则:</em> {state.ruleHint}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PendingTribute({
  state,
  onConfirm,
}: {
  state: TributePendingState;
  onConfirm?: (card: GameCard) => void;
}): React.JSX.Element {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = selectedKey !== null
    ? state.hand.find((c) => cardKey(c) === selectedKey) ?? null
    : null;

  return (
    <div
      className="tribute-veil"
      role="dialog"
      aria-modal="true"
      aria-label="进贡阶段 · 手选"
    >
      <div className="tribute-panel" style={{ width: 'min(580px, 92vw)' }}>
        <header className="tribute-head">
          <div>
            <div className="tribute-eyebrow">
              第 {state.roundNumber} 局 · 进贡阶段
              {state.progressLabel ? ` · ${state.progressLabel}` : ''}
            </div>
            <h2 className="tribute-title">
              {state.loserHandle} 选一张 <em>最大点数</em> 牌进贡给 {state.winnerHandle}
            </h2>
          </div>
          <span className="chip chip--accent mono">{state.countdownSeconds}s</span>
        </header>
        <p className="tribute-lede">
          系统标灰非最大点数牌；红心通配牌豁免不可选。tap 选择，再 tap 确认。
        </p>
        <div className="tribute-pick-shelf" role="listbox" aria-label="候选牌">
          {state.hand.map((c) => {
            const key = cardKey(c);
            const eligible = state.candidateKeys.has(key);
            const lifted = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                className="tribute-pick-card"
                disabled={!eligible}
                onClick={() => eligible && setSelectedKey(lifted ? null : key)}
                role="option"
                aria-selected={lifted}
                aria-label={`${c.rank} of ${c.suit}`}
              >
                <Card card={c} size="md" lifted={lifted} />
              </button>
            );
          })}
        </div>
        <div className="tribute-actions">
          <span className="tribute-actions__hint">
            {selected
              ? `已选 · ${cardLabel(selected)}`
              : '请从亮起的候选牌中选一张'}
          </span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!selected}
            onClick={() => {
              if (selected && onConfirm) onConfirm(selected);
            }}
          >
            {selected ? `确认进贡 ${cardLabel(selected)} →` : '确认进贡'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AntiTribute({
  state,
  onDismiss,
}: {
  state: TributeAntiState;
  onDismiss?: () => void;
}): React.JSX.Element {
  // Backdrop click intentionally has NO onClick. A previous version wired
  // onDismiss to the backdrop, which meant any accidental tap on the veil
  // (incl. winning-team players who can't even legally declare resist)
  // would POST anti_tribute and get a confusing server rejection. The
  // explicit "我们抗贡" button below is the only path to dispatch.
  return (
    <div
      className="tribute-veil tribute-veil--solid"
      role="dialog"
      aria-modal="true"
      aria-label="抗贡"
    >
      <div className="anti-tribute">
        <div className="tribute-eyebrow tribute-eyebrow--gold">
          第 {state.roundNumber} 局 · 进贡阶段
        </div>
        <div className="anti-tribute__rune">抗 贡</div>
        <div className="anti-tribute__row">
          <div className={`avatar avatar--md ${state.holderAvatarClass ?? 'avatar--rival-1'}`}>
            {avatarInitials(state.holderHandle)}
          </div>
          <span>{state.holderHandle}</span>
          <span style={{ color: 'var(--ink-3)' }}>·</span>
          <span className="anti-tribute__holder">持双红王</span>
          <span style={{ color: 'var(--ink-3)' }}>→ 免进贡</span>
        </div>
        <div className="anti-tribute__cards" aria-hidden="true">
          {/* Two red joker cards rendered via the Card primitive with face-up override
              would need a "wildcard" treatment; for the banner we paint two static
              card-back-style faces with gold outline. The Card primitive renders
              jokers correctly when given joker rank. */}
          <Card card={{ suit: 'joker', rank: 'RJ', deck: 1 }} size="lg" isWildcard />
          <Card card={{ suit: 'joker', rank: 'RJ', deck: 2 }} size="lg" isWildcard />
        </div>
        <div className="anti-tribute__footer">
          {state.countdownSeconds !== undefined
            ? `${state.countdownSeconds}s 后开始下一局`
            : '即将开始下一局'}
          {state.nextLeaderHandle ? ` · ${state.nextLeaderHandle} 起手` : ''}
        </div>
        {state.canDeclare && onDismiss ? (
          <div className="tribute-actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={onDismiss}
              aria-label="我们抗贡"
            >
              我们抗贡 →
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReturnTribute({
  state,
  onConfirm,
}: {
  state: TributeReturnState;
  onConfirm?: (card: GameCard) => void;
}): React.JSX.Element {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = selectedKey !== null
    ? state.hand.find((c) => cardKey(c) === selectedKey) ?? null
    : null;

  return (
    <div
      className="tribute-veil"
      role="dialog"
      aria-modal="true"
      aria-label="还贡阶段"
    >
      <div className="tribute-panel" style={{ width: 'min(580px, 92vw)' }}>
        <header className="tribute-head">
          <div>
            <div className="tribute-eyebrow tribute-eyebrow--info">
              第 {state.roundNumber} 局 · 还贡阶段
            </div>
            <h2 className="tribute-title">
              {state.winnerHandle} 还一张 <em className="info">≤10</em> 的牌给 {state.loserHandle}
            </h2>
          </div>
          <span className="chip chip--info mono">{state.countdownSeconds}s</span>
        </header>
        <div className="tribute-received">
          <span className="tribute-received__label">收到</span>
          <Card card={state.receivedCard} size="md" />
          <span className="tribute-received__from">来自 {state.loserHandle}</span>
        </div>
        <div className="tribute-pick-shelf" role="listbox" aria-label="候选牌">
          {state.hand.map((c) => {
            const key = cardKey(c);
            const eligible = state.candidateKeys.has(key);
            const lifted = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                className="tribute-pick-card"
                disabled={!eligible}
                onClick={() => eligible && setSelectedKey(lifted ? null : key)}
                role="option"
                aria-selected={lifted}
                aria-label={`${c.rank} of ${c.suit}`}
              >
                <Card card={c} size="md" lifted={lifted} />
              </button>
            );
          })}
        </div>
        <div className="tribute-actions">
          <span className="tribute-actions__hint">
            {selected
              ? `已选 · ${cardLabel(selected)}`
              : '请选一张 ≤10 的牌'}
          </span>
          <button
            type="button"
            className="btn btn--info btn--sm"
            disabled={!selected}
            onClick={() => {
              if (selected && onConfirm) onConfirm(selected);
            }}
          >
            {selected ? `确认还 ${cardLabel(selected)} →` : '确认还贡'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function cardKey(c: GameCard): string {
  return `${c.rank}-${c.suit}-${c.deck}`;
}

const SUIT_SYM: Record<GameCard['suit'], string> = {
  spades: '♠',
  hearts: '♥',
  clubs: '♣',
  diamonds: '♦',
  joker: '★',
};

function cardLabel(c: GameCard): string {
  return `${SUIT_SYM[c.suit]}${c.rank}`;
}

function avatarInitials(handle: string): string {
  return handle.replace(/^@/, '').slice(0, 2).toUpperCase();
}
