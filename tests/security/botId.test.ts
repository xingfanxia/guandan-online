import { describe, expect, it } from 'vitest';
import {
  BOT_VERDICT_HEADER,
  BOT_NAME_HEADER,
  readBotIdVerdict,
  shouldBlockRequest,
} from '@lib/security/botId';

// Build a Request with the given headers. We assert real behavior of the
// verdict reader / gate — no mocks; a real Request carries real headers.
function req(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api/room/ABCD/move', {
    method: 'POST',
    headers,
  });
}

describe('readBotIdVerdict — verdict parsing', () => {
  it('reads a human verdict', () => {
    const v = readBotIdVerdict(req({ [BOT_VERDICT_HEADER]: 'human' }));
    expect(v).toEqual({ isBot: false, verdict: 'human' });
  });

  it('reads a bot verdict (isBot true)', () => {
    const v = readBotIdVerdict(req({ [BOT_VERDICT_HEADER]: 'bot' }));
    expect(v).toEqual({ isBot: true, verdict: 'bot' });
  });

  it('reads a verified-bot verdict (isBot true, distinct verdict)', () => {
    const v = readBotIdVerdict(req({ [BOT_VERDICT_HEADER]: 'verified-bot' }));
    expect(v).toEqual({ isBot: true, verdict: 'verified-bot' });
  });

  it('returns unknown when the verdict header is absent', () => {
    const v = readBotIdVerdict(req());
    expect(v).toEqual({ isBot: false, verdict: 'unknown' });
  });

  it('returns unknown for a blank / whitespace verdict header', () => {
    expect(readBotIdVerdict(req({ [BOT_VERDICT_HEADER]: '   ' }))).toEqual({
      isBot: false,
      verdict: 'unknown',
    });
  });

  it('returns unknown for an unrecognized verdict string', () => {
    expect(readBotIdVerdict(req({ [BOT_VERDICT_HEADER]: 'banana' }))).toEqual({
      isBot: false,
      verdict: 'unknown',
    });
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(
      readBotIdVerdict(req({ [BOT_VERDICT_HEADER]: '  HUMAN  ' })).verdict
    ).toBe('human');
    expect(
      readBotIdVerdict(req({ [BOT_VERDICT_HEADER]: 'Verified-Bot' })).verdict
    ).toBe('verified-bot');
    expect(readBotIdVerdict(req({ [BOT_VERDICT_HEADER]: 'BOT' })).verdict).toBe(
      'bot'
    );
  });

  it('accepts documented synonyms for each verdict', () => {
    // human-ish
    for (const s of ['pass', 'false', '0']) {
      expect(readBotIdVerdict(req({ [BOT_VERDICT_HEADER]: s })).verdict).toBe(
        'human'
      );
    }
    // bot-ish
    for (const s of ['true', '1', 'malicious', 'fail']) {
      expect(readBotIdVerdict(req({ [BOT_VERDICT_HEADER]: s })).verdict).toBe(
        'bot'
      );
    }
    // verified
    for (const s of ['verified', 'good-bot']) {
      expect(readBotIdVerdict(req({ [BOT_VERDICT_HEADER]: s })).verdict).toBe(
        'verified-bot'
      );
    }
  });

  it('ignores the bot-name header for classification (hint only)', () => {
    const v = readBotIdVerdict(
      req({ [BOT_NAME_HEADER]: 'Googlebot' }) // name present, verdict absent
    );
    expect(v).toEqual({ isBot: false, verdict: 'unknown' });
  });
});

