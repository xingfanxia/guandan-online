// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OrientationLock } from '@/components/OrientationLock';

describe('OrientationLock', () => {
  it('renders children when orientation is landscape', () => {
    render(
      <OrientationLock overrideOrientation="landscape">
        <div data-testid="game">GAME</div>
      </OrientationLock>,
    );
    expect(screen.getByTestId('game')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByTestId('orientation-rotate-wrapper')).toBeNull();
  });

  it('renders children when orientation is desktop', () => {
    render(
      <OrientationLock overrideOrientation="desktop">
        <div data-testid="game">GAME</div>
      </OrientationLock>,
    );
    expect(screen.getByTestId('game')).toBeInTheDocument();
    expect(screen.queryByTestId('orientation-rotate-wrapper')).toBeNull();
  });

  it('wraps children in rotate container when portrait-mobile (Update 2026-05-16: CSS rotate primary path)', () => {
    render(
      <OrientationLock overrideOrientation="portrait-mobile">
        <div data-testid="game">GAME</div>
      </OrientationLock>,
    );
    // Children still rendered — but inside the rotate wrapper.
    const wrapper = screen.getByTestId('orientation-rotate-wrapper');
    expect(wrapper).toBeInTheDocument();
    expect(wrapper).toContainElement(screen.getByTestId('game'));
    expect(wrapper).toHaveClass('orientation-rotate-active');
    // RotatePrompt is NOT shown — it's now an emergency fallback only.
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('renders children without rotate when text input is focused (so IME aligns)', () => {
    render(
      <OrientationLock overrideOrientation="portrait-mobile" overrideInputFocused>
        <div data-testid="game">
          <input type="text" data-testid="handle-input" />
        </div>
      </OrientationLock>,
    );
    // Children stay mounted (unmounting would close the keyboard) but the
    // rotate transform is suppressed via a bypass class.
    const bypass = screen.getByTestId('orientation-rotate-bypass');
    expect(bypass).toBeInTheDocument();
    expect(bypass).toContainElement(screen.getByTestId('handle-input'));
    expect(screen.queryByTestId('orientation-rotate-wrapper')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('keeps rotate wrapper when overrideInputFocused is explicitly false', () => {
    render(
      <OrientationLock overrideOrientation="portrait-mobile" overrideInputFocused={false}>
        <div data-testid="game">GAME</div>
      </OrientationLock>,
    );
    expect(screen.getByTestId('orientation-rotate-wrapper')).toBeInTheDocument();
    expect(screen.getByTestId('game')).toBeInTheDocument();
  });

  it('switches between rotate wrapper and bypass when text input focus changes (live listener)', () => {
    render(
      <OrientationLock overrideOrientation="portrait-mobile">
        <input type="text" data-testid="handle-input" />
      </OrientationLock>,
    );
    // Initially rotate wrapper is shown.
    expect(screen.getByTestId('orientation-rotate-wrapper')).toBeInTheDocument();
    // Focus the input — bypass takes over so the IME can render correctly.
    const input = screen.getByTestId('handle-input');
    fireEvent.focusIn(input);
    expect(screen.queryByTestId('orientation-rotate-wrapper')).toBeNull();
    expect(screen.getByTestId('orientation-rotate-bypass')).toBeInTheDocument();
    // Input is still mounted (critical — unmounting would close the IME).
    expect(screen.getByTestId('handle-input')).toBeInTheDocument();
    // Blur → wrapper returns. The input is the same element (still mounted).
    fireEvent.focusOut(screen.getByTestId('handle-input'));
    expect(screen.queryByTestId('orientation-rotate-bypass')).toBeNull();
    expect(screen.getByTestId('orientation-rotate-wrapper')).toBeInTheDocument();
  });

  it('ignores button focus (no IME) — wrapper stays', () => {
    render(
      <OrientationLock overrideOrientation="portrait-mobile">
        <button data-testid="play-btn">出牌</button>
      </OrientationLock>,
    );
    const btn = screen.getByTestId('play-btn');
    fireEvent.focusIn(btn);
    // Button focus shouldn't trigger fallback — only text inputs do.
    expect(screen.getByTestId('orientation-rotate-wrapper')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
