// GameTableMP — shared 6P / 8P landscape table.
//
// Mounted via App.tsx for mode='6' or '8'. SSE wiring + reducer are extracted
// into `useTableSubscription` so we don't duplicate the 4P implementation.
// Layout differs from 4P: opponents arrange around an oval felt (poker 6-max
// / 9-max conventions) per demos S05 / S06 with the local player at 6 o'clock.
//
// Team coloring uses 4-team rings (A/B/C/D) via .oval-seat__ring--<key> classes.
// Bot players are detected via PlayerSummary.status === 'bot' and surfaced with
// a small "BOT" chip on their seat.
//
// Player-assist + EXCHANGE-1 integrations mirror GameTable4P verbatim (理牌 /
// 提示 / 收官 / wildcard confirm / report / status badges / latency beacon /
// card-exchange modals); only the seat geometry differs (oval clock positions
// instead of left/right rivals).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Hand } from '@/components/Hand';
import { SortButton } from '@/components/SortButton';
import { SuggestionHint } from '@/components/SuggestionHint';
import { WildcardSubDialog, type WildcardCandidate } from '@/components/WildcardSubDialog';
import { EndgameAssist } from '@/components/EndgameAssist';
import { ReportButton } from '@/components/ReportButton';
import { PlayerStatusBadge } from '@/components/PlayerStatusBadge';
import { TurnCountdown } from '@/components/TurnCountdown';
import { openSseClient, type SseClient } from '@/lib/sseClient';
import { handlesEqual } from '@/lib/identity';
import { postCommand } from '@/lib/api/moveClient';
import { RoundEnd } from '@/screens/RoundEnd';
import { Victory } from '@/screens/Victory';
import { ALevelFinal } from '@/screens/ALevelFinal';
import { decodeCardId, encodeCards } from '@lib/realtime/cardCodec';
import { isWildcard } from '@lib/game/cards';
import { analyzeHand, type Pattern } from '@lib/game/patterns';
import { measureAndBeacon } from '@/lib/telemetry/beacon';
import { RoomApiError } from '@/lib/api/rooms';
import type {
  CardId,
  DealEvent,
  ExchangeCompletedEvent,
  ExchangeSelectRequiredEvent,
  ExchangeVoteRequiredEvent,
  ExchangeVoteResolvedEvent,
  GameEndEvent,
  MovePassedEvent,
  MovePlayedEvent,
  PlayerHandle,
  PlayerSummary,
  RoomJoinedEvent,
  RoomLeftEvent,
  RoundEndEvent,
  ServerEvent,
  SnapshotEvent,
  TrickWonEvent,
  TributePendingEvent,
  TributeResolvedEvent,
} from '@lib/realtime/messages';
import type { Card as GameCard } from '@lib/game/cards';
import type { LevelRank } from '@lib/game/levels';
import type { TeamKey } from '@lib/game/mode';
import type {
  PlayCommand,
  PassCommand,
  TributeSelectCommand,
  AntiTributeCommand,
  ExchangeVoteCommand,
  ExchangeSelectCommand,
} from '@lib/realtime/commands';
import { assignClockPositions, type TableMode } from '@/lib/seating';
import { TributeModal, type TributeState } from '@/screens/TributeModal';
import { ExchangeVoteModal } from '@/screens/ExchangeVoteModal';
import { ExchangeSelectModal } from '@/screens/ExchangeSelectModal';

/**
 * EXCHANGE-1 client UI state. Set by the exchange_* events, cleared once the
 * exchange resolves. `vote` is shown only to losing-team voters; `select` is
 * shown to all players once the vote passes. Mirrors GameTable4P.
 */
export type ExchangeUiState =
  | { phase: 'vote'; losers: string[]; cardCount: number }
  | { phase: 'select'; cardCount: number; direction: 'cw' | 'ccw' };

export interface GameTableMPProps {
  mode: '6' | '8';
  roomId: string;
  joinToken: string;
  myHandle: PlayerHandle;
  fromVersion?: number;
  /** Strict-A rule from the room view (App.tsx TableSwitch). Drives the
   *  ALevelFinal banner copy; defaults to true (the project default rule). */
  strictA?: boolean;
}

interface TableState {
  myHand: GameCard[];
  players: Map<string, PlayerSummary>;
  /** Server-assigned seat order. */
  seatOrder: string[];
  teamLevels: Record<TeamKey, LevelRank>;
  currentTurn: string | null;
  lastPlayed: { player: string; cards: GameCard[]; combinationLabel: string } | null;
  myPlayerId: string | null;
  myTeam: TeamKey | null;
  /**
   * Tribute UI state — set by `tribute_pending`, cleared by
   * `tribute_resolved`. Null when no tribute is in flight. 6P/8P sees sweep
   * tribute (3-4 obligations) more often than single; same snapshot shape
   * either way.
   */
  tribute: TributePendingSnapshot | null;
  /** Monotonic round counter — bumped on each `deal` for TributeModal eyebrow. */
  roundNumber: number;
  /**
   * Winning team of the most-recent round_end. Used to gate canDeclare on
   * anti_tribute per Round 2 IMPORTANT-2 — the server validates by team
   * membership, not red-joker ownership.
   */
  lastRoundWinnerTeam: TeamKey | null;
  /**
   * EXCHANGE-1 card-exchange UI state. Set by exchange_vote_required /
   * exchange_select_required, cleared on exchange_vote_resolved(passed=false)
   * or exchange_completed. Null/undefined when no exchange is in flight.
   * Optional so older state literals (and tests predating EXCHANGE-1) remain
   * valid — the reducer + render treat undefined identically to null.
   */
  exchange?: ExchangeUiState | null;
  /**
   * Version of the last connect snapshot — see GameTable4P.TableState for
   * the double-apply rationale. Events at or below this version are skipped
   * by reduceEvent (except modal-state events).
   */
  snapshotVersion?: number;
  /** Players who emptied their hand this round, in finish order. See GameTable4P. */
  finishOrder?: { id: string; handle: string }[];
  /** Set by round_end; drives the RoundEnd overlay. */
  roundEndView?: RoundEndView | null;
  /** Set by game_end; drives the Victory screen. */
  gameEndView?: { winnerTeam: TeamKey; summary: string } | null;
  /** Whose A-test the current round is — from deal.roundOwner / snapshot. */
  roundOwner?: TeamKey | null;
  /** A-level fail counters — from snapshot / round_end (ALevelFinal banner). */
  teamAFails?: Record<TeamKey, number> | null;
  /** Transient tribute summary — see GameTable4P. */
  tributeNotice?: {
    key: number;
    exchanged: { fromHandle: string; toHandle: string; card: GameCard }[];
  } | null;
  /** ISO deadline for the current turn (move events / snapshot). Drives the
   *  TurnCountdown; the server's turn-timeout sweep enforces it. */
  turnDeadline?: string | null;
}

