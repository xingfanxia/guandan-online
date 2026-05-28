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
import { openSseClient, type SseClient } from '@/lib/sseClient';
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
  MoveCommand,
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
        setVersion(evt.version);
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

  /**
   * POST the play. Wrapped in measureAndBeacon so each move round-trip emits a
   * latency sample (DEPLOY-2). Beacon failure never disturbs the play.
   */
  const dispatchPlay = async (ids: CardId[]): Promise<void> => {
    const cmd: PlayCommand = { kind: 'play', cards: ids, fromVersion: version };
    await measureAndBeacon(() => postCommand(roomId, joinToken, cmd));
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
    const cmd: PassCommand = { kind: 'pass', fromVersion: version };
    await measureAndBeacon(() => postCommand(roomId, joinToken, cmd));
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

  return (
    <div className="mtable" role="application" aria-label={`${mode}-player game table`}>
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
          </span>
          <span>红心通配 ★</span>
        </div>
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
    </div>
  );
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

export function reduceEvent(
  prev: TableState,
  evt: ServerEvent,
  myHandle: PlayerHandle
): TableState {
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
  };
}

function reduceSnapshot(
  prev: TableState,
  evt: SnapshotEvent,
  myHandle: PlayerHandle
): TableState {
  const players = new Map(evt.players.map((p) => [p.id, p]));
  const me = evt.players.find((p) => p.handle === myHandle);
  return {
    ...prev,
    myHand: decodeHand(evt.you.hand),
    players,
    seatOrder: evt.players.map((p) => p.id),
    teamLevels: { t1: evt.table.teamLevels.t1, t2: evt.table.teamLevels.t2 },
    currentTurn: evt.table.currentTurn,
    myPlayerId: me?.id ?? evt.you.playerId,
    myTeam: evt.you.teamId,
    lastPlayed: prev.lastPlayed,
  };
}

function reduceDeal(prev: TableState, evt: DealEvent): TableState {
  return {
    ...prev,
    myHand: decodeHand(evt.yourHand),
    lastPlayed: null,
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

function reduceTributeResolved(prev: TableState, _evt: TributeResolvedEvent): TableState {
  return { ...prev, tribute: null };
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
  if (author) {
    players.set(evt.player, {
      ...author,
      handCount: Math.max(0, author.handCount - evt.cards.length),
    });
  }
  return {
    ...prev,
    myHand: newHand,
    players,
    currentTurn: evt.nextTurn,
    lastPlayed: {
      player: handle,
      cards: decodeHand(evt.cards),
      combinationLabel: evt.combinationLabel,
    },
  };
}

function reduceMovePassed(prev: TableState, evt: MovePassedEvent): TableState {
  return { ...prev, currentTurn: evt.nextTurn };
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

async function postCommand(
  roomId: string,
  joinToken: string,
  cmd: MoveCommand,
): Promise<void> {
  const url = `/api/room/${encodeURIComponent(roomId)}/move`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${joinToken}`,
    },
    body: JSON.stringify({ ...cmd, moveId: crypto.randomUUID() }),
  });
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
