// Tribute mode detection (4P).
//
// SYNC: docs/research/game-rules.md § "Tribute (进贡 / 还贡)" lines ~196-254.
// Determines whether the upcoming round opens with single tribute, double
// tribute, or 抗贡 (resist) based on the previous round's finish order and
// the freshly-dealt hands.
//
// 4-PLAYER ONLY: 6P/8P tribute rules vary by regional convention and are
// deferred per the same spec lines (~252-253). Caller checks mode before
// dispatching.

import type { Card } from './cards';
import type { PlayerId, PlayerSeat } from './round';
import type { TeamKey } from './mode';

export type TributeMode =
  | { kind: 'none' }
  | { kind: 'single'; from: PlayerId; to: PlayerId }
  | { kind: 'double'; obligations: { from: PlayerId; to: PlayerId }[] }
  | { kind: 'resist' };

export function detectTributeMode4P(
  finishOrder: readonly PlayerId[],
  seats: readonly PlayerSeat[],
  hands: Readonly<Record<PlayerId, readonly Card[]>>
): TributeMode {
  if (finishOrder.length !== 4) {
    throw new Error(
      `detectTributeMode4P: finishOrder must have 4 entries, got ${finishOrder.length}`
    );
  }
  if (seats.length !== 4) {
    throw new Error(`detectTributeMode4P: 4 seats required, got ${seats.length}`);
  }

  const seatById = new Map(seats.map((s) => [s.id, s]));
  const teamOf = (id: PlayerId): TeamKey => seatById.get(id)!.team;

  const [first, second, third, fourth] = finishOrder as [
    PlayerId,
    PlayerId,
    PlayerId,
    PlayerId,
  ];
  const winnerTeam = teamOf(first);

  // Identify each finisher's team
  const losers: PlayerId[] = [second, third, fourth].filter(
    (id) => teamOf(id) !== winnerTeam
  );
  const winners: PlayerId[] = [first, second, third, fourth].filter(
    (id) => teamOf(id) === winnerTeam
  );

  // 4P invariants: 2 winners, 2 losers.
  if (winners.length !== 2 || losers.length !== 2) {
    throw new Error(
      `detectTributeMode4P: expected 2 winners and 2 losers, got ${winners.length}/${losers.length}`
    );
  }

  // Determine single vs double by where 2nd place sits.
  // Double tribute (1,2): the 2nd-place player is on the winning team.
  // Single tribute (1,3) or (1,4): 2nd-place is on the losing team.
  const isDouble = teamOf(second) === winnerTeam;

  // 抗贡 (resist): collectively the losing team must hold BOTH RJs.
  if (countRJsHeldBy(losers, hands) === 2) {
    return { kind: 'resist' };
  }

  if (isDouble) {
    // 末游 (4th) tributes to 头游 (1st). The other loser (3rd) tributes to 二游 (2nd).
    const obligations: { from: PlayerId; to: PlayerId }[] = [
      { from: fourth, to: first },
      { from: third, to: second },
    ];
    return { kind: 'double', obligations };
  }

  // Single tribute: 4th place tributes to 1st place.
  return { kind: 'single', from: fourth, to: first };
}

function countRJsHeldBy(
  players: readonly PlayerId[],
  hands: Readonly<Record<PlayerId, readonly Card[]>>
): number {
  let rj = 0;
  for (const id of players) {
    const hand = hands[id] ?? [];
    for (const card of hand) {
      if (card.rank === 'RJ') rj++;
    }
  }
  return rj;
}
