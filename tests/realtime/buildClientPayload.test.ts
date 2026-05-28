import { describe, expect, it } from 'vitest';
import { buildClientPayload, assertNoOpponentHandLeak } from '@lib/realtime/buildClientPayload';
import type { AuthorEvent, GameState } from '@lib/realtime/buildClientPayload';
import type { DealEvent, HeartbeatEvent, RoomLeftEvent, ServerEvent } from '@lib/realtime/messages';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STATE_4P: GameState = {
  hands: {
    alice: ['5-S-1', '6-S-1', '7-S-1'],
    bob: ['K-H-1', 'A-H-1'],
    carol: ['10-C-1', 'J-C-1', 'Q-C-1'],
    dave: ['BJ-J-1', 'RJ-J-1'],
  },
  handles: { alice: '@alice', bob: '@bob', carol: '@carol', dave: '@dave' },
  teams: { alice: 't1', bob: 't2', carol: 't1', dave: 't2' },
  partners: { alice: 'carol', bob: 'dave', carol: 'alice', dave: 'bob' },
  statuses: { alice: 'connected', bob: 'connected', carol: 'connected', dave: 'connected' },
  ranks: { alice: null, bob: null, carol: null, dave: null },
};

// ─── Deal: each recipient gets ONLY their own hand ────────────────────────────

describe('buildClientPayload — deal event', () => {
  const author: AuthorEvent = {
    type: 'deal',
    version: 1,
    hands: STATE_4P.hands,
    roundOwner: 't1',
  };

  it('alice receives only alice\'s hand + public counts', () => {
    const out = buildClientPayload('alice', author, STATE_4P) as DealEvent;
    expect(out.type).toBe('deal');
    expect(out.yourHand).toEqual(['5-S-1', '6-S-1', '7-S-1']);
    expect(out.publicHandCounts).toEqual({ alice: 3, bob: 2, carol: 3, dave: 2 });
    expect(out.roundOwner).toBe('t1');
  });

  it('bob receives only bob\'s hand', () => {
    const out = buildClientPayload('bob', author, STATE_4P) as DealEvent;
    expect(out.yourHand).toEqual(['K-H-1', 'A-H-1']);
  });

  it('serialized payload contains zero opponent cards (leak gate)', () => {
    const payload = buildClientPayload('alice', author, STATE_4P)!;
    const serialized = JSON.stringify(payload);
    // bob/carol/dave card identities must not appear in alice's payload
    for (const card of ['K-H-1', 'A-H-1', '10-C-1', 'J-C-1', 'Q-C-1', 'BJ-J-1', 'RJ-J-1']) {
      expect(serialized).not.toContain(`"${card}"`);
    }
    // alice's own cards SHOULD appear
    expect(serialized).toContain('"5-S-1"');
  });
});

// ─── EXCHANGE-1: exchange_completed is deal-like (filtered to yourHand) ───────

describe('buildClientPayload — exchange_completed event', () => {
  const author: AuthorEvent = {
    type: 'exchange_completed',
    version: 9,
    direction: 'cw',
    hands: STATE_4P.hands,
  };

  it('each recipient gets ONLY their own post-swap hand + public counts', () => {
    const out = buildClientPayload('alice', author, STATE_4P) as Extract<
      ServerEvent,
      { type: 'exchange_completed' }
    >;
    expect(out.type).toBe('exchange_completed');
    expect(out.yourHand).toEqual(['5-S-1', '6-S-1', '7-S-1']);
    expect(out.direction).toBe('cw');
    expect(out.publicHandCounts).toEqual({ alice: 3, bob: 2, carol: 3, dave: 2 });
  });

  it('leak gate: no opponent cards in a recipient payload', () => {
    const payload = buildClientPayload('alice', author, STATE_4P)!;
    expect(() => assertNoOpponentHandLeak(payload, 'alice', STATE_4P)).not.toThrow();
    const serialized = JSON.stringify(payload);
    for (const card of ['K-H-1', 'A-H-1', '10-C-1', 'BJ-J-1']) {
      expect(serialized).not.toContain(`"${card}"`);
    }
  });
});

describe('buildClientPayload — exchange vote/select pass-through', () => {
  it('exchange_vote_required / vote_resolved / select_required are identical per recipient + carry no cards', () => {
    const events: AuthorEvent[] = [
      { type: 'exchange_vote_required', version: 5, losers: ['bob', 'dave'], voteThreshold: 0.5, cardCount: 3 },
      { type: 'exchange_vote_resolved', version: 6, passed: true, direction: 'cw' },
      { type: 'exchange_select_required', version: 7, cardCount: 3, direction: 'cw' },
    ];
    for (const ev of events) {
      const a = buildClientPayload('alice', ev, STATE_4P)!;
      const b = buildClientPayload('bob', ev, STATE_4P)!;
      expect(a).toEqual(ev);
      expect(a).toEqual(b);
      expect(() => assertNoOpponentHandLeak(a, 'alice', STATE_4P)).not.toThrow();
    }
  });
});

