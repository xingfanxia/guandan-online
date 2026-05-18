// Seating math for 4P / 6P / 8P landscape tables.
//
// Each mode has a fixed clock pattern around the oval felt; the local player
// is always at 6 o'clock (the hand region at the bottom of the phone). This
// module is purely positional — pixel coordinates within the 852×393 phone
// frame's table-arena box, anchored at clock positions matched to demos
// S03 / S05 / S06.
//
// The opponents array is in seat-index order (server-assigned). The mapping
// rotates the array so the local player drops out (we render them in the
// bottom hand region instead) and the remaining N-1 players take clock
// positions in clockwise order starting from 12 o'clock CW.

export type TableMode = '4' | '6' | '8';

export interface SeatPosition {
  /** Pixel offset from the arena's top-left. */
  readonly left: number;
  readonly top: number;
  /** Clock-time label (12 / 1:30 / 3 ... / 10:30). */
  readonly clock: string;
}

/** Positions for opponents in 6P mode. 5 seats around the oval. */
export const SEATS_6P: readonly SeatPosition[] = [
  { left: 416, top: 30, clock: '12' },     // partner (across)
  { left: 675, top: 105, clock: '1:45' },  // top-right
  { left: 614, top: 175, clock: '4:30' },  // bottom-right
  { left: 218, top: 175, clock: '7:30' },  // bottom-left
  { left: 157, top: 105, clock: '10:15' }, // top-left
];

/** Positions for opponents in 8P mode. 7 seats around the oval. */
export const SEATS_8P: readonly SeatPosition[] = [
  { left: 416, top: 30, clock: '12' },     // partner (across)
  { left: 628, top: 65, clock: '1:30' },   // top-right
  { left: 710, top: 125, clock: '3' },     // right
  { left: 628, top: 185, clock: '4:30' },  // bottom-right
  { left: 204, top: 185, clock: '7:30' },  // bottom-left
  { left: 122, top: 125, clock: '9' },     // left
  { left: 204, top: 65, clock: '10:30' },  // top-left
];

/** Positions for opponents in 4P mode (kept for parity). 3 seats. */
export const SEATS_4P: readonly SeatPosition[] = [
  { left: 416, top: 30, clock: '12' },     // partner (across)
  { left: 700, top: 130, clock: '3' },     // right rival
  { left: 132, top: 130, clock: '9' },     // left rival
];

export function seatPositionsForMode(mode: TableMode): readonly SeatPosition[] {
  switch (mode) {
    case '4':
      return SEATS_4P;
    case '6':
      return SEATS_6P;
    case '8':
      return SEATS_8P;
  }
}

/**
 * Map server-assigned seats (in arrival/index order) to clock positions
 * relative to the local player. The local player drops out of the returned
 * list (they render in the bottom hand region) and the remaining N-1 seats
 * take clock positions clockwise from 12 o'clock.
 *
 * Returns an array of { player, position } pairs whose length matches the
 * opponent count for the given mode (3 / 5 / 7).
 */
export function assignClockPositions<P extends { id: string }>(
  mode: TableMode,
  allPlayers: readonly P[],
  meId: string
): ReadonlyArray<{ player: P; position: SeatPosition }> {
  const myIndex = allPlayers.findIndex((p) => p.id === meId);
  if (myIndex < 0) return [];

  // Rotate the array so the local player is at index 0, then drop them.
  // The remaining N-1 players are the opponents in arrival order CCW from
  // my left (which maps to 7:30 → 10:15 → 12 → 1:45 → 4:30 for 6P).
  const rotated: P[] = [];
  for (let i = 1; i < allPlayers.length; i++) {
    const player = allPlayers[(myIndex + i) % allPlayers.length];
    if (player) rotated.push(player);
  }

  const positions = seatPositionsForMode(mode);
  // Layout convention: my partner sits across (12 o'clock = positions[0]),
  // so we want the partner to be at the index that corresponds to the
  // CCW-half-around offset. In 4P that's index 1 (out of 3); in 6P/8P
  // it's the player at `Math.floor((N-1)/2) + 1` rotated index — but
  // since `allPlayers` is in alternating-team order (per startGame.assignSeats),
  // the player directly across is exactly N/2 seats away.
  const N = allPlayers.length;
  const half = N / 2;
  if (Number.isInteger(half) && half >= 1) {
    // Bring the cross-table player to index 0 — they take the 12-o'clock seat.
    // After rotation the player at index `half - 1` (0-indexed offset from me)
    // is the partner. Re-arrange so that partner is first, then everyone else
    // in original CCW order.
    const partnerOffset = half - 1;
    if (partnerOffset > 0 && rotated.length > partnerOffset) {
      const partner = rotated.splice(partnerOffset, 1)[0];
      if (partner) rotated.unshift(partner);
    }
  }

  return rotated.slice(0, positions.length).map((player, i) => ({
    player,
    position: positions[i]!,
  }));
}
