import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as runtime from '../src/index.mjs';
import { createThread, saveDocument } from '../../constitution/src/index.mjs';
import { tmpRoot } from './lib/helpers.mjs';

function posixPath(value) {
  return String(value).replaceAll('\\', '/');
}

test('separate describes storage under .superbot/ledger and compute under tmp/superbot', (t) => {
  const root = tmpRoot(t);
  const split = runtime.separate(root, { runId: 'run-demo' });
  assert.equal(split.storageRel, '.superbot/ledger');
  assert.equal(split.computeRel, 'tmp/superbot');
  assert.equal(split.workDir, 'tmp/superbot/run-demo/');
  assert.ok(posixPath(split.storageRoot).endsWith('.superbot/ledger'));
  assert.ok(posixPath(split.computeRoot).endsWith('tmp/superbot'));
  assert.ok(posixPath(split.eventsPath).endsWith('.superbot/ledger/events.jsonl'));
  const storage = runtime.assertStoragePath(root);
  const compute = runtime.assertComputePath(root, split.workDir);
  assert.equal(storage, split.storageRoot);
  assert.ok(posixPath(compute).endsWith('tmp/superbot/run-demo'));
});

test('a compute path cannot be used as a ledger root', (t) => {
  const root = tmpRoot(t);
  mkdirSync(join(root, 'tmp/superbot/run-1'), { recursive: true });
  const compute = join(root, 'tmp/superbot/run-1');
  assert.throws(() => runtime.assertStoragePath(compute), /compute path cannot be used as a ledger root/);
  assert.throws(() => runtime.separate(compute), /compute path cannot be used as a ledger root/);
  assert.throws(
    () => createThread(compute, { slug: 'nope', title: 'Nope', channels: ['group://x'] }, { write: true }),
    /compute path cannot be used as a ledger root/,
  );
  assert.equal(existsSync(join(compute, '.superbot/ledger/threads/TH-nope.json')), false);
});

test('assertComputePath rejects ledger and escaped paths; assignment workDir stays under tmp/superbot', (t) => {
  const root = tmpRoot(t);
  assert.throws(() => runtime.assertComputePath(root, '.superbot/ledger/threads'), /cannot point at the ledger|must stay under/);
  assert.throws(() => runtime.assertComputePath(root, 'src/app.js'), /must stay under/);
  assert.throws(() => runtime.assertComputePath(root, join(root, '..', 'outside')), /escapes repository root/);
  const assignment = runtime.createAssignment({
    workItem: { id: 'WI-2026-009', scope: { files: [], newFiles: [] } },
    runId: 'run-iso',
    root,
  });
  assert.equal(assignment.workDir, 'tmp/superbot/run-iso/');
  assert.doesNotThrow(() => runtime.assertComputePath(root, assignment.workDir));
});

test('execution helpers refuse to write ledger documents directly', () => {
  assert.throws(() => runtime.writeLedgerDocument(), (err) => {
    assert.equal(err.code, 'STORAGE_COMPUTE_SEPARATION');
    assert.match(err.message, /must not write ledger documents/);
    return true;
  });
  assert.throws(() => runtime.refuseLedgerWrite(), /must not write ledger documents/);
  assert.throws(() => runtime.assignment.writeLedgerDocument(), /must not write ledger documents/);
});

test('ledger writes stay out of tmp/superbot and business source', (t) => {
  const root = tmpRoot(t);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/app.js'), 'export const n = 1;\n');
  mkdirSync(join(root, 'tmp/superbot/run-1'), { recursive: true });
  const before = readFileSync(join(root, 'src/app.js'), 'utf8');
  const saved = createThread(root, {
    slug: 'ops',
    title: 'Ops',
    channels: ['group://repo-ops'],
  }, { write: true });
  assert.match(posixPath(saved.path), /\.superbot\/ledger\/threads\/TH-ops\.json$/);
  assert.equal(readFileSync(join(root, 'src/app.js'), 'utf8'), before);
  assert.equal(existsSync(join(root, 'tmp/superbot/run-1/TH-ops.json')), false);
  assert.throws(
    () => saveDocument(join(root, 'tmp/superbot/run-1'), 'thread', {
      schemaVersion: 1, id: 'TH-x', title: 'X', channels: [], workItems: [],
      createdAt: '2026-11-18T00:00:00+08:00', updatedAt: '2026-11-18T00:00:00+08:00',
    }, { write: true }),
    /compute path cannot be used as a ledger root/,
  );
});