export interface RoundEndView {
  roundNumber: number;
  winnerTeam: TeamKey;
  upgrade: number;
  wasLevel: LevelRank;
  nowLevel: LevelRank;
  finishOrder: { id: string; handle: string }[];
}

export interface TributePendingSnapshot {
  direction: TributePendingEvent['direction'];
  obligations: TributePendingEvent['obligations'];
  yourOwedCard?: CardId;
}

const EMPTY_STATE: TableState = {
  myHand: [],
  players: new Map(),
  seatOrder: [],
  teamLevels: { t1: '2', t2: '2' },
  currentTurn: null,
  lastPlayed: null,
  myPlayerId: null,
  myTeam: null,
  tribute: null,
  roundNumber: 1,
  lastRoundWinnerTeam: null,
  exchange: null,
};

function decodeHand(ids: readonly CardId[]): GameCard[] {
  return ids.map(decodeCardId);
}

export function GameTableMP({
  mode,
  roomId,
  joinToken,
  myHandle,
  fromVersion,
  strictA,
}: GameTableMPProps): React.JSX.Element {
  const [state, setState] = useState<TableState>(EMPTY_STATE);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [version, setVersion] = useState<number>(fromVersion ?? 0);
  const [connectionState, setConnectionState] = useState<
    'connecting' | 'live' | 'closed'
  >('connecting');
  // Local display-order overlay for 理牌. Null = render state.myHand verbatim;
  // non-null = render this reordered copy. Reset to null on any hand-replacing
  // event (shouldClearSelectedOnEvent) so it never points at stale cards.
  const [sortedHand, setSortedHand] = useState<GameCard[] | null>(null);
  // 提示 toggle — when on, renders SuggestionHint (which lifts the suggested
  // cards via onSuggest).
  const [hintOn, setHintOn] = useState(false);
  // 收官 (endgame assist) toggle — default OFF; only meaningful for short hands.
  const [endgameOn, setEndgameOn] = useState(false);
  // Wildcard-substitution confirm dialog. Holds the staged play (cards + the
  // plausible default interpretation) until the user confirms; null = no prompt.
  const [wildcardPrompt, setWildcardPrompt] = useState<{
    cards: GameCard[];
    candidate: WildcardCandidate;
  } | null>(null);
  // Busy flag for the exchange modals' in-flight POST.
  const [exchangeBusy, setExchangeBusy] = useState(false);
  // Last rejected command's human-readable reason. Cleared on the next
  // submission attempt and on any incoming server event (the table moved on).
  const [moveError, setMoveError] = useState<string | null>(null);
  // RoundEnd overlay dismissal — keyed by the view's roundNumber. See 4P.
  const [dismissedRoundEnd, setDismissedRoundEnd] = useState(0);
  // Tribute-notice dismissal — keyed by the notice's event version.
  const [dismissedTribute, setDismissedTribute] = useState(0);
  // Mirror of state.myPlayerId for the SSE callback — see GameTable4P for the
  // detailed rationale. Without this, my own move_played event leaves stale
  // indices in `selected` (the survivors now point to different cards).
  const myPlayerIdRef = useRef<string | null>(null);
  useEffect(() => {
    myPlayerIdRef.current = state.myPlayerId;
  }, [state.myPlayerId]);

  useEffect(() => {
    let client: SseClient | null = null;
    setConnectionState('connecting');
    client = openSseClient({
      roomId,
      joinToken,
      ...(fromVersion != null ? { fromVersion } : {}),
      onEvent: (evt) => {
        setConnectionState('live');
        // Max-guard: the connect snapshot arrives at the CURRENT version,
        // then the backlog replays older versions — fromVersion for the next
        // move must never regress below the snapshot.
        setVersion((v) => Math.max(v, evt.version));
        setMoveError(null);
        setState((prev) => reduceEvent(prev, evt, myHandle));
        if (shouldClearSelectedOnEvent(evt, myPlayerIdRef.current)) {
          setSelected(new Set());
          // The 理牌 overlay is keyed by index into the OLD hand; once the hand
          // is replaced/shrunk those indices are stale, so drop the overlay and
          // fall back to rendering state.myHand verbatim.
          setSortedHand(null);
        }
      },
      onError: () => setConnectionState('closed'),
      onClose: () => setConnectionState('closed'),
    });
    return () => {
      client?.close();
    };
  }, [roomId, joinToken, myHandle, fromVersion]);

  const myLevel: LevelRank = state.myTeam ? state.teamLevels[state.myTeam] : '2';
  const oppTeam: TeamKey = state.myTeam === 't1' ? 't2' : 't1';
  const oppLevel: LevelRank = state.teamLevels[oppTeam];

  // The hand actually rendered + indexed by `selected`. When 理牌 has run we
  // render the reordered copy; otherwise the reducer's myHand verbatim. ALL
  // index-based logic (toggleCard, submitPlay, SuggestionHint onSuggest) keys
  // off this same array so selection never desyncs.
  const displayHand: GameCard[] = sortedHand ?? state.myHand;

  // The pattern the local player must beat when following. Reconstructed from
  // the last played combination; null when leading (no current trick).
  const trickTarget: Pattern | null = useMemo(
    () =>
      state.lastPlayed && state.lastPlayed.cards.length > 0
        ? analyzeHand(state.lastPlayed.cards, myLevel)
        : null,
    [state.lastPlayed, myLevel],
  );

  // Auto-dismiss the RoundEnd overlay after 8s — see GameTable4P.
  useEffect(() => {
    const view = state.roundEndView;
    if (!view || view.roundNumber === dismissedRoundEnd) return undefined;
    const timer = setTimeout(() => setDismissedRoundEnd(view.roundNumber), 8000);
    return () => clearTimeout(timer);
  }, [state.roundEndView, dismissedRoundEnd]);

  // Auto-dismiss the tribute notice after 7s.
  useEffect(() => {
    const notice = state.tributeNotice;
    if (!notice || notice.key === dismissedTribute) return undefined;
    const timer = setTimeout(() => setDismissedTribute(notice.key), 7000);
    return () => clearTimeout(timer);
  }, [state.tributeNotice, dismissedTribute]);

  const seats = useMemo(() => {
    if (!state.myPlayerId || state.seatOrder.length === 0) return [];
    const ordered = state.seatOrder
      .map((id) => state.players.get(id))
      .filter((p): p is PlayerSummary => p !== undefined);
    return assignClockPositions<PlayerSummary>(mode as TableMode, ordered, state.myPlayerId);
  }, [state.players, state.seatOrder, state.myPlayerId, mode]);

  const toggleCard = (idx: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  /**
   * Apply 理牌: reorder the displayed hand into combo clusters. Selection is
   * cleared because the index → card mapping changes under the reorder.
   */
  const onSort = (sorted: readonly GameCard[]): void => {
    setSortedHand([...sorted]);
    setSelected(new Set());
  };

  /** Lift the suggested cards (indices into displayHand) when 提示 fires. */
  const onSuggest = (indices: number[]): void => {
    setSelected(new Set(indices));
  };

  /** Normalize a rejected command into the on-table error line. */
  const surfaceMoveError = (err: unknown): void => {
    const msg =
      err instanceof RoomApiError
        ? err.message
        : err instanceof Error
          ? `网络错误（${err.message}）`
          : '网络错误';
    setMoveError(msg);
  };

  /**
   * POST the play. Wrapped in measureAndBeacon so each move round-trip emits a
   * latency sample (DEPLOY-2). Beacon failure never disturbs the play.
   */
  const dispatchPlay = async (ids: CardId[]): Promise<void> => {
    setMoveError(null);
    const cmd: PlayCommand = { kind: 'play', cards: ids, fromVersion: version };
    try {
      await measureAndBeacon(() => postCommand(roomId, joinToken, cmd));
    } catch (err) {
      surfaceMoveError(err);
    }
  };

  const submitPlay = async (): Promise<void> => {
    if (selected.size === 0) return;
    const indices = [...selected].sort((a, b) => a - b);
    const cards = indices
      .map((i) => displayHand[i])
      .filter((c): c is GameCard => c != null);
    const ids = encodeCards(cards);

    // If the selection contains a wildcard (红心级牌) AND it forms a valid
    // pattern, surface the substitution confirm dialog defaulting to the
    // plausible interpretation (analyzeHand's reading). A single-card or
    // no-wildcard selection plays straight through — never block a legal play.
    const hasWildcard = cards.some((c) => isWildcard(c, myLevel));
    if (hasWildcard && cards.length > 1) {
      const reading = analyzeHand(cards, myLevel);
      if (reading) {
        setWildcardPrompt({
          cards,
          candidate: { id: `${reading.kind}-${reading.rank ?? 'x'}`, pattern: reading },
        });
        return;
      }
    }
    await dispatchPlay(ids);
  };

  const submitPass = async (): Promise<void> => {
    setMoveError(null);
    const cmd: PassCommand = { kind: 'pass', fromVersion: version };
    try {
      await measureAndBeacon(() => postCommand(roomId, joinToken, cmd));
    } catch (err) {
      surfaceMoveError(err);
    }
  };

  /** Exchange vote (losing-team voter). */
  const submitExchangeVote = async (vote: boolean): Promise<void> => {
    setExchangeBusy(true);
    try {
      const cmd: ExchangeVoteCommand = { kind: 'exchange_vote', vote, fromVersion: version };
      await postCommand(roomId, joinToken, cmd);
    } finally {
      setExchangeBusy(false);
    }
  };

  /** Exchange select (every player picks cardCount cards to give away). */
  const submitExchangeSelect = async (cards: GameCard[]): Promise<void> => {
    setExchangeBusy(true);
    try {
      const cmd: ExchangeSelectCommand = {
        kind: 'exchange_select',
        cards: encodeCards(cards),
        fromVersion: version,
      };
      await postCommand(roomId, joinToken, cmd);
    } finally {
      setExchangeBusy(false);
    }
  };

  /** Report an opponent — binds the reporter's own handle to postReport. */
  const submitReport = (targetHandle: string, reason: string): Promise<void> =>
    postReport(roomId, myHandle, targetHandle, reason);

  const submitTributeSelect = async (card: GameCard): Promise<void> => {
    const id = encodeCard(card);
    if (id === null) return;
    const cmd: TributeSelectCommand = {
      kind: 'tribute_select',
      targetCard: id,
      fromVersion: version,
    };
    await postCommand(roomId, joinToken, cmd);
  };

  const submitAntiTribute = async (): Promise<void> => {
    const cmd: AntiTributeCommand = { kind: 'anti_tribute', fromVersion: version };
    await postCommand(roomId, joinToken, cmd);
  };

  const tributeModalState = useMemo(
    () =>
      buildTributeModalState(
        state.tribute,
        state.myHand,
        state.myPlayerId,
        state.myTeam,
        state.players,
        myLevel,
        state.roundNumber,
        state.lastRoundWinnerTeam,
      ),
    [
      state.tribute,
      state.myHand,
      state.myPlayerId,
      state.myTeam,
      state.players,
      myLevel,
      state.roundNumber,
      state.lastRoundWinnerTeam,
    ],
  );

  // A-level decisive-round chrome (S07) — see GameTable4P for the selection
  // rationale (round owner wins ties, then my team).
  const aTeam: TeamKey | null =
    state.teamLevels.t1 === 'A' && state.teamLevels.t2 === 'A'
      ? (state.roundOwner ?? state.myTeam ?? 't1')
      : state.teamLevels.t1 === 'A'
        ? 't1'
        : state.teamLevels.t2 === 'A'
          ? 't2'
          : null;

  const tributeNoticeVisible =
    state.tributeNotice && state.tributeNotice.key !== dismissedTribute
      ? state.tributeNotice
      : null;

  const table = (
    <div className="mtable" role="application" aria-label={`${mode}-player game table`}>
      {tributeNoticeVisible ? (
        <div className="tribute-notice mono" role="status">
          <span className="tribute-notice__title">进贡结算</span>
          {tributeNoticeVisible.exchanged.map((x, i) => (
            <span key={`${x.fromHandle}-${i}`} className="tribute-notice__line">
              {x.fromHandle} → {x.toHandle}：{cardNoticeLabel(x.card)}
            </span>
          ))}
        </div>
      ) : null}
      <header className="mtable-top">
        <div className="mtable-top__key">ROOM</div>
        <div className="mtable-top__val">{roomId}</div>
        <span className={`chip mono ${connectionState === 'live' ? 'chip--live' : ''}`}>
          {connectionState === 'live' ? 'LIVE' : connectionState === 'connecting' ? 'SYNC' : 'DC'}
        </span>
        <span className="chip mono">{mode}P</span>
        <div style={{ flex: 1 }} />
        <span className="mtable-top__key">我方</span>
        <span className="mtable-top__val">
          LV <em>{myLevel}</em>
        </span>
        <span className="mtable-top__key">对方</span>
        <span className="mtable-top__val">LV {oppLevel}</span>
      </header>

      <div className="mtable-arena">
        <div className={`oval-felt oval-felt--${mode}p`} aria-hidden="true" />

        {state.lastPlayed ? (
          <div className="oval-trick" role="status" aria-live="polite">
            <div className="oval-trick__meta">
              上一手 {state.lastPlayed.player} · <em>{state.lastPlayed.combinationLabel}</em>
            </div>
            <div className="oval-trick__cards">
              {state.lastPlayed.cards.map((c, i) => (
                <CardGlyph key={`${c.rank}-${c.suit}-${c.deck}-${i}`} card={c} />
              ))}
            </div>
          </div>
        ) : null}

        {seats.map(({ player, position }) => {
          const isActive = state.currentTurn === player.id;
          const teamKey = teamRing(player.team);
          return (
            <div
              key={player.id}
              className="oval-seat"
              style={{ left: position.left, top: position.top }}
              data-clock={position.clock}
            >
              <div className="oval-seat__avatar-wrap">
                <div className={`oval-seat__ring oval-seat__ring--${teamKey}`} />
                {isActive ? <div className="oval-seat__active" /> : null}
                <div className={`avatar avatar--team-${teamKey}`}>
                  {player.handle.replace(/^@/, '').slice(0, 2).toUpperCase()}
                </div>
              </div>
              <span className="oval-seat__name">
                {player.handle}
                <PlayerStatusBadge status={player.status} />
              </span>
              <span className="oval-seat__meta">
                {teamKey} · {player.handCount} 张
                {isActive ? <em> · 行动中</em> : null}
              </span>
              <ReportButton
                targetHandle={player.handle}
                gameId={roomId}
                onSubmit={(s) => submitReport(s.targetHandle, s.reason)}
              />
            </div>
          );
        })}
      </div>

      <div className="mtable-bot">
        <div className="mtable-bot__meta">
          <span>
            我 · <em>{myHandle}</em> · {displayHand.length} 张
            {state.myTeam ? ` · 队 ${teamRing(state.myTeam)}` : ''}
            {state.myPlayerId !== null && state.currentTurn === state.myPlayerId ? (
              <span className="turn-flag">▶ 轮到你出牌</span>
            ) : null}
            <TurnCountdown
              deadline={state.turnDeadline ?? null}
              active={state.myPlayerId !== null && state.currentTurn === state.myPlayerId}
            />
          </span>
          <span>红心通配 ★</span>
        </div>
        {moveError ? (
          <div className="move-error mono" role="alert">
            {moveError}
          </div>
        ) : null}
        {hintOn ? (
          <SuggestionHint
            cards={displayHand}
            target={trickTarget}
            levelRank={myLevel}
            onSuggest={onSuggest}
          />
        ) : null}
        <EndgameAssist cards={displayHand} levelRank={myLevel} enabled={endgameOn} />
        <Hand
          cards={displayHand}
          levelRank={myLevel}
          liftedIndices={selected}
          onCardClick={toggleCard}
          ariaLabel="my hand"
        />
        <div className="mtable-bot__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void submitPlay()}
            disabled={selected.size === 0 || state.currentTurn !== state.myPlayerId}
          >
            出牌
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void submitPass()}
            disabled={state.currentTurn !== state.myPlayerId}
          >
            不出
          </button>
          <SortButton cards={displayHand} levelRank={myLevel} onSort={onSort} />
          <button
            type="button"
            className={hintOn ? 'btn btn--accent-soft btn--on' : 'btn btn--accent-soft'}
            onClick={() => setHintOn((v) => !v)}
            aria-pressed={hintOn}
          >
            提示
          </button>
          {displayHand.length <= 6 ? (
            <button
              type="button"
              className={endgameOn ? 'btn btn--ghost btn--on' : 'btn btn--ghost'}
              onClick={() => setEndgameOn((v) => !v)}
              aria-pressed={endgameOn}
            >
              收官
            </button>
          ) : null}
        </div>
      </div>

      {tributeModalState ? (
        <TributeModal
          state={tributeModalState}
          onConfirm={(card) => void submitTributeSelect(card)}
          onDismiss={() => void submitAntiTribute()}
        />
      ) : null}

      {wildcardPrompt ? (
        <WildcardSubDialog
          cards={wildcardPrompt.cards}
          candidates={[wildcardPrompt.candidate]}
          defaultIndex={0}
          onConfirm={() => {
            const ids = encodeCards(wildcardPrompt.cards);
            setWildcardPrompt(null);
            void dispatchPlay(ids);
          }}
          onCancel={() => setWildcardPrompt(null)}
        />
      ) : null}

      {state.exchange?.phase === 'vote' &&
      state.myPlayerId !== null &&
      state.exchange.losers.includes(state.myPlayerId) ? (
        <ExchangeVoteModal
          cardCount={state.exchange.cardCount}
          onVote={(vote) => void submitExchangeVote(vote)}
          busy={exchangeBusy}
        />
      ) : null}

      {state.exchange?.phase === 'select' ? (
        <ExchangeSelectModal
          hand={state.myHand}
          cardCount={state.exchange.cardCount}
          direction={state.exchange.direction}
          onSelect={(cards) => void submitExchangeSelect(cards)}
          busy={exchangeBusy}
        />
      ) : null}

      {state.roundEndView &&
      state.roundEndView.roundNumber !== dismissedRoundEnd &&
      !state.gameEndView ? (
        <RoundEnd
          roundNumber={state.roundEndView.roundNumber}
          resultLabel={roundResultLabel(state.roundEndView.upgrade)}
          levelDelta={state.roundEndView.upgrade}
          finishOrder={state.roundEndView.finishOrder.map((f, i) => ({
            handle: f.handle,
            rank: Math.min(i + 1, 8) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
          }))}
          teamWasLevel={state.roundEndView.wasLevel}
          teamNowLevel={state.roundEndView.nowLevel}
          nextLeaderHandle={state.roundEndView.finishOrder[0]?.handle ?? ''}
          autoAdvanceSeconds={8}
          onContinue={() => setDismissedRoundEnd(state.roundEndView?.roundNumber ?? 0)}
        />
      ) : null}

      {state.gameEndView ? (
        <Victory
          winningTeam={state.gameEndView.winnerTeam}
          winningTeamLabel={state.gameEndView.winnerTeam === state.myTeam ? '我方' : '对方'}
          winningRoster={[...state.players.values()]
            .filter((p) => p.team === state.gameEndView?.winnerTeam)
            .map((p) => ({ handle: p.handle }))}
          finalLevel={state.teamLevels[state.gameEndView.winnerTeam]}
          roundCount={state.roundNumber}
          onReturn={() => {
            window.location.hash = '#/';
          }}
        />
      ) : null}
    </div>
  );

  if (aTeam !== null) {
    return (
      <ALevelFinal
        aTeam={aTeam}
        aTeamLabel={aTeam === state.myTeam ? '我方' : '对方'}
        strictMode={strictA ?? true}
        failCount={state.teamAFails?.[aTeam] ?? 0}
        failCap={3}
        isOwnRound={(state.roundOwner ?? null) === aTeam}
      >
        {table}
      </ALevelFinal>
    );
  }
  return table;
}

