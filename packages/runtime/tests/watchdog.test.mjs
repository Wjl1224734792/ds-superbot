import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../src/index.mjs';
import {
  createThread, createWorkItem, createSnapshot, issueMandate,
  saveDocument, getWorkItem, getMandate,
} from '../../constitution/src/index.mjs';
import { tmpRoot } from './lib/helpers.mjs';

function seedItem(root, overrides = {}) {
  if (!overrides.skipThread) {
    try {
      createThread(root, { slug: 'repo-ops-ci', title: 'CI', channels: [] }, { write: true });
    } catch {
      // already exists
    }
  }
  return createWorkItem(root, {
    thread: 'TH-repo-ops-ci',
    intent: '把 CI 红灯率降到 0',
    risk: 'R2',
    reversible: true,
    authority: 'human-approval',
    ac: [{ id: 'AC-1', text: '主干最近 20 次 CI 全绿', coveredBy: ['T1'] }],
    nonGoals: [],
    scope: { files: [], newFiles: [], owners: ['backend-dev'] },
    gates: ['validate-plan', 'verify', 'review'],
    origin: { kind: 'human', ref: 'manual', evidence: [] },
    ...overrides,
  }, { write: true }).document;
}

function putState(root, item, state, updatedAt) {
  const next = { ...item, state, updatedAt };
  saveDocument(root, 'workitem', next, { write: true });
  return getWorkItem(root, item.id);
}

test('watchdog.tick reports progress, idle, and cost and only records would-accept in observe', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root);
  const snapshot = createSnapshot(root, { write: true }).document;
  const issuedNow = new Date('2026-11-01T00:00:00+08:00');
  const mandate = issueMandate(root, {
    workItem: item.id,
    issuedBy: 'human:owner',
    issuedAt: '2026-11-01T00:00:00+08:00',
    expiresAt: '2026-11-02T00:00:00+08:00',
    constitution_snapshot: snapshot.id,
    goal: item.intent,
    ac: item.ac,
    nonGoals: item.nonGoals,
    scope: item.scope,
    toolsWhitelist: ['shell', 'read'],
    budget: { tokens: 1000, minutes: 10 },
    evidenceRequired: ['verify'],
  }, { write: true, now: issuedNow }).document;

  putState(root, { ...item, mandate: mandate.id }, 'Building', '2026-11-18T08:00:00+08:00');

  const loop = runtime.watchdog.start({ root, idleAfterMinutes: 30, authority: 'observe' });
  assert.equal(loop.status, 'running');

  const now = new Date('2026-11-18T12:00:00+08:00'); // 4 hours idle, mandate expired
  const tick = runtime.watchdog.tick({
    root,
    id: loop.id,
    now,
    usage: { [item.id]: { tokens: 5000, minutes: 40 } },
  });

  assert.equal(tick.executed, false);
  assert.equal(tick.authority, 'observe');
  assert.equal(tick.progress.length, 1);
  assert.equal(tick.progress[0].state, 'Building');
  assert.ok(tick.idle.length >= 1);
  assert.equal(tick.cost[0].overBudget, true);
  assert.ok(tick.wouldAccept.some((w) => w.action === 'park'));
  assert.ok(tick.wouldAccept.some((w) => w.action === 'revoke'));
  assert.ok(tick.wouldAccept.some((w) => w.action === 'halt'));
  for (const w of tick.wouldAccept) {
    assert.equal(w.executed, false);
    assert.equal(w.would.execute, false);
    assert.equal(w.would.merge, false);
  }

  // Observe mode must not have revoked the mandate or parked the work item.
  assert.equal(getMandate(root, mandate.id).revokedAt, null);
  assert.equal(getWorkItem(root, item.id).state, 'Building');

  const events = runtime.bus.read({ root });
  assert.ok(events.some((e) => e.type === 'watchdog.progress'));
  assert.ok(events.some((e) => e.type === 'watchdog.idle'));
  assert.ok(events.some((e) => e.type === 'watchdog.cost'));

  const stopped = runtime.watchdog.stop(loop.id, { root, now });
  assert.equal(stopped.status, 'stopped');
});
