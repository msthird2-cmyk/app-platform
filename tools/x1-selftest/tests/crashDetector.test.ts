import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Hermes job's verdict comes out of a shell script, and the part of it that
 * decides "the app crashed" was the part with no coverage at all. It failed a
 * healthy run by matching `beginning of crash` — a logcat buffer separator that
 * any process on the device can produce — and the run it failed was one where
 * every assertion later passed on a re-run of the same commit.
 *
 * The fixtures live in the script, because the script owns the pattern and a
 * copy here would be a copy that can drift. `--self-check` runs them. What this
 * asserts is that each case ran and reached the stated verdict, so a self-check
 * quietly reduced to nothing cannot pass here either.
 *
 * `execFileSync` throws on a non-zero exit, so a failing self-check fails this
 * file outright rather than being read as a missing expectation.
 */
const SCRIPT = fileURLToPath(
  new URL('../../../.github/scripts/run-x1-selftest.sh', import.meta.url),
);

const output = execFileSync('bash', [SCRIPT, '--self-check'], { encoding: 'utf8' });

describe('the Hermes crash detector', () => {
  it('does not read another process crashing as this app crashing', () => {
    expect(output).toContain('self-check ok   [unrelated process crash] detected=no');
  });

  it('still detects each way the app under test can die', () => {
    expect(output).toContain('self-check ok   [target app java crash] detected=yes');
    expect(output).toContain('self-check ok   [target app native crash] detected=yes');
    expect(output).toContain('self-check ok   [target app process death] detected=yes');
  });

  it('reports no failing case', () => {
    expect(output).not.toContain('self-check FAIL');
  });
});