/** Compact card label for the tribute notice, e.g. "红桃A" / "大王". */
function cardNoticeLabel(card: GameCard): string {
  if (card.suit === 'joker') return card.rank === 'RJ' ? '大王' : '小王';
  const suitZh =
    card.suit === 'spades' ? '黑桃' : card.suit === 'hearts' ? '红桃' : card.suit === 'clubs' ? '梅花' : '方块';
  return `${suitZh}${card.rank}`;
}

/** Headline label for a round result by upgrade size (双下 +3 / 单下 +2 / 平下 +1). */
function roundResultLabel(upgrade: number): string {
  if (upgrade >= 3) return '双下';
  if (upgrade === 2) return '单下';
  return '平下';
}

/**
 * POST a player report to /api/report. Thin fetch — throws RoomApiError on a
 * non-ok response so the ReportButton surfaces the failure. The reporter's own
 * handle is attached here (the component only knows the target).
 */
async function postReport(
  roomId: string,
  reporterHandle: string,
  targetHandle: string,
  reason: string,
): Promise<void> {
  const res = await fetch('/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reporterHandle, targetHandle, gameId: roomId, reason }),
  });
  if (!res.ok) {
    throw new RoomApiError(res.status, 'report_failed', '举报提交失败');
  }
}

// ─── Reducer (exported for tests) ──────────────────────────────────────────────

