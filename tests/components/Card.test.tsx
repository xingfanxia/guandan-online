// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Card } from '@/components/Card';
import type { Card as GameCard } from '@lib/game/cards';

const heartA: GameCard = { suit: 'hearts', rank: 'A', deck: 1 };
const spade7: GameCard = { suit: 'spades', rank: '7', deck: 2 };
const ten: GameCard = { suit: 'diamonds', rank: '10', deck: 1 };
const redJoker: GameCard = { suit: 'joker', rank: 'RJ', deck: 1 };
const blackJoker: GameCard = { suit: 'joker', rank: 'BJ', deck: 1 };

describe('Card', () => {
  it('renders rank + suit glyph for natural card', () => {
    render(<Card card={heartA} />);
    const el = screen.getByLabelText(/A of hearts/i);
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('card', 'card--red');
    expect(el.querySelector('.card__rank')?.textContent).toBe('A');
    expect(el.querySelectorAll('.card__suit')[0]?.textContent).toBe('♥');
  });

  it('renders "10" as two characters (not "T")', () => {
    render(<Card card={ten} />);
    expect(screen.getByLabelText(/10 of diamonds/i).querySelector('.card__rank')?.textContent).toBe('10');
  });

  it('marks spade as non-red', () => {
    render(<Card card={spade7} />);
    expect(screen.getByLabelText(/7 of spades/i)).not.toHaveClass('card--red');
  });

  it('renders big joker with star glyph and 大王 label', () => {
    render(<Card card={redJoker} />);
    const el = screen.getByLabelText('大王');
    expect(el).toBeInTheDocument();
    expect(el.querySelector('.card__center')?.textContent).toBe('★');
  });

  it('renders small joker with 小王 label', () => {
    render(<Card card={blackJoker} />);
    expect(screen.getByLabelText('小王')).toBeInTheDocument();
  });

  it('applies card--lifted when lifted prop is true', () => {
    render(<Card card={heartA} lifted />);
    expect(screen.getByLabelText(/A of hearts/i)).toHaveClass('card--lifted');
  });

  it('applies card--wild when isWildcard prop is true', () => {
    render(<Card card={heartA} isWildcard />);
    expect(screen.getByLabelText(/A of hearts/i)).toHaveClass('card--wild');
  });

  it('applies card--md and card--lg size variants', () => {
    const { rerender } = render(<Card card={heartA} size="md" />);
    expect(screen.getByLabelText(/A of hearts/i)).toHaveClass('card--md');
    rerender(<Card card={heartA} size="lg" />);
    expect(screen.getByLabelText(/A of hearts/i)).toHaveClass('card--lg');
  });

  it('renders face-down card without rank/suit text', () => {
    render(<Card faceDown ariaLabel="opp-card" />);
    const el = screen.getByLabelText('opp-card');
    expect(el).toHaveClass('card--back');
    expect(el.querySelector('.card__rank')).toBeNull();
  });

  it('fires onClick when clicked and renders as a real <button>', () => {
    const handler = vi.fn();
    render(<Card card={heartA} onClick={handler} />);
    const el = screen.getByLabelText(/A of hearts/i);
    // Native <button> gives implicit role + tab focus + Enter/Space activation
    // — the previous `<div role="button">` had none of that (WCAG 2.1.1).
    expect(el.tagName).toBe('BUTTON');
    expect(el).toHaveAttribute('type', 'button');
    fireEvent.click(el);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keyboard activation fires onClick on interactive Card (WCAG 2.1.1)', () => {
    const handler = vi.fn();
    render(<Card card={heartA} onClick={handler} />);
    const el = screen.getByLabelText(/A of hearts/i);
    // Native buttons fire onClick on Enter/Space activation. fireEvent.click
    // is the semantic equivalent.
    fireEvent.click(el);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('non-interactive Card renders as <div> (no implicit button role)', () => {
    render(<Card card={heartA} />);
    const el = screen.getByLabelText(/A of hearts/i);
    expect(el.tagName).toBe('DIV');
  });

  it('sets data-rank, data-suit, data-deck attributes for natural card', () => {
    render(<Card card={heartA} />);
    const el = screen.getByLabelText(/A of hearts/i);
    expect(el).toHaveAttribute('data-rank', 'A');
    expect(el).toHaveAttribute('data-suit', 'hearts');
    expect(el).toHaveAttribute('data-deck', '1');
  });
});
