// End-to-end integration test: walks the full v1 API surface against the
// memory backend. Proves that the six API handlers compose correctly:
//
//   create-room → 3× join → start → SSE-subscribe(p0) → move(play, p0)
//                                                       → SSE receives move_played
//                                                       → move(pass, p1)
//                                                       → SSE receives move_passed
//
// No HTTP server. Each handler is invoked directly with synthetic Request
// objects against an in-process RealtimeInfra. Same handlers as production;
// only the transport is short-circuited.

import { describe, expect, it } from 'vitest';
import { createRealtimeInfra } from '@lib/realtime/infra';
import { handleCreateRoom } from '@lib/api/createRoom';
import type { CreateRoomResponseBody } from '@lib/api/createRoom';
import { handleJoinRoom } from '@lib/api/joinRoom';
import type { JoinRoomResponseBody } from '@lib/api/joinRoom';
import { handleStartGame } from '@lib/api/startGame';
import { handleMove } from '@lib/api/move';
import { handleSse } from '@lib/api/sse';
import { parseFrame } from '@lib/realtime/sse';
import type { ServerEvent } from '@lib/realtime/messages';
import type { MoveResponse } from '@lib/realtime/commands';
import { encodeCards } from '@lib/realtime/cardCodec';
import { createSlidingWindowLimiter } from '@lib/security/rateLimit';
import seedrandom from 'seedrandom';

const CODE = 'A2B3C4';