/** See GameTable4P — modal-state events exempt from the snapshot skip guard. */
const SNAPSHOT_EXEMPT_EVENTS: ReadonlySet<ServerEvent['type']> = new Set([
  'tribute_pending',
  'exchange_vote_required',
  'exchange_select_required',
]);

export function reduceEvent(
  prev: TableState,
  evt: ServerEvent,
  myHandle: PlayerHandle
): TableState {
  // Skip backlog events already reflected in the connect snapshot — see
  // TableState.snapshotVersion (double-apply guard).
  if (
    evt.type !== 'snapshot' &&
    typeof evt.version === 'number' &&
    evt.version <= (prev.snapshotVersion ?? 0) &&
    !SNAPSHOT_EXEMPT_EVENTS.has(evt.type)
  ) {
    return prev;
  }
  switch (evt.type) {
    case 'snapshot':
      return reduceSnapshot(prev, evt, myHandle);
    case 'deal':
      return reduceDeal(prev, evt);
    case 'room_joined':
      return reduceRoomJoined(prev, evt);
    case 'room_left':
      return reduceRoomLeft(prev, evt);
    case 'move_played':
      return reduceMovePlayed(prev, evt);
    case 'move_passed':
      return reduceMovePassed(prev, evt);
    case 'trick_won':
      return reduceTrickWon(prev, evt);
    case 'tribute_pending':
      return reduceTributePending(prev, evt);
    case 'tribute_resolved':
      return reduceTributeResolved(prev, evt);
    case 'round_end':
      return reduceRoundEnd(prev, evt);
    case 'game_end':
      return reduceGameEnd(prev, evt);
    case 'exchange_vote_required':
      return reduceExchangeVoteRequired(prev, evt);
    case 'exchange_vote_resolved':
      return reduceExchangeVoteResolved(prev, evt);
    case 'exchange_select_required':
      return reduceExchangeSelectRequired(prev, evt);
    case 'exchange_completed':
      return reduceExchangeCompleted(prev, evt);
    default:
      return prev;
  }
}

