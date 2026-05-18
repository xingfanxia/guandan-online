import { describe, expect, it } from 'vitest';
import seedrandom from 'seedrandom';
import { generateRoomCode, isValidRoomCode, ROOM_CODE_ALPHABETS } from '@lib/room/code';

describe('generateRoomCode — format', () => {
  it('returns a 6-character code', () => {
    const code = generateRoomCode(Math.random);
    expect(code).toHaveLength(6);
  });

  it('alternates letters and digits: positions 0,2,4 are letters; 1,3,5 are digits', () => {
    const code = generateRoomCode(seedrandom('alternation'));
    expect(ROOM_CODE_ALPHABETS.letters).toContain(code[0]);
    expect(ROOM_CODE_ALPHABETS.digits).toContain(code[1]);
    expect(ROOM_CODE_ALPHABETS.letters).toContain(code[2]);
    expect(ROOM_CODE_ALPHABETS.digits).toContain(code[3]);
    expect(ROOM_CODE_ALPHABETS.letters).toContain(code[4]);
    expect(ROOM_CODE_ALPHABETS.digits).toContain(code[5]);
  });
});

describe('generateRoomCode — ambiguity-safe alphabet', () => {
  it('letters alphabet excludes I, O, Z (look-alikes for 1, 0, 2)', () => {
    expect(ROOM_CODE_ALPHABETS.letters).not.toContain('I');
    expect(ROOM_CODE_ALPHABETS.letters).not.toContain('O');
    expect(ROOM_CODE_ALPHABETS.letters).not.toContain('Z');
  });

  it('digits alphabet excludes 0, 1 (look-alikes for O, I)', () => {
    expect(ROOM_CODE_ALPHABETS.digits).not.toContain('0');
    expect(ROOM_CODE_ALPHABETS.digits).not.toContain('1');
  });

  it('generated codes never contain banned characters', () => {
    const banned = ['0', '1', 'I', 'O', 'Z'];
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode(seedrandom(`iter-${i}`));
      for (const ch of code) {
        expect(banned).not.toContain(ch);
      }
    }
  });
});

describe('generateRoomCode — determinism + diversity', () => {
  it('same seed → same code', () => {
    const a = generateRoomCode(seedrandom('seed-x'));
    const b = generateRoomCode(seedrandom('seed-x'));
    expect(a).toBe(b);
  });

  it('different seeds → typically different codes (sample 50)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      codes.add(generateRoomCode(seedrandom(`diversity-${i}`)));
    }
    // With 23 letters × 8 digits × 23 × 8 × 23 × 8 ≈ 6.2M codes, 50 samples
    // should be essentially all unique.
    expect(codes.size).toBeGreaterThan(45);
  });
});

describe('isValidRoomCode — validation', () => {
  it('accepts a well-formed code', () => {
    expect(isValidRoomCode('A2B3C4')).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(isValidRoomCode('A2B3C')).toBe(false);
    expect(isValidRoomCode('A2B3C45')).toBe(false);
  });

  it('rejects banned characters', () => {
    expect(isValidRoomCode('A2B0C4')).toBe(false); // 0 banned
    expect(isValidRoomCode('I2B3C4')).toBe(false); // I banned
    expect(isValidRoomCode('A2O3C4')).toBe(false); // O banned
    expect(isValidRoomCode('A1B3C4')).toBe(false); // 1 banned
  });

  it('rejects wrong positional kinds (letter where digit expected)', () => {
    expect(isValidRoomCode('AAB3C4')).toBe(false); // pos 1 should be digit
    expect(isValidRoomCode('A23BC4')).toBe(false); // pos 2 should be letter
  });

  it('rejects lowercase (codes are uppercase-canonical)', () => {
    expect(isValidRoomCode('a2b3c4')).toBe(false);
  });
});
