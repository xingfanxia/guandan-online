import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/security/grep-no-leak.sh');

function runScript(): { code: number; output: string } {
  try {
    const output = execFileSync('bash', [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

describe('grep-no-leak.sh — clean baseline', () => {
  it('exits 0 with no violations', () => {
    const r = runScript();
    expect(r.code).toBe(0);
    expect(r.output).toContain('no direct publish/append/xadd');
  });
});

describe('grep-no-leak.sh — detects an injected violation', () => {
  const violationDir = resolve(REPO_ROOT, 'lib/__leak_test_tmp__');
  const violationFile = resolve(violationDir, 'leaky.ts');

  it('exits non-zero when a non-allowlisted file calls .publish(', () => {
    mkdirSync(violationDir, { recursive: true });
    writeFileSync(
      violationFile,
      `// Test fixture — simulates a leak.
export function leakySend(bus: { publish: (c: string, p: unknown) => Promise<void> }, payload: unknown): Promise<void> {
  return bus.publish('any-channel', payload);
}
`
    );

    const r = runScript();
    try {
      expect(r.code).toBe(1);
      expect(r.output).toMatch(/prohibited direct/i);
      expect(r.output).toContain('leaky.ts');
    } finally {
      rmSync(violationDir, { recursive: true, force: true });
    }
  });

  it('returns to clean after the violation is removed', () => {
    try {
      unlinkSync(violationFile);
    } catch {
      /* already deleted */
    }
    try {
      rmSync(violationDir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
    const r = runScript();
    expect(r.code).toBe(0);
  });
});
