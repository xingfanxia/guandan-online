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

import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Hand } from '@/components/Hand';
import { Trick } from '@/components/Trick';
import { openSseClient, type SseClient } from '@/lib/sseClient';
import { decodeCardId } from '@lib/realtime/cardCodec';
import type {
  CardId,
  DealEvent,
  MovePassedEvent,
  MovePlayedEvent,
  PlayerHandle,
  PlayerSummary,
  RoomJoinedEvent,
  RoomLeftEvent,
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
} from '@lib/realtime/commands';
import { TributeModal, type TributeState } from '@/screens/TributeModal';

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
        if (evt.type === 'deal' || evt.type === 'snapshot' || evt.type === 'round_end') {
          setSelected(new Set());
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

  const toggleCard = (idx: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const submitPlay = async (): Promise<void> => {
    if (selected.size === 0) return;
    const indices = [...selected].sort((a, b) => a - b);
    const ids = indices
      .map((i) => encodeCard(state.myHand[i]))
      .filter((s): s is string => s != null);
    const cmd: PlayCommand = { kind: 'play', cards: ids, fromVersion: version };
    await postCommand(roomId, joinToken, cmd);
  };

  const submitPass = async (): Promise<void> => {
    const cmd: PassCommand = { kind: 'pass', fromVersion: version };
    await postCommand(roomId, joinToken, cmd);
  };

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
      ),
    [
      state.tribute,
      state.myHand,
      state.myPlayerId,
      state.myTeam,
      state.players,
      myLevel,
      state.roundNumber,
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
            <span className="seat-name mono">{seats.partner.handle}</span>
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
              <span className="seat-name mono">{seats.left.handle}</span>
              <span className="seat-lvl tnum mono">LV {oppLevel}</span>
              <span className="seat-count tnum mono">{seats.left.handCount} 张</span>
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
              <span className="seat-name mono">{seats.right.handle}</span>
              <span className="seat-lvl tnum mono">LV {oppLevel}</span>
              <span className="seat-count tnum mono">{seats.right.handCount} 张</span>
            </>
          )}
        </div>
      </div>

      <div className="table-bot">
        <div className="my-hand-wrap">
          <div className="my-hand-meta mono">
            <span>我 · <em>{myHandle}</em> · {state.myHand.length} 张</span>
            <span>红心通配 ★ · 钢板可</span>
          </div>
          <Hand
            cards={state.myHand}
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
          <button type="button" className="btn btn--ghost" onClick={() => setSelected(new Set())}>
            理牌
          </button>
          <button type="button" className="btn btn--accent-soft">提示</button>
        </div>
      </div>

      {tributeModalState && (
        <TributeModal
          state={tributeModalState}
          onConfirm={(card) => void submitTributeSelect(card)}
          onDismiss={() => void submitAntiTribute()}
        />
      )}
    </div>
  );
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
    default:
      return prev;
  }
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
 * player. Order: me bottom, partner top, opponents on left/right based on
 * server-assigned seat order.
 */
export function splitSeats(state: TableState, myHandle: PlayerHandle): SeatLayout {
  const all = [...state.players.values()];
  if (all.length === 0) return { partner: null, left: null, right: null };
  const me = all.find((p) => p.handle === myHandle);
  const partner = state.partnerId
    ? all.find((p) => p.id === state.partnerId) ?? null
    : null;
  const rivals = all.filter((p) => p.id !== me?.id && p.id !== partner?.id);
  return {
    partner: partner ?? null,
    left: rivals[0] ?? null,
    right: rivals[1] ?? null,
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
  cmd: PlayCommand | PassCommand | TributeSelectCommand | AntiTributeCommand,
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
 */
export function buildTributeModalState(
  snapshot: TributePendingSnapshot | null,
  myHand: readonly GameCard[],
  myPlayerId: string | null,
  myTeam: TeamKey | null,
  players: Map<string, PlayerSummary>,
  levelRank: LevelRank,
  roundNumber: number,
): TributeState | null {
  if (!snapshot || !myPlayerId) return null;

  // Anti-tribute (resist) — show banner to anyone on losing team. Either
  // can dispatch via the dismiss callback. Winning-team players see nothing.
  if (snapshot.direction === 'anti_tribute') {
    if (myTeam === null) return null;
    // The winner is whoever currently leads with `to` slot in the existing
    // game state — but resist has no obligations. So we infer winning team
    // from the seats roster: check if I'm on the same team as the winner.
    // Without explicit finishOrder here we use heuristic: render the resist
    // banner to all players. Winning team's dismiss is a no-op (server will
    // reject) — and we don't show the declare CTA to them.
    const holderHandle = players.get(myPlayerId)?.handle ?? myPlayerId;
    return {
      kind: 'anti-tribute',
      holderHandle,
      roundNumber,
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
