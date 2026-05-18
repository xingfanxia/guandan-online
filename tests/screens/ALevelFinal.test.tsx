// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ALevelFinal } from '@/screens/ALevelFinal';

describe('ALevelFinal', () => {
  it('renders banner + children inside tinted wrapper', () => {
    render(
      <ALevelFinal
        aTeam="t1"
        aTeamLabel="我方"
        strictMode
        failCount={0}
        failCap={3}
        isOwnRound
      >
        <div data-testid="child">child content</div>
      </ALevelFinal>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('我方', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/A 头/)).toBeInTheDocument();
    expect(screen.getByText(/严格 A 模式/)).toBeInTheDocument();
  });

  it('shows fail counter only in strict mode', () => {
    const { rerender } = render(
      <ALevelFinal
        aTeam="t1"
        aTeamLabel="我方"
        strictMode
        failCount={1}
        failCap={3}
        isOwnRound
      >
        <span>x</span>
      </ALevelFinal>
    );
    expect(screen.getByText(/A 失利 1\/3/)).toBeInTheDocument();
    rerender(
      <ALevelFinal
        aTeam="t1"
        aTeamLabel="我方"
        strictMode={false}
        failCount={1}
        failCap={3}
        isOwnRound
      >
        <span>x</span>
      </ALevelFinal>
    );
    expect(screen.queryByText(/A 失利/)).not.toBeInTheDocument();
  });

  it('changes title when defending opponent A round', () => {
    render(
      <ALevelFinal
        aTeam="t2"
        aTeamLabel="对方"
        strictMode
        failCount={0}
        failCap={3}
        isOwnRound={false}
      >
        <span>x</span>
      </ALevelFinal>
    );
    expect(screen.getByText(/对方 A · 顶住/)).toBeInTheDocument();
  });
});
