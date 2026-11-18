import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../src/index.mjs';
import { tmpRoot } from './lib/helpers.mjs';

test('DEFAULT_AUTHORITY is observe and auto-merge is disabled', () => {
  assert.equal(runtime.DEFAULT_AUTHORITY, 'observe');
  assert.equal(runtime.resolveAuthority(), 'observe');
  assert.throws(() => runtime.assertNoAutoMerge('auto-merge'), (err) => err.code === 'AUTO_MERGE_DISABLED');
});

test('recordWouldAccept persists would-accept events and never marks them executed', (t) => {
  const root = tmpRoot(t);
  const rec = runtime.recordWouldAccept(root, {
    action: 'assign',
    workItem: 'WI-2026-001',
    reason: 'policy would allow assign',
    would: { assign: true, execute: true, merge: true },
  });
  assert.equal(rec.executed, false);
  assert.equal(rec.would.execute, false);
  assert.equal(rec.would.merge, false);
  assert.equal(rec.persisted, true);
  const listed = runtime.listWouldAccept(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, rec.id);
  assert.equal(listed[0].executed, false);
});
