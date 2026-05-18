import { describe, it, expect } from 'vitest';
import { parseHash, buildHash } from '@/lib/router';

describe('parseHash', () => {
  it('returns landing for empty hash', () => {
    expect(parseHash('')).toEqual({ kind: 'landing' });
    expect(parseHash('#')).toEqual({ kind: 'landing' });
    expect(parseHash('#/')).toEqual({ kind: 'landing' });
  });

  it('parses create route', () => {
    expect(parseHash('#/create')).toEqual({ kind: 'create' });
  });

  it('parses wait route with code', () => {
    expect(parseHash('#/wait?code=K7M2P9')).toEqual({ kind: 'wait', code: 'K7M2P9' });
  });

  it('falls back to landing when wait is missing code', () => {
    expect(parseHash('#/wait')).toEqual({ kind: 'landing' });
  });

  it('parses table route', () => {
    expect(parseHash('#/table?code=ABC123')).toEqual({ kind: 'table', code: 'ABC123' });
  });

  it('parses legacy table launch link', () => {
    const result = parseHash('#table=K7M2P9&token=abc&me=@alice');
    expect(result).toEqual({
      kind: 'table-legacy',
      roomId: 'K7M2P9',
      joinToken: 'abc',
      myHandle: '@alice',
    });
  });

  it('falls back to landing for malformed legacy link', () => {
    expect(parseHash('#table=onlyone')).toEqual({ kind: 'landing' });
  });

  it('unknown path → landing', () => {
    expect(parseHash('#/unknown/path')).toEqual({ kind: 'landing' });
  });
});

describe('buildHash', () => {
  it('builds the inverse of parseHash for each route', () => {
    const routes = [
      { kind: 'landing' as const },
      { kind: 'create' as const },
      { kind: 'wait' as const, code: 'K7M2P9' },
      { kind: 'table' as const, code: 'B3F8N1' },
    ];
    for (const route of routes) {
      expect(parseHash(buildHash(route))).toEqual(route);
    }
  });

  it('encodes special chars in code', () => {
    expect(buildHash({ kind: 'wait', code: 'A B' })).toBe('#/wait?code=A%20B');
  });

  it('builds legacy table launch hash', () => {
    expect(
      buildHash({
        kind: 'table-legacy',
        roomId: 'K7M2P9',
        joinToken: 'abc',
        myHandle: '@alice',
      })
    ).toBe('#table=K7M2P9&token=abc&me=%40alice');
  });
});
