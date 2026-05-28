// GameTable4P — wireframe S03 made dynamic.
//
// Subscribes to /api/sse/[roomId], maintains a minimal game state from the
// stream of ServerEvents, and renders the 4-player landscape layout with:
//   - top: room/level HUD
//   - center: partner pill + left/right rivals + center trick
//   - bottom: my hand (fanned) + 4 action buttons
//
// Card-level interactions (lift/select), play submission, and pass post to
// /api/room/[code]/move. Optimistic-version fromVersion tracks the lastVersion
// surfaced by the SSE client.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Hand } from '@/components/Hand';
import { Trick } from '@/components/Trick';
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
import { TributeModal, type TributeState } from '@/screens/TributeModal';
import { ExchangeVoteModal } from '@/screens/ExchangeVoteModal';
import { ExchangeSelectModal } from '@/screens/ExchangeSelectModal';

/**
 * EXCHANGE-1 client UI state. Set by the exchange_* events, cleared once the
 * exchange resolves. `vote` is shown only to losing-team voters; `select` is
 * shown to all players once the vote passes.
 */
export type ExchangeUiState =
  | { phase: 'vote'; losers: string[]; cardCount: number }
  | { phase: 'select'; cardCount: number; direction: 'cw' | 'ccw' };

export interface GameTable4PProps {
  roomId: string;
  /** Bearer token returned by POST /api/room/[code]/join. */
  joinToken: string;
  /** Local player handle (e.g., '@阿祥'). */
  myHandle: PlayerHandle;
  /** Optional fromVersion for resume. */
  fromVersion?: number;
}

interface PlayedLine {
  player: string;
  cards: GameCard[];
  combinationLabel: string;
}

