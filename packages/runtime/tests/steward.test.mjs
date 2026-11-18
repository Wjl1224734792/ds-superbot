import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../src/index.mjs';
import { getWorkItem } from '../../constitution/src/index.mjs';
import { tmpRoot } from './lib/helpers.mjs';

test('createModelPort default is rules-only and never calls a network', async () => {
  const port = runtime.steward.createModelPort();
  assert.equal(port.kind, 'rules');
  const out = await port.complete('classify-signal', { text: 'CI is red' });
  assert.equal(out.via, 'rules');
  assert.equal(out.result.usable, true);
});

test('createModelPort uses an injected invoke and still returns the rules draft', async () => {
  const calls = [];
  const port = runtime.createModelPort({
    invoke: async (task, input, rules) => {
      calls.push({ task, input, rules });
      return { intent: 'refined', from: 'model' };
    },
  });
  assert.equal(port.kind, 'model');
  const out = await port.complete('draft-intent', { text: 'fix ci' });
  assert.equal(out.via, 'model');
  assert.deepEqual(out.result, { intent: 'refined', from: 'model' });
  assert.equal(out.rules.via, 'rules');
  assert.equal(calls.length, 1);
});

test('steward.assign prepares an isolation structure but does not start a process', (t) => {
  const root = tmpRoot(t);
  const out = runtime.assign({
    root,
    workItem: { id: 'WI-2026-009', scope: { files: ['x.js'], newFiles: [] } },
    mandate: { id: 'MD-WI-2026-009', toolsWhitelist: ['read'], budget: { tokens: 10, minutes: 5 } },
  });
  assert.equal(out.executed, false);
  assert.equal(out.started, false);
  assert.equal(out.authority, 'observe');
  assert.equal(out.wouldAccept, true);
  assert.ok(!('pid' in out.assignment));
  const recorded = runtime.listWouldAccept(root);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].action, 'assign');
  assert.equal(recorded[0].executed, false);
});

test('steward.assign refuses auto-merge', () => {
  assert.throws(
    () => runtime.assign({ workItem: { id: 'WI-2026-009' }, action: 'merge' }),
    (err) => err.code === 'AUTO_MERGE_DISABLED',
  );
  assert.throws(
    () => runtime.resolveAuthority('auto-merge'),
    (err) => err.code === 'AUTO_MERGE_DISABLED',
  );
});

test('filter.slowPath is a lightweight rule pass, not NOT_IMPLEMENTED', () => {
  const ok = runtime.slowPath({ text: 'CI is red', risk: 'R2' });
  assert.equal(ok.accept, true);
  assert.equal(ok.requireHuman, true);
  const empty = runtime.slowPath({ text: '' });
  assert.equal(empty.accept, false);
  assert.equal(empty.reason, 'l2-empty-intent');
});

test('steward.consider proposes a Candidate without an @-mention and does not execute', (t) => {
  const root = tmpRoot(t);
  const out = runtime.consider({
    source: 'ci',
    text: 'CI is red on main',
    intent: '把主干 CI 红灯修掉',
    mentioned: false,
    ref: 'github://owner/repo/actions/1',
    risk: 'R1',
    reversible: true,
  }, { root });
  assert.equal(out.accepted, true);
  assert.equal(out.executed, false);
  assert.equal(out.mentioned, false);
  assert.equal(out.authority, 'observe');
  assert.equal(out.workItem.state, 'Candidate');
  assert.equal(out.workItem.origin.kind, 'trigger');
  assert.ok(out.workItem.origin.evidence.length >= 1);

  const stored = getWorkItem(root, out.workItem.id);
  assert.equal(stored.state, 'Candidate');
  assert.equal(stored.mandate, null);

  const would = runtime.listWouldAccept(root);
  assert.equal(would.some((w) => w.action === 'propose-candidate' && w.executed === false && w.would.execute === false), true);

  // Still no worker, no merge, no Authorized leap.
  assert.notEqual(stored.state, 'Authorized');
  assert.notEqual(stored.state, 'Building');
});

test('steward.consider drops L1 chatter and creates no work item', (t) => {
  const root = tmpRoot(t);
  const out = runtime.consider({ source: 'human', text: 'lol', mentioned: false }, { root });
  assert.equal(out.accepted, false);
  assert.equal(out.stage, 'l1');
  assert.equal(out.workItem, null);
  assert.equal(out.executed, false);
});
