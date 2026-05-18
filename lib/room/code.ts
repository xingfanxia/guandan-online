// Room code generator — 6-character alternating letter/digit codes.
//
// SYNC: docs/plan/PLAN.md ROOM-1 spec ("Code format: 3 letters + 3 digits in
// alternating pattern, ambiguity-safe alphabet"). Format: L D L D L D where
// L is an ambiguity-safe letter (no I/O/Z) and D is an ambiguity-safe digit
// (no 0/1). 23 letters × 8 digits → ≈6.2M codes; KV SETNX with retries
// handles the rare collision (the API-route concern, not this module).
//
// Pure-functional. Caller supplies the RNG so dev/tests can seed for
// determinism. Production passes Math.random.

export const ROOM_CODE_ALPHABETS = {
  /** Letters minus I (looks like 1), O (looks like 0), Z (looks like 2). */
  letters: 'ABCDEFGHJKLMNPQRSTUVWXY',
  /** Digits minus 0 (looks like O) and 1 (looks like I). */
  digits: '23456789',
} as const;

const LETTER_SET = new Set(ROOM_CODE_ALPHABETS.letters);
const DIGIT_SET = new Set(ROOM_CODE_ALPHABETS.digits);

/**
 * Generate one room code. The RNG is invoked 6 times — once per character.
 * Format: L D L D L D (positions 0, 2, 4 letters; 1, 3, 5 digits).
 */
export function generateRoomCode(rng: () => number): string {
  const ls = ROOM_CODE_ALPHABETS.letters;
  const ds = ROOM_CODE_ALPHABETS.digits;
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    const alphabet = i % 2 === 0 ? ls : ds;
    out.push(alphabet.charAt(Math.floor(rng() * alphabet.length)));
  }
  return out.join('');
}

/**
 * Validate a room code is well-formed: 6 characters, alternating L/D pattern,
 * uppercase, no banned look-alikes. Used at API entry to reject malformed
 * codes before KV lookup.
 */
export function isValidRoomCode(code: string): boolean {
  if (code.length !== 6) return false;
  for (let i = 0; i < 6; i++) {
    const ch = code.charAt(i);
    const wantLetter = i % 2 === 0;
    if (wantLetter) {
      if (!LETTER_SET.has(ch)) return false;
    } else {
      if (!DIGIT_SET.has(ch)) return false;
    }
  }
  return true;
}
