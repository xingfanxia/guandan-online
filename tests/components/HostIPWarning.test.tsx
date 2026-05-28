// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HostIPWarning } from '@/components/HostIPWarning';

describe('HostIPWarning', () => {
  it('renders nothing when there are no groups', () => {
    const { container } = render(<HostIPWarning groups={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders a warning row for a 2-player collision', () => {
    render(
      <HostIPWarning groups={[{ ipHash: 'h1', handles: ['@阿祥', '@老郭'] }]} />
    );
    const row = screen.getByText(/2 名玩家可能来自同一网络/);
    expect(row).toBeInTheDocument();
    expect(row).toHaveTextContent('@阿祥');
    expect(row).toHaveTextContent('@老郭');
  });

  it('shows the correct count for a 3-player collision', () => {
    render(
      <HostIPWarning
        groups={[{ ipHash: 'h1', handles: ['@a', '@b', '@c'] }]}
      />
    );
    expect(screen.getByText(/3 名玩家可能来自同一网络/)).toBeInTheDocument();
  });

  it('renders one row per group when there are multiple collisions', () => {
    render(
      <HostIPWarning
        groups={[
          { ipHash: 'office', handles: ['@a', '@c'] },
          { ipHash: 'home', handles: ['@b', '@d'] },
        ]}
      />
    );
    expect(screen.getByText(/@a、@c/)).toBeInTheDocument();
    expect(screen.getByText(/@b、@d/)).toBeInTheDocument();
  });

  it('exposes the warning as an accessible status region', () => {
    render(<HostIPWarning groups={[{ ipHash: 'h1', handles: ['@a', '@b'] }]} />);
    expect(screen.getByRole('status', { name: '同一网络提示' })).toBeInTheDocument();
  });

  it('joins handles with a Chinese enumeration comma', () => {
    render(
      <HostIPWarning groups={[{ ipHash: 'h1', handles: ['@a', '@b', '@c'] }]} />
    );
    expect(screen.getByText(/@a、@b、@c/)).toBeInTheDocument();
  });
});
