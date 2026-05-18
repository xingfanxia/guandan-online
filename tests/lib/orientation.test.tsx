// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrientation, lockLandscape } from '@/lib/orientation';

interface MqRecord {
  query: string;
  matches: boolean;
  listeners: Set<(e: MediaQueryListEvent) => void>;
}

function installMatchMedia(rules: Array<{ query: string; matches: boolean }>): MqRecord[] {
  const records: MqRecord[] = rules.map((r) => ({
    query: r.query,
    matches: r.matches,
    listeners: new Set(),
  }));

  window.matchMedia = (query: string) => {
    const rec = records.find((r) => r.query === query) ?? {
      query, matches: false, listeners: new Set(),
    };
    return {
      get matches() { return rec.matches; },
      media: query,
      onchange: null,
      addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => rec.listeners.add(l),
      removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => rec.listeners.delete(l),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as MediaQueryList;
  };

  return records;
}

describe('useOrientation', () => {
  let originalMatchMedia: typeof window.matchMedia;
  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('returns desktop when viewport is wider than 900px', () => {
    installMatchMedia([
      { query: '(orientation: portrait)', matches: false },
      { query: '(max-width: 900px)', matches: false },
    ]);
    const { result } = renderHook(() => useOrientation());
    expect(result.current).toBe('desktop');
  });

  it('returns portrait-mobile when mobile viewport in portrait', () => {
    installMatchMedia([
      { query: '(orientation: portrait)', matches: true },
      { query: '(max-width: 900px)', matches: true },
    ]);
    const { result } = renderHook(() => useOrientation());
    expect(result.current).toBe('portrait-mobile');
  });

  it('returns landscape when mobile viewport in landscape', () => {
    installMatchMedia([
      { query: '(orientation: portrait)', matches: false },
      { query: '(max-width: 900px)', matches: true },
    ]);
    const { result } = renderHook(() => useOrientation());
    expect(result.current).toBe('landscape');
  });

  it('updates state on orientationchange event', () => {
    const records = installMatchMedia([
      { query: '(orientation: portrait)', matches: true },
      { query: '(max-width: 900px)', matches: true },
    ]);
    const { result } = renderHook(() => useOrientation());
    expect(result.current).toBe('portrait-mobile');
    act(() => {
      const rec = records.find((r) => r.query === '(orientation: portrait)')!;
      rec.matches = false;
      window.dispatchEvent(new Event('orientationchange'));
    });
    expect(result.current).toBe('landscape');
  });

  it('cleans up listeners on unmount', () => {
    const records = installMatchMedia([
      { query: '(orientation: portrait)', matches: true },
      { query: '(max-width: 900px)', matches: true },
    ]);
    const { unmount } = renderHook(() => useOrientation());
    const portraitRec = records.find((r) => r.query === '(orientation: portrait)')!;
    expect(portraitRec.listeners.size).toBe(1);
    unmount();
    expect(portraitRec.listeners.size).toBe(0);
  });
});

describe('lockLandscape', () => {
  it('returns false when screen.orientation.lock is unavailable', async () => {
    // @ts-expect-error stubbing
    window.screen.orientation = undefined;
    expect(await lockLandscape()).toBe(false);
  });

  it('returns true when lock resolves', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    // @ts-expect-error stubbing
    window.screen.orientation = { lock };
    document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    expect(await lockLandscape()).toBe(true);
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  it('returns false on lock rejection (iOS Safari)', async () => {
    const lock = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    // @ts-expect-error stubbing
    window.screen.orientation = { lock };
    document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    expect(await lockLandscape()).toBe(false);
  });
});
