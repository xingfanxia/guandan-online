// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Avatar } from '@/components/Avatar';

describe('Avatar', () => {
  it('renders first two chars of handle as initials, stripping @', () => {
    render(<Avatar handle="@阿祥" />);
    expect(screen.getByLabelText(/@阿祥/)).toHaveTextContent('阿祥');
  });

  it('uppercases Latin initials', () => {
    render(<Avatar handle="alice" />);
    expect(screen.getByLabelText(/alice/i)).toHaveTextContent('AL');
  });

  it('applies role + size classes', () => {
    render(<Avatar handle="@豆豆" role="rival-1" size="lg" />);
    const el = screen.getByLabelText(/@豆豆/);
    expect(el).toHaveClass('avatar', 'avatar--lg', 'avatar--rival-1');
  });

  it('applies team color variants', () => {
    render(<Avatar handle="@甲" role="team-A" />);
    const el = screen.getByLabelText(/@甲/);
    expect(el).toHaveClass('avatar--team-A');
  });

  it('adds avatar--active when active=true', () => {
    render(<Avatar handle="@毛毛" active />);
    expect(screen.getByLabelText(/turn active/i)).toHaveClass('avatar--active');
  });

  it('attaches onClick handler and switches role to button', () => {
    const handler = vi.fn();
    render(<Avatar handle="@小李" onClick={handler} />);
    const el = screen.getByLabelText(/@小李/);
    expect(el).toHaveAttribute('role', 'button');
    fireEvent.click(el);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('writes data-handle attribute', () => {
    render(<Avatar handle="@aria" />);
    expect(screen.getByLabelText(/@aria/)).toHaveAttribute('data-handle', '@aria');
  });
});