describe('shouldBlockRequest — core acceptance', () => {
  it('human verdict passes', () => {
    expect(shouldBlockRequest(req({ [BOT_VERDICT_HEADER]: 'human' }))).toEqual({
      blocked: false,
    });
  });

  it('bot verdict + non-allowlisted UA is blocked with a reason', () => {
    const result = shouldBlockRequest(
      req({ [BOT_VERDICT_HEADER]: 'bot', 'user-agent': 'curl/8.4.0' }),
      { allowlist: ['guandan-uptime-probe'] }
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBeTruthy();
  });

  it('no bot signal (no headers) is not blocked', () => {
    expect(shouldBlockRequest(req())).toEqual({ blocked: false });
  });

  it('verified-bot + allowlisted UA passes', () => {
    const result = shouldBlockRequest(
      req({
        [BOT_VERDICT_HEADER]: 'verified-bot',
        'user-agent': 'GuandanUptimeProbe/1.0 (+https://gdo.ax0x.ai)',
      }),
      { allowlist: ['GuandanUptimeProbe'] }
    );
    expect(result).toEqual({ blocked: false });
  });

  it('verified-bot NOT on the allowlist is still blocked', () => {
    // A verified bot Vercel vouches for, but not one WE chose to serve.
    const result = shouldBlockRequest(
      req({ [BOT_VERDICT_HEADER]: 'verified-bot', 'user-agent': 'Googlebot/2.1' }),
      { allowlist: ['GuandanUptimeProbe'] }
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('allowlist');
  });

  it('an allowlisted UA passes even when flagged as a plain bot', () => {
    const result = shouldBlockRequest(
      req({
        [BOT_VERDICT_HEADER]: 'bot',
        'user-agent': 'vercel-cron/1.0',
      }),
      { allowlist: ['vercel-cron'] }
    );
    expect(result).toEqual({ blocked: false });
  });
});

describe('shouldBlockRequest — allowlist substring matching', () => {
  it('matches case-insensitively as a substring of the UA', () => {
    const result = shouldBlockRequest(
      req({ [BOT_VERDICT_HEADER]: 'bot', 'user-agent': 'Mozilla MyProbe/2 xyz' }),
      { allowlist: ['myprobe'] }
    );
    expect(result.blocked).toBe(false);
  });

  it('does not match a UA that lacks every allowlist substring', () => {
    const result = shouldBlockRequest(
      req({ [BOT_VERDICT_HEADER]: 'bot', 'user-agent': 'EvilScraper/9' }),
      { allowlist: ['myprobe', 'vercel-cron'] }
    );
    expect(result.blocked).toBe(true);
  });

  it('a bot with no User-Agent is never allowlisted', () => {
    const result = shouldBlockRequest(req({ [BOT_VERDICT_HEADER]: 'bot' }), {
      allowlist: ['anything'],
    });
    expect(result.blocked).toBe(true);
  });

  it('an empty allowlist allowlists nobody', () => {
    const result = shouldBlockRequest(
      req({ [BOT_VERDICT_HEADER]: 'bot', 'user-agent': 'whatever' }),
      { allowlist: [] }
    );
    expect(result.blocked).toBe(true);
  });

  it('skips blank allowlist entries (never matches everything)', () => {
    const result = shouldBlockRequest(
      req({ [BOT_VERDICT_HEADER]: 'bot', 'user-agent': 'EvilScraper/9' }),
      { allowlist: ['  ', ''] }
    );
    expect(result.blocked).toBe(true);
  });
});

describe('shouldBlockRequest — unknown verdict behavior', () => {
  it('unknown is allowed by default (fail-open)', () => {
    expect(shouldBlockRequest(req())).toEqual({ blocked: false });
    expect(
      shouldBlockRequest(req({ [BOT_VERDICT_HEADER]: 'gibberish' }))
    ).toEqual({ blocked: false });
  });

  it('unknown is blocked when blockUnverified is true', () => {
    const result = shouldBlockRequest(req(), { blockUnverified: true });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBeTruthy();
  });

  it('unknown + blockUnverified still passes an allowlisted UA', () => {
    const result = shouldBlockRequest(
      req({ 'user-agent': 'vercel-cron/1.0' }),
      { blockUnverified: true, allowlist: ['vercel-cron'] }
    );
    expect(result).toEqual({ blocked: false });
  });
});

describe('shouldBlockRequest — defaults / missing options', () => {
  it('works with no options at all (human passes, bot blocks)', () => {
    expect(shouldBlockRequest(req({ [BOT_VERDICT_HEADER]: 'human' }))).toEqual({
      blocked: false,
    });
    const botResult = shouldBlockRequest(req({ [BOT_VERDICT_HEADER]: 'bot' }));
    expect(botResult.blocked).toBe(true);
  });
});
