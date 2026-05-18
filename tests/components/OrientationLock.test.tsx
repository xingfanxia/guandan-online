// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  });

  it('renders children when orientation is desktop', () => {
    render(
      <OrientationLock overrideOrientation="desktop">
        <div data-testid="game">GAME</div>
      </OrientationLock>,
    );
    expect(screen.getByTestId('game')).toBeInTheDocument();
  });

  it('renders RotatePrompt instead of children when portrait-mobile', () => {
    render(
      <OrientationLock overrideOrientation="portrait-mobile">
        <div data-testid="game">GAME</div>
      </OrientationLock>,
    );
    expect(screen.queryByTestId('game')).toBeNull();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('请横屏游戏')).toBeInTheDocument();
  });
});
