// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LevelLadder } from '@/components/LevelLadder';

describe('LevelLadder', () => {
  it('renders 13 rungs labeled 2 through A', () => {
    const { container } = render(<LevelLadder was="2" now="2" />);
    const rungs = container.querySelectorAll('.ladder__rung');
    expect(rungs).toHaveLength(13);
    expect(rungs[0]?.textContent).toBe('2');
    expect(rungs[12]?.textContent).toBe('A');
  });

  it('marks was + now + passed rungs for a 5 → 8 upgrade', () => {
    const { container } = render(<LevelLadder was="5" now="8" />);
    const rungs = container.querySelectorAll('.ladder__rung');
    // Index 3 = "5" → was
    expect(rungs[3]?.className).toContain('ladder__rung--was');
    // Index 6 = "8" → now
    expect(rungs[6]?.className).toContain('ladder__rung--now');
    // Indices 4 (6) + 5 (7) → passed
    expect(rungs[4]?.className).toContain('ladder__rung--passed');
    expect(rungs[5]?.className).toContain('ladder__rung--passed');
    // Index 7 (9) should be plain
    expect(rungs[7]?.className).not.toContain('passed');
    expect(rungs[7]?.className).not.toContain('was');
    expect(rungs[7]?.className).not.toContain('now');
  });

  it('handles same was=now (no upgrade)', () => {
    const { container } = render(<LevelLadder was="5" now="5" />);
    const rungs = container.querySelectorAll('.ladder__rung');
    // Index 3 = "5" → the "now" class wins when was===now (both indexes equal).
    // We render the now style — visually consistent with "where the team is".
    expect(rungs[3]?.className).toContain('ladder__rung--now');
  });

  it('provides accessible label', () => {
    const { getByRole } = render(<LevelLadder was="2" now="A" />);
    expect(getByRole('img').getAttribute('aria-label')).toBe(
      'level upgrade from 2 to A'
    );
  });
});
