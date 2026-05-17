// Smoke test — confirms vitest runs and the type system / module resolution work.
// Will be removed once real test suites land (CORE-1 will replace this immediately).

import { describe, expect, it } from 'vitest';

describe('bootstrap smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
