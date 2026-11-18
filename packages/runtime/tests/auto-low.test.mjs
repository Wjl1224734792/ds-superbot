/**
 * Limited auto-low: dispatch without issuing a Mandate; R2/R3 /
 * requireHuman / sensitive touches still wait for a human.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createThread,
  createWorkItem,
  listMandates,
} from '../../constitution/src/index.mjs';
import * as runtime from '../src/index.mjs';
import { tmpRoot } from './lib/helpers.mjs';

function seed(root, overrides = {}) {
  if (!overrides.skipThread) {
    try {
      createThread(root, { slug: 'repo-ops-ci', title: 'CI', channels: [] }, { write: true });
    } catch {
      // already exists
    }
  }
  return createWorkItem(root, {
    thread: 'TH-repo-ops-ci',
    intent: '整理文档索引',
    risk: 'R1',
    reversible: true,
    authority: 'policy:auto-low',
    ac: [{ id: 'AC-1', text: '索引可读', coveredBy: ['T1'] }],
    nonGoals: [],
    scope: { files: ['docs/README.md'], newFiles: [], owners: ['pm'] },
    gates: ['validate-plan', 'verify'],
    origin: { kind: 'human', ref: 'manual', evidence: [] },
    ...overrides,
  }, { write: true }).document;
}

test('dispatchAutoLow runs for auto-low without issuing a Mandate', (t) => {
  const root = tmpRoot(t);
  const item = seed(root);
  const check = runtime.canApplyAutoLow(root, item);
  assert.equal(check.allowed, true);
  assert.equal(check.ruleId, 'auto-low');
  assert.equal(check.requireHuman, false);

  const out = runtime.dispatchAutoLow(root, { workItem: item });
  assert.equal(out.applied, true);
  assert.equal(out.issued, false);
  assert.equal(out.mandate, null);
  assert.equal(out.dispatched, true);
  assert.equal(out.started, false);
  assert.equal(out.network, false);
  assert.equal(out.autoMerge, false);
  assert.equal(out.authority, 'observe');
  assert.equal(runtime.DEFAULT_AUTHORITY, 'observe');
  assert.ok(out.route);
  assert.ok(out.assignment);
  assert.equal(out.dispatch.started, false);
  assert.equal(out.dispatch.process, null);
  assert.equal(listMandates(root).length, 0);
  assert.equal(runtime.canExecute(root, item).allowed, false);
});

test('auto-low does not fire for R2, R3, requireHuman, or sensitive touches', (t) => {
  const root = tmpRoot(t);
  const r2 = seed(root, { id: 'WI-2026-802', risk: 'R2', authority: 'human-approval', intent: '改计费' });
  const r3 = seed(root, { id: 'WI-2026-803', skipThread: true, risk: 'R3', authority: 'human-approval', intent: '删生产数据' });
  const touched = seed(root, {
    id: 'WI-2026-804',
    skipThread: true,
    risk: 'R1',
    reversible: true,
    authority: 'policy:auto-low',
    intent: '碰密钥',
    touches: ['secrets'],
  });
  const human = seed(root, {
    id: 'WI-2026-805',
    skipThread: true,
    risk: 'R1',
    reversible: true,
    authority: 'human-approval',
    intent: '需人批的低风险',
  });

  const r2Out = runtime.dispatchAutoLow(root, { workItem: r2 });
  assert.equal(r2Out.applied, false);
  assert.equal(r2Out.issued, false);
  assert.equal(r2Out.dispatched, false);
  assert.ok(['risk-human-gated', 'require-human', 'human-approval', 'not-auto-low'].includes(r2Out.reason));

  const r3Out = runtime.dispatchAutoLow(root, { workItem: r3 });
  assert.equal(r3Out.applied, false);
  assert.ok(['risk-human-gated', 'require-human', 'human-approval', 'not-auto-low'].includes(r3Out.reason));

  const touchOut = runtime.dispatchAutoLow(root, { workItem: touched });
  assert.equal(touchOut.applied, false);
  assert.equal(touchOut.requireHuman, true);
  assert.ok(['require-human', 'not-auto-low', 'human-critical'].includes(touchOut.reason) || touchOut.ruleId === 'human-critical');

  const humanOut = runtime.dispatchAutoLow(root, { workItem: human });
  assert.equal(humanOut.applied, false);
  assert.equal(humanOut.reason, 'human-approval');

  assert.equal(listMandates(root).length, 0);
  assert.equal(runtime.DEFAULT_AUTHORITY, 'observe');
  assert.throws(
    () => runtime.dispatchAutoLow(root, { workItem: seed(root, { id: 'WI-2026-806', skipThread: true }), autoMerge: true }),
    (err) => err.code === 'AUTO_MERGE_DISABLED',
  );
});
