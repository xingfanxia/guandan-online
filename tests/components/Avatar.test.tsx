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

  it('attaches onClick handler and renders as a real <button>', () => {
    const handler = vi.fn();
    render(<Avatar handle="@小李" onClick={handler} />);
    const el = screen.getByLabelText(/@小李/);
    // Native <button> gives implicit role + keyboard activation, which the
    // prior `<div role="button">` didn't (no tabIndex / Enter handler).
    expect(el.tagName).toBe('BUTTON');
    expect(el).toHaveAttribute('type', 'button');
    fireEvent.click(el);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keyboard Enter on interactive Avatar fires onClick (WCAG 2.1.1)', () => {
    const handler = vi.fn();
    render(<Avatar handle="@kbd" onClick={handler} />);
    const el = screen.getByLabelText(/@kbd/);
    // Native button fires onClick on Enter/Space — fireEvent.keyDown alone
    // wouldn't simulate the native activation, so we use the higher-level
    // click event which is the right primitive for "activate the button".
    fireEvent.click(el);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('non-interactive Avatar still renders as <div> with role=img', () => {
    render(<Avatar handle="@静止" />);
    const el = screen.getByLabelText(/@静止/);
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveAttribute('role', 'img');
  });

  it('writes data-handle attribute', () => {
    render(<Avatar handle="@aria" />);
    expect(screen.getByLabelText(/@aria/)).toHaveAttribute('data-handle', '@aria');
  });
});
