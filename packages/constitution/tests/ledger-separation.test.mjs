import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertLedgerPath,
  assertLedgerRoot,
  createThread,
  isComputePath,
  LEDGER_REL,
  COMPUTE_REL,
  saveDocument,
  documentPath,
} from '../src/index.mjs';
import { ConstitutionError } from '../src/errors.mjs';

function posixPath(value) {
  return String(value).replaceAll('\\', '/');
}

function tmpRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'constitution-sep-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'AGENTS.md'), '# AGENTS\n\nfixture.\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.js'), 'export const n = 1;\n');
  mkdirSync(join(root, 'packages/app'), { recursive: true });
  writeFileSync(join(root, 'packages/app/index.js'), 'export default {}\n');
  mkdirSync(join(root, 'tmp/superbot/run-1'), { recursive: true });
  writeFileSync(join(root, 'tmp/superbot/run-1/scratch.txt'), 'compute scratch\n');
  return root;
}

test('isComputePath detects tmp/superbot workDirs and not ordinary /tmp fixtures', () => {
  assert.equal(isComputePath('tmp/superbot/run-1/'), true);
  assert.equal(isComputePath('tmp/superbot/run-1/03-plan.json'), true);
  assert.equal(isComputePath('/tmp/constitution-abc'), false);
  assert.equal(isComputePath('/tmp/runtime-p1-xyz'), false);
});

test('ledger API refuses a compute path as the root and does not write there', (t) => {
  const root = tmpRoot(t);
  const compute = join(root, 'tmp/superbot/run-1');
  assert.throws(() => assertLedgerRoot(compute), ConstitutionError);
  assert.throws(
    () => saveDocument(compute, 'thread', {
      schemaVersion: 1,
      id: 'TH-escape',
      title: 'should not land',
      channels: [],
      workItems: [],
      createdAt: '2026-11-18T00:00:00+08:00',
      updatedAt: '2026-11-18T00:00:00+08:00',
    }, { write: true }),
    /compute path cannot be used as a ledger root/,
  );
  assert.equal(existsSync(join(compute, '.superbot/ledger/threads/TH-escape.json')), false);
  assert.equal(readFileSync(join(compute, 'scratch.txt'), 'utf8'), 'compute scratch\n');
});

test('ledger API will not write into tmp/superbot or business source', (t) => {
  const root = tmpRoot(t);
  const srcBefore = readFileSync(join(root, 'src/app.js'), 'utf8');
  const pkgBefore = readFileSync(join(root, 'packages/app/index.js'), 'utf8');
  const scratchBefore = readFileSync(join(root, 'tmp/superbot/run-1/scratch.txt'), 'utf8');

  assert.throws(() => assertLedgerPath(root, 'src/app.js'), /business source|must stay under/);
  assert.throws(() => assertLedgerPath(root, 'packages/app/index.js'), /business source|must stay under/);
  assert.throws(() => assertLedgerPath(root, 'tmp/superbot/run-1/scratch.txt'), /tmp\/superbot|must stay under/);
  assert.throws(() => documentPath(root, 'thread', '../src/app'), /unsafe ledger id/);
  assert.throws(() => documentPath(root, 'workitem', 'WI-2026-001/../../src/app'), /unsafe ledger id/);

  const saved = createThread(root, {
    slug: 'repo-ops',
    title: 'Ops',
    channels: ['group://repo-ops'],
  }, { write: true });
  assert.equal(saved.written, true);
  assert.match(posixPath(saved.path), /\.superbot\/ledger\/threads\/TH-repo-ops\.json$/);

  assert.equal(readFileSync(join(root, 'src/app.js'), 'utf8'), srcBefore);
  assert.equal(readFileSync(join(root, 'packages/app/index.js'), 'utf8'), pkgBefore);
  assert.equal(readFileSync(join(root, 'tmp/superbot/run-1/scratch.txt'), 'utf8'), scratchBefore);
  assert.equal(existsSync(join(root, LEDGER_REL, 'threads', 'TH-repo-ops.json')), true);
  assert.equal(existsSync(join(root, COMPUTE_REL, 'run-1', 'TH-repo-ops.json')), false);
});

test('successful ledger writes stay under .superbot/ledger and cannot escape the repo root', (t) => {
  const root = tmpRoot(t);
  const path = assertLedgerPath(root, join(root, LEDGER_REL, 'events.jsonl'));
  assert.ok(posixPath(path).endsWith(`${LEDGER_REL}/events.jsonl`));
  assert.ok(path.startsWith(root));
  assert.throws(() => assertLedgerPath(root, join(root, '..', 'outside.json')), /escapes repository root|must stay under/);
});
