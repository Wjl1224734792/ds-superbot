/**
 * Shim regression: calling scripts through the plugin package path must keep
 * --help text and exit codes identical to the constitution SSOT.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const SSOT = join(HERE, '../scripts');
const SHIM = join(HERE, '../../dsh-plugin/scripts');

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

function same(a, b, label) {
  assert.equal(a.status, b.status, `${label} exit`);
  assert.equal(a.stdout, b.stdout, `${label} stdout`);
  assert.equal(a.stderr, b.stderr, `${label} stderr`);
}

for (const name of ['docs-ready.mjs', 'validate-plan.mjs', 'docs-gate.mjs']) {
  test(`shim ${name} --help matches SSOT`, () => {
    const ssot = run(join(SSOT, name), ['--help']);
    const shim = run(join(SHIM, name), ['--help']);
    same(ssot, shim, name);
    // docs-ready / docs-gate implement --help (exit 0). validate-plan never did;
    // the shim must still match that pre-migration behaviour exactly.
    if (name !== 'validate-plan.mjs') {
      assert.equal(shim.status, 0);
      assert.match(`${shim.stdout}${shim.stderr}`, new RegExp(name.replace('.', '\\.')));
    }
  });
}

test('docs-ready rejects a missing root with exit 2 via the shim', () => {
  const ssot = run(join(SSOT, 'docs-ready.mjs'), [join(HERE, 'does-not-exist-xyz'), 'check']);
  const shim = run(join(SHIM, 'docs-ready.mjs'), [join(HERE, 'does-not-exist-xyz'), 'check']);
  same(ssot, shim, 'missing-root');
  assert.equal(shim.status, 2);
});

test('validate-plan and docs-gate reject a missing root with exit 2 via the shim', () => {
  const missing = join(HERE, 'does-not-exist-xyz');
  for (const [name, args] of [
    ['validate-plan.mjs', [missing]],
    ['docs-gate.mjs', [missing, 'check']],
  ]) {
    const ssot = run(join(SSOT, name), args);
    const shim = run(join(SHIM, name), args);
    same(ssot, shim, name);
    assert.equal(shim.status, 2, name);
  }
});