function reduceExchangeVoteRequired(
  prev: TableState,
  evt: ExchangeVoteRequiredEvent,
): TableState {
  return {
    ...prev,
    exchange: { phase: 'vote', losers: [...evt.losers], cardCount: evt.cardCount },
  };
}

function reduceExchangeVoteResolved(
  prev: TableState,
  evt: ExchangeVoteResolvedEvent,
): TableState {
  // Failed vote → no exchange, clear the UI so the trick resumes. Passed vote
  // → keep the phase alive; the follow-up exchange_select_required sets the
  // select phase. (We don't store direction here — select_required carries it.)
  if (!evt.passed) {
    return { ...prev, exchange: null };
  }
  return prev;
}

function reduceExchangeSelectRequired(
  prev: TableState,
  evt: ExchangeSelectRequiredEvent,
): TableState {
  return {
    ...prev,
    exchange: { phase: 'select', cardCount: evt.cardCount, direction: evt.direction },
  };
}

function reduceExchangeCompleted(
  prev: TableState,
  evt: ExchangeCompletedEvent,
): TableState {
  // Replace my hand with the post-swap hand and refresh public counts. Clear
  // the exchange UI — the swap is done and the trick can proceed.
  const players = new Map(prev.players);
  for (const [id, count] of Object.entries(evt.publicHandCounts)) {
    const p = players.get(id);
    if (p) players.set(id, { ...p, handCount: count });
  }
  return {
    ...prev,
    myHand: decodeHand(evt.yourHand),
    players,
    exchange: null,
  };
}

