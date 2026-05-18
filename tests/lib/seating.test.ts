import { describe, it, expect } from 'vitest';
import {
  seatPositionsForMode,
  assignClockPositions,
  SEATS_6P,
  SEATS_8P,
} from '@/lib/seating';

describe('seatPositionsForMode', () => {
  it('returns 3 positions for 4P', () => {
    expect(seatPositionsForMode('4')).toHaveLength(3);
  });
  it('returns 5 positions for 6P', () => {
    expect(seatPositionsForMode('6')).toHaveLength(5);
  });
  it('returns 7 positions for 8P', () => {
    expect(seatPositionsForMode('8')).toHaveLength(7);
  });
  it('first position is always 12 o\'clock (across-table partner seat)', () => {
    expect(seatPositionsForMode('4')[0]?.clock).toBe('12');
    expect(seatPositionsForMode('6')[0]?.clock).toBe('12');
    expect(seatPositionsForMode('8')[0]?.clock).toBe('12');
  });
});

describe('assignClockPositions', () => {
  it('returns empty when me is not in the player list', () => {
    const players = [{ id: 'p0' }, { id: 'p1' }];
    expect(assignClockPositions('4', players, 'pX')).toEqual([]);
  });

  it('drops the local player from the returned list (4P)', () => {
    const players = [{ id: 'p0' }, { id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    const result = assignClockPositions('4', players, 'p0');
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.player.id)).not.toContain('p0');
  });

  it('places partner at 12 o\'clock in 4P (alternating teams)', () => {
    // 4P with p0/p2 = team A, p1/p3 = team B. Partner of p0 is p2.
    const players = [{ id: 'p0' }, { id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    const result = assignClockPositions('4', players, 'p0');
    expect(result[0]?.player.id).toBe('p2'); // partner across
    expect(result[0]?.position.clock).toBe('12');
  });

  it('places partner at 12 o\'clock in 6P', () => {
    // 6P with alternating teams: partner is 3 seats away (N/2 = 3).
    const players = [
      { id: 'p0' }, { id: 'p1' }, { id: 'p2' },
      { id: 'p3' }, { id: 'p4' }, { id: 'p5' },
    ];
    const result = assignClockPositions('6', players, 'p0');
    expect(result).toHaveLength(5);
    expect(result[0]?.player.id).toBe('p3');
    expect(result[0]?.position.clock).toBe('12');
  });

  it('places partner at 12 o\'clock in 8P', () => {
    // 8P: partner is 4 seats away.
    const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}` }));
    const result = assignClockPositions('8', players, 'p0');
    expect(result).toHaveLength(7);
    expect(result[0]?.player.id).toBe('p4');
    expect(result[0]?.position.clock).toBe('12');
  });

  it('all returned positions map to distinct screen coordinates', () => {
    const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}` }));
    const result = assignClockPositions('8', players, 'p0');
    const coords = new Set(result.map((r) => `${r.position.left},${r.position.top}`));
    expect(coords.size).toBe(result.length);
  });

  it('6P positions span the canonical clock pattern', () => {
    // Pull just the clock labels — should match 12, 1:45, 4:30, 7:30, 10:15 in some order.
    const clocks = SEATS_6P.map((p) => p.clock).sort();
    expect(clocks).toEqual(['10:15', '12', '1:45', '4:30', '7:30']);
  });

  it('8P positions span the canonical clock pattern', () => {
    const clocks = SEATS_8P.map((p) => p.clock).sort();
    expect(clocks).toEqual(['10:30', '12', '1:30', '3', '4:30', '7:30', '9']);
  });
});
