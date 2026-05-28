// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerStatusBadge } from '@/components/PlayerStatusBadge';

describe('PlayerStatusBadge', () => {
  it('renders a subtle presence dot (no label text) for connected', () => {
    const { container } = render(<PlayerStatusBadge status="connected" />);
    const el = container.querySelector('.player-status-badge');
    expect(el).not.toBeNull();
    expect(el).toHaveClass('player-status-badge--connected');
    // No visible text — it's a dot, accessible via aria-label only.
    expect(el).toHaveTextContent('');
    expect(el).toHaveAttribute('aria-label', '在线');
  });

  it('renders 离线 for a disconnected human', () => {
    const { container } = render(<PlayerStatusBadge status="disconnected" />);
    expect(screen.getByText('离线')).toBeInTheDocument();
    expect(container.querySelector('.player-status-badge')).toHaveClass(
      'player-status-badge--disconnected'
    );
  });

  it('renders 代打 (进阶) for a bot that took over a disconnected human', () => {
    const { container } = render(
      <PlayerStatusBadge status="bot" isTakeover />
    );
    expect(screen.getByText('代打 (进阶)')).toBeInTheDocument();
    expect(container.querySelector('.player-status-badge')).toHaveClass(
      'player-status-badge--takeover'
    );
  });

  it('renders BOT for a genuine host-fill bot', () => {
    const { container } = render(<PlayerStatusBadge status="bot" />);
    expect(screen.getByText('BOT')).toBeInTheDocument();
    expect(container.querySelector('.player-status-badge')).toHaveClass(
      'player-status-badge--bot'
    );
  });

  it('treats a bot without isTakeover as a genuine bot (BOT, not 代打)', () => {
    render(<PlayerStatusBadge status="bot" isTakeover={false} />);
    expect(screen.getByText('BOT')).toBeInTheDocument();
    expect(screen.queryByText('代打 (进阶)')).not.toBeInTheDocument();
  });

  it('ignores isTakeover for a disconnected human (still 离线)', () => {
    // isTakeover only meaningfully applies to status='bot'; a disconnected
    // human renders 离线 regardless.
    render(<PlayerStatusBadge status="disconnected" isTakeover />);
    expect(screen.getByText('离线')).toBeInTheDocument();
    expect(screen.queryByText('代打 (进阶)')).not.toBeInTheDocument();
  });
});