function reduceRoundEnd(prev: TableState, evt: RoundEndEvent): TableState {
  // Capture winnerTeam so the next tribute_pending (anti_tribute) can gate
  // canDeclare on team membership rather than red-joker ownership.
  return {
    ...prev,
    lastRoundWinnerTeam: evt.winnerTeam,
    teamLevels: { t1: evt.newLevels.t1, t2: evt.newLevels.t2 },
    teamAFails: evt.teamAFails ?? prev.teamAFails ?? null,
    roundEndView: {
      roundNumber: prev.roundNumber,
      winnerTeam: evt.winnerTeam,
      upgrade: evt.upgrade,
      wasLevel: prev.teamLevels[evt.winnerTeam],
      nowLevel: evt.newLevels[evt.winnerTeam],
      finishOrder: prev.finishOrder ?? [],
    },
  };
}

function reduceGameEnd(prev: TableState, evt: GameEndEvent): TableState {
  return {
    ...prev,
    gameEndView: { winnerTeam: evt.winnerTeam, summary: evt.summary },
  };
}

function reduceSnapshot(
  prev: TableState,
  evt: SnapshotEvent,
  myHandle: PlayerHandle
): TableState {
  const players = new Map(evt.players.map((p) => [p.id, p]));
  const me = evt.players.find((p) => handlesEqual(p.handle, myHandle));
  // Rebuild the visible trick from the snapshot — backlog events at or below
  // snapshotVersion are skipped by reduceEvent, so without this a reload
  // mid-trick would show an empty center.
  const lastEntry = evt.table.currentTrick[evt.table.currentTrick.length - 1];
  const myTeam = evt.you.teamId;
  const level = evt.table.teamLevels[myTeam];
  let lastPlayed = prev.lastPlayed;
  if (lastEntry) {
    const cards = decodeHand(lastEntry.cards);
    const reading = analyzeHand(cards, level);
    lastPlayed = {
      player: players.get(lastEntry.player)?.handle ?? lastEntry.player,
      cards,
      combinationLabel: reading?.kind ?? '',
    };
  }
  return {
    ...prev,
    myHand: decodeHand(evt.you.hand),
    players,
    seatOrder: evt.players.map((p) => p.id),
    teamLevels: { t1: evt.table.teamLevels.t1, t2: evt.table.teamLevels.t2 },
    currentTurn: evt.table.currentTurn,
    myPlayerId: me?.id ?? evt.you.playerId,
    myTeam,
    lastPlayed,
    snapshotVersion: evt.version,
    roundOwner: evt.table.roundOwner,
    turnDeadline: evt.table.turnDeadline ?? prev.turnDeadline ?? null,
    roundNumber: evt.roundNumber ?? prev.roundNumber,
    teamAFails: evt.teamAFails ?? prev.teamAFails ?? null,
  };
}

