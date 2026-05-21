// GameTableMP — shared 6P / 8P landscape table.
//
// Mounted via App.tsx for mode='6' or '8'. SSE wiring + reducer are extracted
// into `useTableSubscription` so we don't duplicate the 4P implementation.
// Layout differs from 4P: opponents arrange around an oval felt (poker 6-max
// / 9-max conventions) per demos S05 / S06 with the local player at 6 o'clock.
//
// Team coloring uses 4-team rings (A/B/C/D) via .oval-seat__ring--<key> classes.
// Bot players are detected via PlayerSummary.kind === 'bot' and surfaced with
// a small "BOT 难度" chip on their seat.

import { useEffect, useMemo, useState } from 'react';
import { Hand } from '@/components/Hand';
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
import { assignClockPositions, type TableMode } from '@/lib/seating';
import { TributeModal, type TributeState } from '@/screens/TributeModal';

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
                {player.status === 'bot' ? (
                  <span className="oval-seat__bot-chip">BOT</span>
                ) : null}
              </span>
              <span className="oval-seat__meta">
                {teamKey} · {player.handCount} 张
                {isActive ? <em> · 行动中</em> : null}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mtable-bot">
        <div className="mtable-bot__meta">
          <span>
            我 · <em>{myHandle}</em> · {state.myHand.length} 张
            {state.myTeam ? ` · 队 ${teamRing(state.myTeam)}` : ''}
          </span>
          <span>红心通配 ★</span>
        </div>
        <Hand
          cards={state.myHand}
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
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setSelected(new Set())}
          >
            理牌
          </button>
          <button type="button" className="btn btn--accent-soft">
            提示
          </button>
        </div>
      </div>

      {tributeModalState ? (
        <TributeModal
          state={tributeModalState}
          onConfirm={(card) => void submitTributeSelect(card)}
          onDismiss={() => void submitAntiTribute()}
        />
      ) : null}
    </div>
  );
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
    default:
      return prev;
  }
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
): TributeState | null {
  if (!snapshot || !myPlayerId) return null;

  if (snapshot.direction === 'anti_tribute') {
    if (myTeam === null) return null;
    const holderHandle = players.get(myPlayerId)?.handle ?? myPlayerId;
    return { kind: 'anti-tribute', holderHandle, roundNumber };
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
