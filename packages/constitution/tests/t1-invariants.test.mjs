/**
 * P7: INVARIANTS.md is part of take-over T1. --write generates it only
 * when missing and never overwrites an existing file.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { T1_FILES } from '../scripts/lib/t1-files.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TAKE_OVER = join(HERE, '../scripts/take-over.mjs');
const DOC_CHECK = join(HERE, '../scripts/doc/doc-check.mjs');
const INVARIANTS = 'docs/project/INVARIANTS.md';

function tmpProject(t) {
  const root = mkdtempSync(join(tmpdir(), 'superbot-t1-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'fixture-t1', scripts: { test: 'node --test' } }, null, 2)}\n`);
  return root;
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

test('T1_FILES includes INVARIANTS.md and the rest of the project-memory set', () => {
  assert.ok(T1_FILES.includes('AGENTS.md'));
  assert.ok(T1_FILES.includes(INVARIANTS));
  assert.ok(T1_FILES.includes('docs/project/CONSTITUTION.md'));
  assert.ok(T1_FILES.includes('docs/project/HEALTH.md'));
  assert.equal(T1_FILES.length, 8);
  assert.deepEqual(
    T1_FILES.filter((file) => file.startsWith('docs/project/')),
    [
      'docs/project/CONSTITUTION.md',
      'docs/project/ARCHITECTURE.md',
      'docs/project/DECISIONS.md',
      'docs/project/INVARIANTS.md',
      'docs/project/RUNBOOK.md',
      'docs/project/CHANGELOG.md',
      'docs/project/HEALTH.md',
    ],
  );
});

test('take-over --write generates INVARIANTS.md when missing and does not overwrite it', (t) => {
  const root = tmpProject(t);
  const first = run(TAKE_OVER, [root, '--write', '--json']);
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(first.stdout);
  assert.ok(report.generated.includes(INVARIANTS), JSON.stringify(report.generated));
  assert.ok(T1_FILES.every((file) => report.generated.includes(file) || report.skipped.includes(file)));
  const generated = readFileSync(join(root, INVARIANTS), 'utf8');
  assert.match(generated, /INVARIANTS/);
  assert.match(generated, /fixture-t1/);

  const marker = '# INVARIANTS — kept by test\n\nexisting body\n';
  writeFileSync(join(root, INVARIANTS), marker);
  const second = run(TAKE_OVER, [root, '--write', '--json']);
  assert.equal(second.status, 0, second.stderr);
  const again = JSON.parse(second.stdout);
  assert.ok(again.skipped.includes(INVARIANTS));
  assert.equal(again.generated.includes(INVARIANTS), false);
  assert.equal(readFileSync(join(root, INVARIANTS), 'utf8'), marker);
});

test('doc-check treats missing INVARIANTS.md as a T1 gap at tier 3', (t) => {
  const root = tmpProject(t);
  mkdirSync(join(root, 'docs/project'), { recursive: true });
  for (const file of T1_FILES) {
    if (file === INVARIANTS) continue;
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), `# ${file}\n`);
  }
  const missing = run(DOC_CHECK, [root, '--tier', '3', '--json']);
  assert.equal(missing.status, 1, missing.stderr + missing.stdout);
  assert.match(missing.stdout + missing.stderr, /INVARIANTS\.md/);

  writeFileSync(join(root, INVARIANTS), '# INVARIANTS\n');
  const present = run(DOC_CHECK, [root, '--tier', '3', '--json']);
  const payload = JSON.parse(present.stdout || '{}');
  const errors = payload.errors ?? [];
  assert.equal(errors.some((row) => String(row.message ?? row.code ?? '').includes('INVARIANTS')), false);
});