interface TableState {
  myHand: GameCard[];
  players: Map<string, PlayerSummary>;
  teamLevels: Record<TeamKey, LevelRank>;
  currentTurn: string | null;
  lastPlayed: PlayedLine | null;
  myPlayerId: string | null;
  myTeam: TeamKey | null;
  partnerId: string | null;
  /**
   * Manual-tribute UI state. Set by `tribute_pending` and cleared by
   * `tribute_resolved`. Null when no tribute is in flight.
   *
   * Each obligation snapshot lets the UI tell whether I owe a card, expect
   * to receive one, or am eligible to declare anti-tribute.
   */
  tribute: TributePendingSnapshot | null;
  /** Monotonic round counter — bumped on each `deal` event so TributeModal
   *  can render an eyebrow ("第 N 局") without separate state. */
  roundNumber: number;
  /**
   * Winning team of the most-recent round_end event. Used by
   * `buildTributeModalState` to decide canDeclare on anti_tribute — the server
   * validates `declarerTeam !== winnerTeam` (NOT joker ownership), so the
   * losing-team partner WITHOUT a red joker is also eligible.
   *
   * Round 2 IMPORTANT-2 fix.
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
  teamLevels: { t1: '2', t2: '2' },
  currentTurn: null,
  lastPlayed: null,
  myPlayerId: null,
  myTeam: null,
  partnerId: null,
  tribute: null,
  roundNumber: 1,
  lastRoundWinnerTeam: null,
  exchange: null,
};

function decodeHand(ids: readonly CardId[]): GameCard[] {
  return ids.map(decodeCardId);
}

export function GameTable4P({
  roomId,
  joinToken,
  myHandle,
  fromVersion,
}: GameTable4PProps): React.JSX.Element {
  const [state, setState] = useState<TableState>(EMPTY_STATE);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [version, setVersion] = useState<number>(fromVersion ?? 0);
  const [connectionState, setConnectionState] = useState<'connecting' | 'live' | 'closed'>('connecting');
  // Local display-order overlay for 理牌. Null = render state.myHand verbatim;
  // non-null = render this reordered copy. Reset to null on any hand-replacing
  // event (see clearOverlaysOnEvent) so it never points at stale cards.
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
  // Mirror of state.myPlayerId so the SSE callback (created once per mount)
  // can decide whether a `move_played` event was mine without closing over
  // stale state. setState's functional updater inside the callback already
  // gives us fresh state, but the surrounding clear-selected logic runs in
  // the outer closure where `state` would be stale.
  const myPlayerIdRef = useRef<string | null>(null);
  useEffect(() => {
    myPlayerIdRef.current = state.myPlayerId;
  }, [state.myPlayerId]);

  // Open SSE on mount; close on unmount.
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

  const seats = useMemo(() => splitSeats(state, myHandle), [state, myHandle]);
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
    <div className="table" role="application" aria-label="4-player game table">
      <div className="table-top">
        <div className="table-top-left">
          <span className="table-top-key mono">ROOM</span>
          <span className="table-top-val mono">{roomId}</span>
          <span className="chip chip--live mono">
            {connectionState === 'live' ? 'LIVE' : connectionState === 'connecting' ? 'SYNC' : 'DC'}
          </span>
        </div>
        <div className="table-top-right">
          <span className="table-top-key mono">我方</span>
          <span className="table-top-val tnum mono">LV <em>{myLevel}</em></span>
          <span className="table-top-key mono" style={{ color: 'var(--rule-3)' }}>vs</span>
          <span className="table-top-key mono">对方</span>
          <span className="table-top-val tnum mono">LV {oppLevel}</span>
        </div>
      </div>

      <div className="table-arena">
        {seats.partner && (
          <div className="seat-partner">
            <Avatar handle={seats.partner.handle} role="partner" size="sm" />
            <span className="seat-name mono">
              {seats.partner.handle}
              <PlayerStatusBadge status={seats.partner.status} />
            </span>
            <span className="seat-count tnum mono">{seats.partner.handCount} 张</span>
          </div>
        )}

        <div className="seat">
          {seats.left && (
            <>
              <Avatar
                handle={seats.left.handle}
                role="rival-1"
                size="md"
                active={state.currentTurn === seats.left.id}
              />
              <span className="seat-name mono">
                {seats.left.handle}
                <PlayerStatusBadge status={seats.left.status} />
              </span>
              <span className="seat-lvl tnum mono">LV {oppLevel}</span>
              <span className="seat-count tnum mono">{seats.left.handCount} 张</span>
              <ReportButton
                targetHandle={seats.left.handle}
                gameId={roomId}
                onSubmit={(s) => submitReport(s.targetHandle, s.reason)}
              />
            </>
          )}
        </div>

        <Trick
          cards={state.lastPlayed?.cards ?? []}
          authorHandle={state.lastPlayed?.player}
          patternLabel={state.lastPlayed?.combinationLabel}
          levelRank={myLevel}
        />

        <div className="seat">
          {seats.right && (
            <>
              <Avatar
                handle={seats.right.handle}
                role="rival-2"
                size="md"
                active={state.currentTurn === seats.right.id}
              />
              <span className="seat-name mono">
                {seats.right.handle}
                <PlayerStatusBadge status={seats.right.status} />
              </span>
              <span className="seat-lvl tnum mono">LV {oppLevel}</span>
              <span className="seat-count tnum mono">{seats.right.handCount} 张</span>
              <ReportButton
                targetHandle={seats.right.handle}
                gameId={roomId}
                onSubmit={(s) => submitReport(s.targetHandle, s.reason)}
              />
            </>
          )}
        </div>
      </div>

      <div className="table-bot">
        <div className="my-hand-wrap">
          <div className="my-hand-meta mono">
            <span>我 · <em>{myHandle}</em> · {displayHand.length} 张</span>
            <span>红心通配 ★ · 钢板可</span>
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
        </div>
        <div className="actions">
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

      {tributeModalState && (
        <TributeModal
          state={tributeModalState}
          onConfirm={(card) => void submitTributeSelect(card)}
          onDismiss={() => void submitAntiTribute()}
        />
      )}

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

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for testing)
// ─────────────────────────────────────────────────────────────────────────────

export function reduceEvent(
  prev: TableState,
  evt: ServerEvent,
  myHandle: PlayerHandle,
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
  // Track the winning team so the next tribute_pending (anti_tribute) can
  // gate `canDeclare` on team membership rather than red-joker ownership.
  // Update teamLevels too — the server emits newLevels with the post-round
  // upgrade applied.
  return {
    ...prev,
    lastRoundWinnerTeam: evt.winnerTeam,
    teamLevels: { t1: evt.newLevels.t1, t2: evt.newLevels.t2 },
  };
}

function reduceSnapshot(prev: TableState, evt: SnapshotEvent, myHandle: PlayerHandle): TableState {
  const players = new Map(evt.players.map((p) => [p.id, p]));
  const me = evt.players.find((p) => p.handle === myHandle);
  return {
    ...prev,
    myHand: decodeHand(evt.you.hand),
    players,
    teamLevels: { t1: evt.table.teamLevels.t1, t2: evt.table.teamLevels.t2 },
    currentTurn: evt.table.currentTurn,
    myPlayerId: me?.id ?? evt.you.playerId,
    myTeam: evt.you.teamId,
    partnerId: evt.you.partnerId,
    lastPlayed: prev.lastPlayed,
  };
}

function reduceDeal(prev: TableState, evt: DealEvent): TableState {
  return {
    ...prev,
    myHand: decodeHand(evt.yourHand),
    lastPlayed: null,
    // A `deal` event closes any prior tribute (round transition has finished).
    // Auto-mode emits tribute_resolved BEFORE deal; manual mode emits
    // tribute_pending BEFORE deal and tribute_resolved later. Either way,
    // the new round opens with no in-flight tribute state UNLESS the next
    // tribute_pending fires right after this deal — and the reducer is
    // strictly event-by-event, so a follow-up tribute_pending will set it.
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
  // The server has applied the swap and started the trick. Clear the modal
  // so the table is interactive again. Subsequent `move_played` will refresh
  // the player's hand counts; their own `deal` already gave them the hand
  // pre-swap, so we don't try to splice the received card in here — the
  // next play / pass round-trip will re-sync via the normal move events.
  return { ...prev, tribute: null };
}

function reduceRoomJoined(prev: TableState, evt: RoomJoinedEvent): TableState {
  const players = new Map(prev.players);
  players.set(evt.player.id, evt.player);
  return { ...prev, players };
}

function reduceRoomLeft(prev: TableState, evt: RoomLeftEvent): TableState {
  const players = new Map(prev.players);
  players.delete(evt.playerId);
  return { ...prev, players };
}

function reduceMovePlayed(prev: TableState, evt: MovePlayedEvent): TableState {
  const author = prev.players.get(evt.player);
  const handle = author?.handle ?? evt.player;
  const isMe = evt.player === prev.myPlayerId;
  const newHand = isMe ? removeCards(prev.myHand, evt.cards) : prev.myHand;
  const players = new Map(prev.players);
  if (author) {
    players.set(evt.player, { ...author, handCount: Math.max(0, author.handCount - evt.cards.length) });
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

interface SeatLayout {
  partner: PlayerSummary | null;
  left: PlayerSummary | null;
  right: PlayerSummary | null;
}

/**
 * Map players into the 4P landscape layout positions relative to the local
 * player. Order: me bottom, partner top (12 o'clock), rivals on left
 * (9 o'clock) and right (3 o'clock).
 *
 * Previous implementation iterated `state.players.values()` (Map insertion
 * order) and took `rivals[0]`/`rivals[1]` as left/right — which gave wrong
 * placement depending on whether the local player sat at index 0 vs 2 (the
 * two rivals swap clock positions relative to me). The fix walks the seat
 * order from my index forward: the next seat CW is partner across the
 * table; the immediate next seat in `players` (CW from me) is the rival
 * on my LEFT, and the previous seat (CCW from me) is the rival on my RIGHT.
 *
 * Holds even when partnerId is null (snapshot incomplete) — partner falls
 * back to the N/2-offset seat per assignSeats' alternating-team contract.
 */
export function splitSeats(state: TableState, myHandle: PlayerHandle): SeatLayout {
  const all = [...state.players.values()];
  if (all.length === 0) return { partner: null, left: null, right: null };
  const myIndex = all.findIndex((p) => p.handle === myHandle);
  if (myIndex < 0) return { partner: null, left: null, right: null };

  const N = all.length;
  // Partner: prefer the explicit partnerId from the snapshot when set;
  // otherwise fall back to the player N/2 seats away (alternating-team
  // assumption from server-side assignSeats).
  let partner: PlayerSummary | null = null;
  if (state.partnerId) {
    partner = all.find((p) => p.id === state.partnerId) ?? null;
  }
  if (!partner && N >= 2) {
    partner = all[(myIndex + Math.floor(N / 2)) % N] ?? null;
  }

  // Rivals at the seats immediately CW (left, visually) and CCW (right) of
  // me, skipping over the partner if they happen to be on either side
  // (only relevant for N=4 when partner sits directly across).
  const cwRivals: PlayerSummary[] = [];
  const ccwRivals: PlayerSummary[] = [];
  for (let step = 1; step < N; step++) {
    const cwIdx = (myIndex + step) % N;
    const cwSeat = all[cwIdx];
    if (cwSeat && cwSeat.id !== partner?.id) cwRivals.push(cwSeat);
    const ccwIdx = (myIndex - step + N) % N;
    if (ccwIdx !== cwIdx) {
      const ccwSeat = all[ccwIdx];
      if (ccwSeat && ccwSeat.id !== partner?.id) ccwRivals.push(ccwSeat);
    }
  }
  return {
    partner: partner ?? null,
    left: cwRivals[0] ?? null,
    right: ccwRivals[0] ?? null,
  };
}

function encodeCard(card: GameCard | undefined): string | null {
  if (!card) return null;
  if (card.suit === 'joker') return `${card.rank}-J-${card.deck}`;
  const suitLetter = card.suit === 'spades' ? 'S' : card.suit === 'hearts' ? 'H' : card.suit === 'clubs' ? 'C' : 'D';
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

/**
 * Pick the TributeModal substate to render for the local player given the
 * pending snapshot from the wire. Returns null when this player has nothing
 * to do (e.g., a third-party watching) — the table stays interactive.
 *
 * Mapping:
 *  - direction='anti_tribute' + losing team → render `anti-tribute` (with
 *    onDismiss bound to dispatching anti_tribute).
 *  - direction in {single, double} + me as `from` → render `pending` (I
 *    must pick a card; candidates = highest-rank non-wildcard from my hand).
 *  - direction in {single, double} + me as `to` + yourOwedCard set →
 *    render `auto` display showing the card I'm receiving (legacy auto-
 *    mode path; manual mode never sets yourOwedCard, so this branch only
 *    fires for AUTO).
 *  - otherwise → null (watch state).
 *
 * Exported for unit testing.
 *
 * `lastRoundWinnerTeam` is captured from the most-recent `round_end` event.
 * Used to gate canDeclare on team membership rather than red-joker ownership
 * (Round 2 IMPORTANT-2 fix). When null (no round_end seen yet, defensive
 * for snapshot-only resume), falls back to red-joker heuristic so the
 * scenario where only one joker-holder can declare is at least handled.
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

  // Anti-tribute (resist) — render the informational banner to anyone with a
  // team. The explicit "我们抗贡" dispatch CTA is gated to losing-team
  // players via `canDeclare`.
  //
  // Round 2 IMPORTANT-2 fix: the server validates `declarerTeam !== winnerTeam`,
  // NOT joker ownership. Use the winning team captured from the preceding
  // round_end event to gate. Falls back to the red-joker heuristic only when
  // winnerTeam is unknown (defensive — e.g., snapshot-only resume that
  // missed the round_end event).
  if (snapshot.direction === 'anti_tribute') {
    if (myTeam === null) return null;
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

  // Single / double tribute. Check my role in the obligation list.
  const mine = snapshot.obligations.find((o) => o.from === myPlayerId);
  if (mine) {
    // I owe a card. Compute candidate keys — highest-rank non-wildcard
    // entries from my hand. For simplicity, expose all non-wildcard cards
    // as candidates; the server enforces the "highest" rule on submission.
    const candidateKeys = new Set<string>();
    for (const card of myHand) {
      const isWildcard = card.suit === 'hearts' && card.rank === levelRank;
      if (!isWildcard) candidateKeys.add(cardKey(card));
    }
    const winnerHandle = players.get(mine.to)?.handle ?? mine.to;
    const loserHandle = players.get(myPlayerId)?.handle ?? myPlayerId;
    const progress =
      snapshot.obligations.length > 1
        ? `${snapshot.obligations.findIndex((o) => o.from === myPlayerId) + 1}/${snapshot.obligations.length}`
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

  // I'm a recipient (or third party). Auto path provides yourOwedCard so
  // the recipient sees a preview; manual path doesn't, so recipients fall
  // through to null (they wait silently for the resolved event).
  const owed = snapshot.yourOwedCard;
  if (owed !== undefined) {
    const card = decodeCardId(owed);
    // Find the from -> to obligation that names me as `to`
    const obl = snapshot.obligations.find((o) => o.to === myPlayerId);
    const fromHandle = obl ? (players.get(obl.from)?.handle ?? obl.from) : '末游';
    const toHandle = players.get(myPlayerId)?.handle ?? myPlayerId;
    return {
      kind: 'auto',
      fromHandle,
      toHandle,
      card,
      roundNumber,
    };
  }

  return null;
}

function cardKey(card: GameCard): string {
  return `${card.rank}-${card.suit}-${card.deck}`;
}

/**
 * True when the hand holds at least one red joker (RJ). Used as a heuristic
 * to determine losing-team membership during anti-tribute — the rule trigger
 * is "losing team collectively holds both red jokers", so any individual on
 * the losing team is overwhelmingly likely to be holding ≥1 red joker.
 * Exported for testing.
 */
export function handHoldsRedJoker(hand: readonly GameCard[]): boolean {
  return hand.some((c) => c.suit === 'joker' && c.rank === 'RJ');
}

/**
 * Decide whether an incoming SSE event should reset the selected-cards Set.
 * Clears on (1) any hand-replacing event (deal / snapshot / round_end) and
 * (2) my own move_played — because the surviving indices in selected then
 * point to different cards in the shorter hand, which silently corrupts
 * the next play submission. Exported for testing the F-C2 fix.
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