function reduceDeal(prev: TableState, evt: DealEvent): TableState {
  // Reset public hand counts from the deal — counts are tracked by decrement
  // on move_played, so a full-backlog replay must restart each count from
  // the dealt size or the arithmetic drifts.
  const players = new Map(prev.players);
  for (const [id, count] of Object.entries(evt.publicHandCounts ?? {})) {
    const p = players.get(id);
    if (p) players.set(id, { ...p, handCount: count });
  }
  return {
    ...prev,
    players,
    myHand: decodeHand(evt.yourHand),
    lastPlayed: null,
    finishOrder: [],
    roundOwner: evt.roundOwner,
    // The deal names the new round's first leader — without this currentTurn
    // is stale from the previous round and the leader's buttons stay locked.
    currentTurn: evt.leader ?? prev.currentTurn,
    tribute: null,
    roundNumber: prev.roundNumber + 1,
  };
}

function reduceTributePending(prev: TableState, evt: TributePendingEvent): TableState {
  const snapshot: TributePendingSnapshot = {
    direction: evt.direction,
    obligations: evt.obligations,
  };
  if (evt.yourOwedCard !== undefined) {
    snapshot.yourOwedCard = evt.yourOwedCard;
  }
  return { ...prev, tribute: snapshot };
}

function reduceTributeResolved(prev: TableState, evt: TributeResolvedEvent): TableState {
  // Capture a transient notice — in AUTO mode pending+resolved arrive in the
  // same burst, so without this the tribute is completely invisible. See 4P.
  const exchanged = (evt.exchanged ?? []).map((x) => ({
    fromHandle: prev.players.get(x.from)?.handle ?? x.from,
    toHandle: prev.players.get(x.to)?.handle ?? x.to,
    card: decodeCardId(x.card),
  }));
  return {
    ...prev,
    tribute: null,
    tributeNotice: exchanged.length > 0 ? { key: evt.version, exchanged } : (prev.tributeNotice ?? null),
  };
}

function reduceRoomJoined(prev: TableState, evt: RoomJoinedEvent): TableState {
  const players = new Map(prev.players);
  players.set(evt.player.id, evt.player);
  const seatOrder = prev.seatOrder.includes(evt.player.id)
    ? prev.seatOrder
    : [...prev.seatOrder, evt.player.id];
  return { ...prev, players, seatOrder };
}

function reduceRoomLeft(prev: TableState, evt: RoomLeftEvent): TableState {
  const players = new Map(prev.players);
  players.delete(evt.playerId);
  return {
    ...prev,
    players,
    seatOrder: prev.seatOrder.filter((id) => id !== evt.playerId),
  };
}

function reduceMovePlayed(prev: TableState, evt: MovePlayedEvent): TableState {
  const author = prev.players.get(evt.player);
  const handle = author?.handle ?? evt.player;
  const isMe = evt.player === prev.myPlayerId;
  const newHand = isMe ? removeCards(prev.myHand, evt.cards) : prev.myHand;
  const players = new Map(prev.players);
  let finishOrder = prev.finishOrder ?? [];
  if (author) {
    const newCount = Math.max(0, author.handCount - evt.cards.length);
    players.set(evt.player, { ...author, handCount: newCount });
    // Player just emptied their hand → record their finish position (the
    // round_end event only names the winning team).
    if (newCount === 0 && !finishOrder.some((f) => f.id === evt.player)) {
      finishOrder = [...finishOrder, { id: evt.player, handle }];
    }
  }
  return {
    ...prev,
    myHand: newHand,
    players,
    finishOrder,
    currentTurn: evt.nextTurn,
    turnDeadline: evt.turnDeadline ?? prev.turnDeadline ?? null,
    lastPlayed: {
      player: handle,
      cards: decodeHand(evt.cards),
      combinationLabel: evt.combinationLabel,
    },
  };
}

function reduceMovePassed(prev: TableState, evt: MovePassedEvent): TableState {
  return {
    ...prev,
    currentTurn: evt.nextTurn,
    turnDeadline: evt.turnDeadline ?? prev.turnDeadline ?? null,
  };
}

function reduceTrickWon(prev: TableState, evt: TrickWonEvent): TableState {
  return { ...prev, currentTurn: evt.nextLeader, lastPlayed: null };
}

/**
 * Pick the TributeModal substate for the local player given the pending
 * snapshot. Mirrors the 4P logic but generalizes to multi-pair sweep (3 or 4
 * obligations).
 *
 * Mapping:
 *  - direction='anti_tribute' + losing team → render anti-tribute banner
 *    (dismiss callback dispatches anti_tribute command).
 *  - direction in {single, double, sweep} + me as `from` → render pending
 *    (candidates = all my non-wildcard cards; server enforces "highest" rule).
 *    progressLabel shows "i/N" when multiple obligations exist (sweep always
 *    has >1, so this surfaces for every sweep-tribute obligation).
 *  - direction in {single, double, sweep} + me as `to` + yourOwedCard set →
 *    render auto display (legacy auto path).
 *  - otherwise → null (third-party watch state).
 *
 * Exported for unit testing.
 */
