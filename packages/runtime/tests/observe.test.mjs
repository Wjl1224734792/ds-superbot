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


test('resolveAuthority distinguishes auto grayscale from auto-merge', () => {
  assert.equal(runtime.resolveAuthority('auto'), 'auto');
  assert.throws(() => runtime.resolveAuthority('auto-merge'), (err) => err.code === 'AUTO_MERGE_DISABLED');
  assert.throws(() => runtime.assertNoAutoMerge('auto-merge'), (err) => err.code === 'AUTO_MERGE_DISABLED');
  assert.throws(() => runtime.assertNoAutoMerge('merge'), (err) => err.code === 'AUTO_MERGE_DISABLED');
  assert.equal(runtime.assertNoAutoMerge('auto'), true);
});

test('evaluateAuto refuses auto when no persisted observe record exists', (t) => {
  const root = tmpRoot(t);
  const out = runtime.evaluateAuto({
    root,
    action: 'assign',
    requested: 'auto',
    risk: 'R1',
    reversible: true,
  });
  assert.equal(out.allowed, false);
  assert.equal(out.authority, 'observe');
  assert.equal(out.reason, 'no-persisted-observe-record');
  assert.equal(out.would.merge, false);
  assert.equal(runtime.canEnterAuto({
    root,
    action: 'assign',
    requested: 'auto',
    risk: 'R1',
    reversible: true,
  }), false);
});

test('evaluateAuto allows auto grayscale after a matching would-accept record, but never merges', (t) => {
  const root = tmpRoot(t);
  const rec = runtime.recordWouldAccept(root, {
    action: 'assign',
    workItem: 'WI-2026-040',
    risk: 'R1',
    reason: 'prior observe of assign',
    would: { assign: true, execute: true, merge: true },
  });
  assert.equal(rec.executed, false);
  assert.equal(rec.persisted, true);
  const out = runtime.evaluateAuto({
    root,
    action: 'assign',
    requested: 'auto',
    risk: 'R1',
    reversible: true,
  });
  assert.equal(out.allowed, true);
  assert.equal(out.authority, 'auto');
  assert.equal(out.reason, 'observe-record-matched');
  assert.equal(out.would.merge, false);
  assert.equal(out.would.execute, false);
  assert.equal(out.matched.id, rec.id);
  // A different risk band does not match.
  const other = runtime.evaluateAuto({
    root,
    action: 'assign',
    requested: 'auto',
    risk: 'R0',
    reversible: true,
  });
  assert.equal(other.allowed, false);
  assert.equal(other.reason, 'no-persisted-observe-record');
});

test('evaluateAuto still throws on auto-merge and refuses R2/R3 and human-approval', (t) => {
  const root = tmpRoot(t);
  runtime.recordWouldAccept(root, { action: 'assign', risk: 'R2', would: { assign: true } });
  assert.throws(
    () => runtime.evaluateAuto({ root, action: 'auto-merge', requested: 'auto', risk: 'R1', reversible: true }),
    (err) => err.code === 'AUTO_MERGE_DISABLED',
  );
  assert.throws(
    () => runtime.evaluateAuto({ root, action: 'merge', requested: 'auto', risk: 'R1', reversible: true }),
    (err) => err.code === 'AUTO_MERGE_DISABLED',
  );
  const r2 = runtime.evaluateAuto({
    root, action: 'assign', requested: 'auto', risk: 'R2', reversible: true,
  });
  assert.equal(r2.allowed, false);
  assert.equal(r2.authority, 'observe');
  assert.equal(r2.reason, 'risk-human-gated');
  const r3 = runtime.evaluateAuto({
    root, action: 'assign', requested: 'auto', risk: 'R3', reversible: true,
  });
  assert.equal(r3.allowed, false);
  assert.equal(r3.reason, 'risk-human-gated');
  runtime.recordWouldAccept(root, { action: 'assign', risk: 'R1', would: { assign: true } });
  const human = runtime.evaluateAuto({
    root, action: 'assign', requested: 'auto', risk: 'R1', reversible: true, itemAuthority: 'human-approval',
  });
  assert.equal(human.allowed, false);
  assert.equal(human.reason, 'human-approval');
  const requireHuman = runtime.evaluateAuto({
    root, action: 'assign', requested: 'auto', risk: 'R1', reversible: true, requireHuman: true,
  });
  assert.equal(requireHuman.allowed, false);
  assert.equal(requireHuman.reason, 'human-approval');
  const touches = runtime.evaluateAuto({
    root, action: 'assign', requested: 'auto', risk: 'R1', reversible: true, touches: ['secrets'],
  });
  assert.equal(touches.allowed, false);
  assert.equal(touches.reason, 'touches-sensitive');
});

test('missing auto request stays observe, and an in-memory record is not enough', () => {
  const missing = runtime.evaluateAuto({ action: 'assign', risk: 'R1', reversible: true });
  assert.equal(missing.allowed, false);
  assert.equal(missing.reason, 'default-observe');
  assert.equal(missing.authority, 'observe');
  const ephemeral = runtime.recordWouldAccept(null, {
    action: 'assign', risk: 'R1', would: { assign: true },
  }, { write: false });
  assert.equal(ephemeral.persisted, false);
  const out = runtime.evaluateAuto({
    action: 'assign', requested: 'auto', risk: 'R1', reversible: true,
  });
  assert.equal(out.allowed, false);
  assert.equal(out.reason, 'no-persisted-observe-record');
});

test('assign with requested auto still does not start a worker or merge', (t) => {
  const root = tmpRoot(t);
  const refused = runtime.assign({
    root,
    workItem: { id: 'WI-2026-041', risk: 'R1', reversible: true },
    authority: 'auto',
  });
  assert.equal(refused.authority, 'observe');
  assert.equal(refused.executed, false);
  assert.equal(refused.started, false);
  assert.equal(refused.auto.allowed, false);

  const granted = runtime.assign({
    root,
    workItem: { id: 'WI-2026-041', risk: 'R1', reversible: true },
    authority: 'auto',
  });
  assert.equal(granted.authority, 'auto');
  assert.equal(granted.executed, false);
  assert.equal(granted.started, false);
  assert.equal(granted.auto.allowed, true);
  assert.equal(granted.wouldAcceptEvent.would.merge, false);
  assert.equal(granted.wouldAcceptEvent.executed, false);
});
