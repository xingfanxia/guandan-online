import { describe, it, expect } from 'vitest';
import { botGateResponse, FRIENDLY_BOT_ALLOWLIST } from '@lib/api/botGate';
import { BOT_VERDICT_HEADER } from '@lib/security/botId';

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://test/api/room/create', { method: 'POST', headers });
}

describe('botGateResponse (SEC-4 integration)', () => {
  it('returns null (allow) when no platform verdict header is present', () => {
    // Fail-open: dev / e2e / pre-challenge clients are never blocked.
    expect(botGateResponse(req())).toBeNull();
  });

  it('returns null when the verdict is human', () => {
    expect(botGateResponse(req({ [BOT_VERDICT_HEADER]: 'human' }))).toBeNull();
  });

  it('returns a 403 bot_detected Response for a plain bot', async () => {
    const res = botGateResponse(req({ [BOT_VERDICT_HEADER]: 'bot', 'user-agent': 'curl/8' }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toBe('bot_detected');
  });

  it('allows an allowlisted friendly bot even when flagged', () => {
    const ua = `${FRIENDLY_BOT_ALLOWLIST[0]}/1.0`;
    expect(
      botGateResponse(req({ [BOT_VERDICT_HEADER]: 'bot', 'user-agent': ua }))
    ).toBeNull();
  });
});