export function buildTributeModalState(
  snapshot: TributePendingSnapshot | null,
  myHand: readonly GameCard[],
  myPlayerId: string | null,
  myTeam: TeamKey | null,
  players: Map<string, PlayerSummary>,
  levelRank: LevelRank,
  roundNumber: number,
  lastRoundWinnerTeam: TeamKey | null = null,
): TributeState | null {
  if (!snapshot || !myPlayerId) return null;

  if (snapshot.direction === 'anti_tribute') {
    if (myTeam === null) return null;
    // Round 2 IMPORTANT-2 fix: server validates `declarerTeam !== winnerTeam`,
    // NOT joker ownership. Use the winning team captured from the preceding
    // round_end event to gate canDeclare. Falls back to red-joker heuristic
    // when winnerTeam is unknown (defensive — snapshot-only resume that missed
    // the round_end event).
    const holderHandle = players.get(myPlayerId)?.handle ?? myPlayerId;
    const canDeclare =
      lastRoundWinnerTeam !== null
        ? myTeam !== lastRoundWinnerTeam
        : handHoldsRedJoker(myHand);
    return {
      kind: 'anti-tribute',
      holderHandle,
      roundNumber,
      canDeclare,
    };
  }

  // single / double / sweep — check my role in obligations.
  const mineIdx = snapshot.obligations.findIndex((o) => o.from === myPlayerId);
  if (mineIdx >= 0) {
    const mine = snapshot.obligations[mineIdx]!;
    const candidateKeys = new Set<string>();
    for (const card of myHand) {
      const isWildcard = card.suit === 'hearts' && card.rank === levelRank;
      if (!isWildcard) candidateKeys.add(cardKey(card));
    }
    const winnerHandle = players.get(mine.to)?.handle ?? mine.to;
    const loserHandle = players.get(myPlayerId)?.handle ?? myPlayerId;
    const progress =
      snapshot.obligations.length > 1
        ? `${mineIdx + 1}/${snapshot.obligations.length}`
        : undefined;
    return {
      kind: 'pending',
      loserHandle,
      winnerHandle,
      hand: myHand,
      candidateKeys,
      roundNumber,
      ...(progress !== undefined ? { progressLabel: progress } : {}),
      countdownSeconds: 30,
    };
  }

  const owed = snapshot.yourOwedCard;
  if (owed !== undefined) {
    const card = decodeCardId(owed);
    const obl = snapshot.obligations.find((o) => o.to === myPlayerId);
    const fromHandle = obl ? (players.get(obl.from)?.handle ?? obl.from) : '末游';
    const toHandle = players.get(myPlayerId)?.handle ?? myPlayerId;
    return { kind: 'auto', fromHandle, toHandle, card, roundNumber };
  }

  return null;
}

function cardKey(c: GameCard): string {
  return `${c.rank}-${c.suit}-${c.deck}`;
}

/**
 * True when the hand holds at least one red joker. Used as a heuristic for
 * losing-team membership during anti-tribute (mirrors GameTable4P).
 */
export function handHoldsRedJoker(hand: readonly GameCard[]): boolean {
  return hand.some((c) => c.suit === 'joker' && c.rank === 'RJ');
}

/**
 * Mirrors GameTable4P.shouldClearSelectedOnEvent — clears selected indices
 * on hand-replacing events (deal/snapshot/round_end) AND my own move_played.
 * F-C2 fix: previously a move_played by me left stale indices pointing into
 * a now-shorter hand, which silently corrupted the next play.
 */
export function shouldClearSelectedOnEvent(
  evt: ServerEvent,
  myPlayerId: string | null,
): boolean {
  if (evt.type === 'deal' || evt.type === 'snapshot' || evt.type === 'round_end') {
    return true;
  }
  if (evt.type === 'move_played' && evt.player === myPlayerId) {
    return true;
  }
  return false;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function teamRing(team: TeamKey | undefined | null): 'A' | 'B' | 'C' | 'D' {
  // For 4-team modes (6P / 8P), the server still uses t1/t2 binary teams. UI
  // visualizes them as A/B for now; ROOM-2 will extend to multi-team. Map
  // t1→A, t2→B; per-player teamId from SnapshotEvent is the source of truth.
  if (team === 't1') return 'A';
  if (team === 't2') return 'B';
  return 'A';
}

function encodeCard(card: GameCard | undefined): string | null {
  if (!card) return null;
  if (card.suit === 'joker') return `${card.rank}-J-${card.deck}`;
  const suitLetter =
    card.suit === 'spades' ? 'S' : card.suit === 'hearts' ? 'H' : card.suit === 'clubs' ? 'C' : 'D';
  return `${card.rank}-${suitLetter}-${card.deck}`;
}

function removeCards(hand: readonly GameCard[], played: readonly CardId[]): GameCard[] {
  const playedSet = new Set(played);
  return hand.filter((c) => !playedSet.has(encodeCard(c) ?? ''));
}


function CardGlyph({ card }: { card: GameCard }): React.JSX.Element {
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  const sym =
    card.suit === 'spades'
      ? '♠'
      : card.suit === 'hearts'
        ? '♥'
        : card.suit === 'clubs'
          ? '♣'
          : card.suit === 'diamonds'
            ? '♦'
            : '★';
  return (
    <div className={`card card--md ${isRed ? 'card--red' : ''}`}>
      <span className="card__rank">{card.rank}</span>
      <span className="card__suit">{sym}</span>
      <span className="card__center">{sym}</span>
    </div>
  );
}
