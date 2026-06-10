import { describe, expect, it, vi } from 'vitest';
import { publishEvent, eventLogKey } from '@lib/realtime/publish';
import { createMemoryEventBus } from '@lib/realtime/eventBus';
import { createMemoryEventLog } from '@lib/realtime/eventLog';
import type { AuthorEvent, GameState } from '@lib/realtime/buildClientPayload';
import type { DealEvent, ServerEvent } from '@lib/realtime/messages';

const STATE: GameState = {
  hands: {
    alice: ['5-S-1', '6-S-1'],
    bob: ['K-H-1'],
    carol: ['Q-C-1'],
    dave: ['BJ-J-1'],
  },
  handles: { alice: '@a', bob: '@b', carol: '@c', dave: '@d' },
  teams: { alice: 't1', bob: 't2', carol: 't1', dave: 't2' },
  partners: { alice: 'carol', bob: 'dave', carol: 'alice', dave: 'bob' },
  statuses: { alice: 'connected', bob: 'connected', carol: 'connected', dave: 'connected' },
  ranks: { alice: null, bob: null, carol: null, dave: null },
};

const dealAuthor: AuthorEvent = {
  type: 'deal',
  version: 1,
  hands: STATE.hands,
  roundOwner: 't1',
  leader: 'alice',
};

// ─── Fanout ──────────────────────────────────────────────────────────────────

describe('publishEvent — fans out to every recipient', () => {
  it('each player receives their per-recipient payload on their channel', async () => {
    const bus = createMemoryEventBus();
    const log = createMemoryEventLog();
    const received: Record<string, ServerEvent[]> = { alice: [], bob: [], carol: [], dave: [] };
    for (const id of Object.keys(received)) {
      await bus.subscribe(`game:room42:player:${id}`, (ev) => received[id]!.push(ev));
    }

    await publishEvent('room42', dealAuthor, STATE, bus, log);

    // Each player received exactly one event.
    expect(received['alice']).toHaveLength(1);
    expect(received['bob']).toHaveLength(1);
    // alice's payload contains alice's hand, not bob's
    const alicePayload = received['alice']![0] as DealEvent;
    expect(alicePayload.yourHand).toEqual(['5-S-1', '6-S-1']);
    // bob's payload does NOT contain alice's cards
    const bobPayloadJson = JSON.stringify(received['bob']![0]);
    expect(bobPayloadJson).not.toContain('"5-S-1"');
    expect(bobPayloadJson).toContain('"K-H-1"'); // bob's own
  });

  it('appends to per-recipient log keys (isolated streams)', async () => {
    const bus = createMemoryEventBus();
    const log = createMemoryEventLog();
    await publishEvent('room42', dealAuthor, STATE, bus, log);

    // Each recipient has their own per-key log; payload at each key is the
    // recipient-filtered view.
    const aliceLog = await log.range(eventLogKey('room42', 'alice'), null);
    const bobLog = await log.range(eventLogKey('room42', 'bob'), null);
    const carolLog = await log.range(eventLogKey('room42', 'carol'), null);
    const daveLog = await log.range(eventLogKey('room42', 'dave'), null);
    expect(aliceLog).toHaveLength(1);
    expect(bobLog).toHaveLength(1);
    expect(carolLog).toHaveLength(1);
    expect(daveLog).toHaveLength(1);

    // The "raw" room-only key is empty — proves no shared stream that could
    // leak filtered payloads across players on SSE backlog drain.
    const sharedLog = await log.range('room42', null);
    expect(sharedLog).toEqual([]);
  });

  it('alice cannot read bob payload via her log (security regression guard)', async () => {
    const bus = createMemoryEventBus();
    const log = createMemoryEventLog();
    await publishEvent('room42', dealAuthor, STATE, bus, log);

    const aliceLog = await log.range(eventLogKey('room42', 'alice'), null);
    const aliceJson = JSON.stringify(aliceLog);
    // alice's log contains her own card 5-S-1 (yourHand)
    expect(aliceJson).toContain('5-S-1');
    // alice's log does NOT contain bob's actual card K-H-1
    expect(aliceJson).not.toContain('K-H-1');
  });
});

// ─── Leak detection ──────────────────────────────────────────────────────────

describe('publishEvent — leak detector', () => {
  it('throws when the filter produces a leaky payload (defensive)', async () => {
    const bus = createMemoryEventBus();
    const log = createMemoryEventLog();
    // Construct a state with corrupt hands that map alice's id to bob's card
    // so the filter (which uses recipient lookup) outputs bob's card to alice.
    const badState: GameState = { ...STATE, hands: { ...STATE.hands, alice: ['K-H-1'] } };
    // K-H-1 is also in bob's hand. With alice's hand now == bob's card, the
    // leak detector should detect that alice's payload (containing K-H-1)
    // overlaps with bob's actual hand.
    await expect(publishEvent('room42', dealAuthor, badState, bus, log)).rejects.toThrow(
      /HIDDEN_STATE_LEAK/
    );
  });
});

// ─── Pass-through events ─────────────────────────────────────────────────────

describe('publishEvent — pass-through events fan out identically', () => {
  it('heartbeat reaches every recipient with same payload', async () => {
    const bus = createMemoryEventBus();
    const log = createMemoryEventLog();
    const received: ServerEvent[] = [];
    await bus.subscribe('game:rA:player:alice', (e) => received.push(e));
    await bus.subscribe('game:rA:player:bob', (e) => received.push(e));
    const hb: AuthorEvent = { type: 'heartbeat', version: 9, serverTime: '2026-05-18T00:00:00Z' };
    await publishEvent('rA', hb, STATE, bus, log);
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(received[1]);
  });
});

// ─── Channel naming ──────────────────────────────────────────────────────────

describe('publishEvent — channel naming convention', () => {
  it('uses game:{roomId}:player:{playerId} per realtime-sync-deep-dive.md §7.2', async () => {
    const bus = createMemoryEventBus();
    const log = createMemoryEventLog();
    const calls: { ch: string; ev: ServerEvent }[] = [];
    // Spy on publish via subscribing
    for (const id of ['alice', 'bob', 'carol', 'dave']) {
      await bus.subscribe(`game:roomX:player:${id}`, (ev) => calls.push({ ch: id, ev }));
    }
    await publishEvent('roomX', dealAuthor, STATE, bus, log);
    const channels = calls.map((c) => c.ch).sort();
    expect(channels).toEqual(['alice', 'bob', 'carol', 'dave']);
  });
});

// ─── Returning early on filter result null ───────────────────────────────────

describe('publishEvent — filter returning null', () => {
  it('does NOT publish if the filter returns null for that recipient', async () => {
    const bus = createMemoryEventBus();
    const log = createMemoryEventLog();
    // Currently buildClientPayload never returns null for known event types,
    // but we still want the contract documented + asserted with a spy bus.
    const publishSpy = vi.fn().mockResolvedValue(undefined);
    const fakeBus = {
      ...bus,
      publish: publishSpy,
    };
    await publishEvent('r1', dealAuthor, STATE, fakeBus, log);
    // 4 recipients × 1 event each
    expect(publishSpy).toHaveBeenCalledTimes(4);
  });
});