// ─── Pass-through events: no hidden state, payload unchanged per recipient ────

describe('buildClientPayload — pass-through events', () => {
  it('heartbeat: identical for every recipient', () => {
    const heartbeat: HeartbeatEvent = {
      type: 'heartbeat',
      version: 42,
      serverTime: '2026-05-18T00:00:00Z',
    };
    const author: AuthorEvent = heartbeat;
    expect(buildClientPayload('alice', author, STATE_4P)).toEqual(heartbeat);
    expect(buildClientPayload('bob', author, STATE_4P)).toEqual(heartbeat);
  });

  it('room_left: identical for every recipient', () => {
    const ev: RoomLeftEvent = {
      type: 'room_left',
      version: 5,
      playerId: 'bob',
      reason: 'disconnect',
    };
    const out = buildClientPayload('alice', ev, STATE_4P);
    expect(out).toEqual(ev);
  });

  it('move_played: cards are public — same payload across recipients', () => {
    const author: AuthorEvent = {
      type: 'move_played',
      version: 7,
      player: 'alice',
      cards: ['5-S-1', '6-S-1', '7-S-1'],
      combinationLabel: 'Triple',
      nextTurn: 'bob',
      turnDeadline: '2026-05-18T00:00:30Z',
    };
    const a = buildClientPayload('alice', author, STATE_4P);
    const b = buildClientPayload('bob', author, STATE_4P);
    expect(a).toEqual(b);
    expect((a as { cards: string[] }).cards.sort()).toEqual(['5-S-1', '6-S-1', '7-S-1']);
  });
});

// ─── Snapshot: per-recipient `you` slot + public players summary ─────────────

describe('buildClientPayload — snapshot event', () => {
  it('builds `you` from recipient\'s slice of state, hides others\' hands', () => {
    const author: AuthorEvent = {
      type: 'snapshot',
      version: 100,
      table: {
        currentTurn: 'alice',
        currentTrick: [],
        lastTrick: null,
        teamLevels: { t1: '5', t2: '4' },
        roundOwner: 't1',
        phase: 'playing',
        turnDeadline: '2026-05-18T00:00:30Z',
      },
    };
    const out = buildClientPayload('alice', author, STATE_4P) as Extract<
      ServerEvent,
      { type: 'snapshot' }
    >;
    expect(out.you.playerId).toBe('alice');
    expect(out.you.hand).toEqual(['5-S-1', '6-S-1', '7-S-1']);
    expect(out.you.teamId).toBe('t1');
    expect(out.you.partnerId).toBe('carol');
    // Players summary has counts only, no card identities
    const playerById = Object.fromEntries(out.players.map((p) => [p.id, p]));
    expect(playerById['bob']?.handCount).toBe(2);
    expect(playerById['dave']?.handCount).toBe(2);
    expect(JSON.stringify(out.players)).not.toContain('K-H-1'); // bob's card
  });
});

// ─── Leak detector: catches accidental leaks in dev ───────────────────────────

describe('assertNoOpponentHandLeak', () => {
  it('passes for a correctly-filtered deal payload', () => {
    const ev: AuthorEvent = {
      type: 'deal',
      version: 1,
      hands: STATE_4P.hands,
      roundOwner: 't1',
    };
    const payload = buildClientPayload('alice', ev, STATE_4P)!;
    expect(() => assertNoOpponentHandLeak(payload, 'alice', STATE_4P)).not.toThrow();
  });

  it('throws when an opponent card identity appears in the payload', () => {
    // Construct a leaky payload manually (simulating a future bug)
    const leakyPayload: DealEvent = {
      type: 'deal',
      version: 1,
      yourHand: ['5-S-1', 'K-H-1'], // K-H-1 is bob's card!
      publicHandCounts: { alice: 2, bob: 1, carol: 3, dave: 2 },
      roundOwner: 't1',
    };
    expect(() => assertNoOpponentHandLeak(leakyPayload, 'alice', STATE_4P)).toThrow(
      /HIDDEN_STATE_LEAK|K-H-1|bob/i
    );
  });

  it('does not flag the recipient\'s own cards', () => {
    const payload: DealEvent = {
      type: 'deal',
      version: 1,
      yourHand: STATE_4P.hands['alice']!,
      publicHandCounts: { alice: 3 },
      roundOwner: 't1',
    };
    expect(() => assertNoOpponentHandLeak(payload, 'alice', STATE_4P)).not.toThrow();
  });
});