function jsonReq(
  method: string,
  body: unknown,
  bearer?: string
): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  return new Request('http://test/', {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe('full game flow — create → join → start → move → SSE', () => {
  it('drives one play and one pass through the full stack with SSE confirmation', async () => {
    const infra = createRealtimeInfra({});
    const rateLimiter = createSlidingWindowLimiter({
      windowMs: 10_000,
      max: 100,
    });
    const NOW = 1_700_000_000_000;
    const now = () => NOW;
    const rng = seedrandom('integration-flow') as unknown as () => number;

    // ── 1. host creates room ───────────────────────────────────────────────
    const createRes = await handleCreateRoom(
      jsonReq('POST', { mode: '4', host: { handle: '@host' } }),
      {
        roomStore: infra.roomStore,
        tokenGen: counter('host-tok'),
        codeGen: () => CODE,
        now,
      }
    );
    expect(createRes.status).toBe(201);
    const create = (await createRes.json()) as CreateRoomResponseBody;
    expect(create.code).toBe(CODE);

    // ── 2. three more players join ─────────────────────────────────────────
    const joinTokens: string[] = [];
    const playerIds: string[] = [create.hostId];
    for (let i = 1; i < 4; i++) {
      const joinRes = await handleJoinRoom(
        jsonReq('POST', { handle: `@player${i}x` }),
        CODE,
        { roomStore: infra.roomStore, tokenGen: counter(`jt-${i}`), now }
      );
      expect(joinRes.status).toBe(200);
      const j = (await joinRes.json()) as JoinRoomResponseBody;
      joinTokens.push(j.joinToken);
      playerIds.push(j.playerId);
    }
    expect(playerIds).toEqual(['p0', 'p1', 'p2', 'p3']);

    // ── 3. host starts the game ────────────────────────────────────────────
    const startRes = await handleStartGame(
      jsonReq('POST', undefined, create.hostToken),
      CODE,
      {
        roomStore: infra.roomStore,
        roundStore: infra.roundStore,
        sessionStore: infra.sessionStore,
        bus: infra.bus,
        log: infra.log,
        rng: () => rng(),
        now,
      }
    );
    expect(startRes.status).toBe(200);

    const envelope = await infra.roundStore.get(CODE);
    expect(envelope?.version).toBe(0);
    expect(envelope?.round.currentTrick?.currentPlayer).toBe('p0');

    // ── 4. p0 opens an SSE stream (will receive backlog + live moves) ─────
    const sseUrl = new URL(
      `http://test/api/sse/${CODE}?token=${create.hostJoinToken}`
    );
    const sseRes = await handleSse(
      new Request(sseUrl.toString(), { method: 'GET' }),
      CODE,
      {
        roomStore: infra.roomStore,
        bus: infra.bus,
        log: infra.log,
        heartbeatMs: 10_000, // long → no heartbeat noise
        rotationMs: 200, // short → test finishes quickly
      }
    );
    expect(sseRes.status).toBe(200);

    // Start collecting frames in the background.
    const collectedFrames: string[] = [];
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const drainPromise = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = pending.indexOf('\n\n')) !== -1) {
          collectedFrames.push(pending.slice(0, idx));
          pending = pending.slice(idx + 2);
        }
      }
      pending += decoder.decode();
    })();

    // Give the SSE handler a tick to drain the backlog + subscribe.
    await new Promise<void>((r) => setTimeout(r, 20));

    // ── 5. p0 plays a single card ─────────────────────────────────────────
    const p0Hand = envelope!.round.hands['p0']!;
    const p0Card = encodeCards([p0Hand[0]!])[0]!;
    const playRes = await handleMove(
      jsonReq(
        'POST',
        {
          moveId: 'move-1',
          command: { kind: 'play', cards: [p0Card], fromVersion: 0 },
        },
        create.hostJoinToken
      ),
      CODE,
      {
        roomStore: infra.roomStore,
        roundStore: infra.roundStore,
        sessionStore: infra.sessionStore,
        idempotency: infra.idempotency,
        rateLimiter,
        bus: infra.bus,
        log: infra.log,
        now,
      }
    );
    const playBody = (await playRes.json()) as MoveResponse;
    expect(playBody.ok).toBe(true);
    if (playBody.ok) expect(playBody.appliedVersion).toBe(1);

    // ── 6. p1 passes ──────────────────────────────────────────────────────
    const passRes = await handleMove(
      jsonReq(
        'POST',
        {
          moveId: 'move-2',
          command: { kind: 'pass', fromVersion: 1 },
        },
        joinTokens[0]! // joinTokens[0] is p1's token (joins happen in order)
      ),
      CODE,
      {
        roomStore: infra.roomStore,
        roundStore: infra.roundStore,
        sessionStore: infra.sessionStore,
        idempotency: infra.idempotency,
        rateLimiter,
        bus: infra.bus,
        log: infra.log,
        now,
      }
    );
    const passBody = (await passRes.json()) as MoveResponse;
    expect(passBody.ok).toBe(true);
    if (passBody.ok) expect(passBody.appliedVersion).toBe(2);

    // ── 7. wait for SSE rotation to close the stream ──────────────────────
    await drainPromise;

    // ── 8. assertions on what made it to p0's stream ──────────────────────
    const dataFrames = collectedFrames
      .filter((f) => !f.startsWith(':') && f.length > 0)
      .map((f) => parseFrame(f + '\n\n').data as ServerEvent);

    // Should include: the initial deal (version 0), move_played (version 1),
    // move_passed (version 2), and the rotation stream_closing event.
    const types = dataFrames.map((e) => e.type);
    expect(types).toContain('deal');
    expect(types).toContain('move_played');
    expect(types).toContain('move_passed');
    expect(types).toContain('stream_closing');

    const movePlayed = dataFrames.find((e) => e.type === 'move_played');
    if (movePlayed?.type === 'move_played') {
      expect(movePlayed.player).toBe('p0');
      expect(movePlayed.cards).toEqual([p0Card]);
      expect(movePlayed.version).toBe(1);
    }

    const movePassed = dataFrames.find((e) => e.type === 'move_passed');
    if (movePassed?.type === 'move_passed') {
      expect(movePassed.player).toBe('p1');
      expect(movePassed.version).toBe(2);
    }

    // ── 9. final state checks ─────────────────────────────────────────────
    const finalEnvelope = await infra.roundStore.get(CODE);
    expect(finalEnvelope?.version).toBe(2);
    expect(finalEnvelope?.round.hands['p0']?.length).toBe(p0Hand.length - 1);
  });
});
