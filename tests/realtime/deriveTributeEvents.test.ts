import { describe, expect, it } from 'vitest';
import { deriveTributeEvents } from '@lib/realtime/deriveTributeEvents';
import { encodeCard } from '@lib/realtime/cardCodec';
import type { Card } from '@lib/game/cards';
import type {
  AuthorTributePendingEvent,
} from '@lib/realtime/buildClientPayload';
import type { TributeResolvedEvent } from '@lib/realtime/messages';

const tribute1: Card = { suit: 'spades', rank: 'A', deck: 1 };
const return1: Card = { suit: 'clubs', rank: '5', deck: 1 };
const tribute2: Card = { suit: 'hearts', rank: 'K', deck: 2 };
const return2: Card = { suit: 'diamonds', rank: '3', deck: 2 };

describe('deriveTributeEvents — single tribute', () => {
  it('emits tribute_pending + tribute_resolved with both card movements', () => {
    const events = deriveTributeEvents({
      tributeMode: { kind: 'single', from: 'p3', to: 'p0' },
      exchanges: [{ from: 'p3', to: 'p0', tribute: tribute1, return: return1 }],
      baseVersion: 10,
    });
    expect(events).toHaveLength(2);

    const pending = events[0] as AuthorTributePendingEvent;
    expect(pending.type).toBe('tribute_pending');
    expect(pending.version).toBe(10);
    expect(pending.direction).toBe('single');
    expect(pending.obligations).toEqual([
      { from: 'p3', to: 'p0', constraint: 'highest_non_heart' },
    ]);
    // Winner (p0) sees the incoming card via privatePayloads.owedCard.
    expect(pending.privatePayloads.p0?.owedCard).toBe(encodeCard(tribute1));

    const resolved = events[1] as TributeResolvedEvent;
    expect(resolved.type).toBe('tribute_resolved');
    expect(resolved.version).toBe(11);
    expect(resolved.exchanged).toEqual([
      { from: 'p3', to: 'p0', card: encodeCard(tribute1) },
      { from: 'p0', to: 'p3', card: encodeCard(return1) },
    ]);
  });

  it('skips the return entry when the winner had no eligible return card', () => {
    const events = deriveTributeEvents({
      tributeMode: { kind: 'single', from: 'p3', to: 'p0' },
      exchanges: [{ from: 'p3', to: 'p0', tribute: tribute1, return: null }],
      baseVersion: 5,
    });
    const resolved = events[1] as TributeResolvedEvent;
    expect(resolved.exchanged).toEqual([
      { from: 'p3', to: 'p0', card: encodeCard(tribute1) },
    ]);
  });
});

describe('deriveTributeEvents — double tribute', () => {
  it('emits 4 exchange entries (2 tributes + 2 returns)', () => {
    const events = deriveTributeEvents({
      tributeMode: {
        kind: 'double',
        obligations: [
          { from: 'p3', to: 'p0' },
          { from: 'p2', to: 'p1' },
        ],
      },
      exchanges: [
        { from: 'p3', to: 'p0', tribute: tribute1, return: return1 },
        { from: 'p2', to: 'p1', tribute: tribute2, return: return2 },
      ],
      baseVersion: 20,
    });
    const pending = events[0] as AuthorTributePendingEvent;
    expect(pending.direction).toBe('double');
    expect(pending.obligations).toHaveLength(2);
    expect(pending.privatePayloads.p0?.owedCard).toBe(encodeCard(tribute1));
    expect(pending.privatePayloads.p1?.owedCard).toBe(encodeCard(tribute2));

    const resolved = events[1] as TributeResolvedEvent;
    expect(resolved.exchanged).toHaveLength(4);
  });
});

describe('deriveTributeEvents — resist (anti-tribute)', () => {
  it('emits ONLY tribute_pending with direction=anti_tribute, no resolved event', () => {
    const events = deriveTributeEvents({
      tributeMode: { kind: 'resist' },
      exchanges: [],
      baseVersion: 100,
    });
    expect(events).toHaveLength(1);
    const pending = events[0] as AuthorTributePendingEvent;
    expect(pending.direction).toBe('anti_tribute');
    expect(pending.obligations).toEqual([]);
    expect(pending.privatePayloads).toEqual({});
  });
});

describe('deriveTributeEvents — none', () => {
  it('returns an empty event array', () => {
    expect(
      deriveTributeEvents({
        tributeMode: { kind: 'none' },
        exchanges: [],
        baseVersion: 50,
      })
    ).toEqual([]);
  });
});
