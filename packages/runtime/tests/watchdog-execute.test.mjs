import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as runtime from '../src/index.mjs';
import {
  createThread,
  createWorkItem,
  createSnapshot,
  getMandate,
  getWorkItem,
  issueMandate,
  isLegalTransition,
  PARK_FROM,
  saveDocument,
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

function putState(root, item, state, extra = {}) {
  const next = { ...item, state, ...extra };
  saveDocument(root, 'workitem', next, { write: true });
  return getWorkItem(root, item.id);
}

function issueFor(root, item, { expiresAt, now, snapshot } = {}) {
  const snap = snapshot ?? createSnapshot(root, { write: true }).document;
  const issuedNow = now ?? new Date('2026-11-18T08:00:00+08:00');
  return issueMandate(root, {
    workItem: item.id,
    issuedBy: 'human:owner',
    issuedAt: '2026-11-18T08:00:00+08:00',
    expiresAt: expiresAt ?? '2026-11-19T08:00:00+08:00',
    constitution_snapshot: snap.id,
    goal: item.intent,
    ac: item.ac,
    nonGoals: item.nonGoals,
    scope: item.scope,
    toolsWhitelist: ['shell', 'read'],
    budget: { tokens: 10000, minutes: 60 },
    evidenceRequired: ['verify'],
  }, { write: true, now: issuedNow }).document;
}

test('observe and auto still only record would-accept and never revoke or Park', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root, { id: 'WI-2026-301' });
  const snap = createSnapshot(root, { write: true }).document;
  const mandate = issueFor(root, item, {
    snapshot: snap,
    expiresAt: '2026-11-02T00:00:00+08:00',
    now: new Date('2026-11-01T00:00:00+08:00'),
  });
  putState(root, { ...item, mandate: mandate.id, constitution_snapshot: snap.id }, 'Building', {
    updatedAt: '2026-11-18T08:00:00+08:00',
  });

  runtime.watchdog.start({ root, idleAfterMinutes: 30, authority: 'observe' });
  const now = new Date('2026-11-18T12:00:00+08:00');
  const tick = runtime.watchdog.tick({ root, now });
  assert.equal(tick.authority, 'observe');
  assert.equal(tick.executed, false);
  assert.ok(tick.wouldAccept.some((w) => w.action === 'park'));
  assert.ok(tick.wouldAccept.some((w) => w.action === 'revoke'));
  for (const w of tick.wouldAccept) assert.equal(w.executed, false);
  assert.equal(getMandate(root, mandate.id).revokedAt, null);
  assert.equal(getWorkItem(root, item.id).state, 'Building');

  const autoTick = runtime.watchdog.tick({ root, now, authority: 'auto' });
  assert.equal(autoTick.executed, false);
  assert.equal(getMandate(root, mandate.id).revokedAt, null);
  assert.equal(getWorkItem(root, item.id).state, 'Building');
});

test('execute idle actually revokes with timeout and Parks from Building', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root, { id: 'WI-2026-302' });
  const snap = createSnapshot(root, { write: true }).document;
  const mandate = issueFor(root, item, { snapshot: snap });
  putState(root, { ...item, mandate: mandate.id, constitution_snapshot: snap.id }, 'Building', {
    updatedAt: '2026-11-18T08:00:00+08:00',
  });

  runtime.watchdog.start({ root, idleAfterMinutes: 30, authority: 'execute' });
  const tick = runtime.watchdog.tick({
    root,
    now: new Date('2026-11-18T12:00:00+08:00'),
    authority: 'execute',
  });
  assert.equal(tick.executed, true);
  assert.ok(tick.actions.some((a) => a.type === 'revoke' && a.reason === 'timeout'));
  assert.ok(tick.actions.some((a) => a.type === 'park' && a.from === 'Building'));
  assert.equal(getMandate(root, mandate.id).revokedAt != null, true);
  assert.equal(getMandate(root, mandate.id).revokeReason, 'timeout');
  assert.equal(getWorkItem(root, item.id).state, 'Parked');
});

test('execute expired mandate revokes with expired and Parks', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root, { id: 'WI-2026-303' });
  const snap = createSnapshot(root, { write: true }).document;
  const mandate = issueFor(root, item, {
    snapshot: snap,
    expiresAt: '2026-11-18T09:00:00+08:00',
    now: new Date('2026-11-18T08:00:00+08:00'),
  });
  // Fresh update so this is not also an idle timeout.
  putState(root, { ...item, mandate: mandate.id, constitution_snapshot: snap.id }, 'Approved', {
    updatedAt: '2026-11-18T12:00:00+08:00',
  });

  const tick = runtime.watchdog.tick({
    root,
    now: new Date('2026-11-18T12:05:00+08:00'),
    authority: 'execute',
    idleAfterMinutes: 60,
  });
  assert.equal(tick.executed, true);
  assert.ok(tick.actions.some((a) => a.reason === 'expired'));
  assert.equal(getMandate(root, mandate.id).revokeReason, 'expired');
  assert.equal(getWorkItem(root, item.id).state, 'Parked');
});

test('execute document drift revokes with snapshot-stale and Parks; unbound snapshot is not drift', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root, { id: 'WI-2026-304' });
  const snap = createSnapshot(root, { write: true }).document;
  const mandate = issueFor(root, item, { snapshot: snap });
  putState(root, { ...item, mandate: mandate.id, constitution_snapshot: snap.id }, 'Verifying', {
    updatedAt: '2026-11-18T12:00:00+08:00',
  });

  writeFileSync(join(root, 'docs/03-契约/API接口.md'), '# API\n\nchanged canon.\n');

  const tick = runtime.watchdog.tick({
    root,
    now: new Date('2026-11-18T12:05:00+08:00'),
    authority: 'execute',
    idleAfterMinutes: 60,
  });
  assert.equal(tick.executed, true);
  assert.ok(tick.drift.some((d) => d.workItem === item.id));
  assert.ok(tick.actions.some((a) => a.reason === 'snapshot-stale'));
  assert.equal(getMandate(root, mandate.id).revokeReason, 'snapshot-stale');
  assert.equal(getWorkItem(root, item.id).state, 'Parked');

  // A second work item with no bound snapshot must not invent a drift failure.
  const unbound = seedItem(root, { id: 'WI-2026-305', skipThread: true });
  putState(root, unbound, 'Building', { updatedAt: '2026-11-18T12:00:00+08:00' });
  const tick2 = runtime.watchdog.tick({
    root,
    now: new Date('2026-11-18T12:06:00+08:00'),
    authority: 'execute',
    idleAfterMinutes: 60,
  });
  assert.equal(tick2.drift.some((d) => d.workItem === unbound.id), false);
  assert.equal(getWorkItem(root, unbound.id).state, 'Building');
});

test('Watchdog can Park every extended in-flight state', (t) => {
  const root = tmpRoot(t);
  const states = ['Authorized', 'Planned', 'Approved', 'Building', 'Verifying'];
  for (const [i, state] of states.entries()) {
    assert.equal(isLegalTransition(state, 'Parked'), true, `${state} → Parked should be legal`);
    const id = `WI-2026-${310 + i}`;
    const item = seedItem(root, { id, skipThread: i > 0 });
    const snap = createSnapshot(root, { write: true }).document;
    const mandate = issueFor(root, item, { snapshot: snap });
    putState(root, { ...item, mandate: mandate.id, constitution_snapshot: snap.id }, state, {
      updatedAt: '2026-11-18T08:00:00+08:00',
    });
  }
  assert.ok(PARK_FROM.includes('Authorized'));
  const tick = runtime.watchdog.tick({
    root,
    now: new Date('2026-11-18T12:00:00+08:00'),
    authority: 'execute',
    idleAfterMinutes: 30,
  });
  assert.equal(tick.executed, true);
  for (const [i, state] of states.entries()) {
    const id = `WI-2026-${310 + i}`;
    assert.equal(getWorkItem(root, id).state, 'Parked', `${state} should have been Parked`);
  }
});

test('after a human Mandate, default observe still executes that item only', (t) => {
  const root = tmpRoot(t);
  const approved = seedItem(root, { id: 'WI-2026-321' });
  const sibling = seedItem(root, { id: 'WI-2026-322', skipThread: true, intent: '未被批准的兄弟项' });
  const snap = createSnapshot(root, { write: true }).document;
  const mandate = issueFor(root, approved, { snapshot: snap });
  putState(root, { ...approved, mandate: mandate.id, constitution_snapshot: snap.id }, 'Building', {
    updatedAt: '2026-11-18T08:00:00+08:00',
  });
  putState(root, sibling, 'Building', {
    updatedAt: '2026-11-18T08:00:00+08:00',
  });

  runtime.watchdog.start({ root, idleAfterMinutes: 30, authority: 'observe' });
  const tick = runtime.watchdog.tick({
    root,
    now: new Date('2026-11-18T12:00:00+08:00'),
    authority: 'observe',
  });

  assert.equal(runtime.DEFAULT_AUTHORITY, 'observe');
  assert.equal(tick.authority, 'observe');
  assert.equal(tick.executed, true);
  assert.ok(tick.actions.some((a) => a.workItem === approved.id && a.type === 'revoke' && a.reason === 'timeout'));
  assert.ok(tick.actions.some((a) => a.workItem === approved.id && a.type === 'park'));
  assert.equal(getMandate(root, mandate.id).revokedAt != null, true);
  assert.equal(getWorkItem(root, approved.id).state, 'Parked');

  assert.equal(tick.actions.some((a) => a.workItem === sibling.id), false);
  assert.ok(tick.wouldAccept.some((w) => w.workItem === sibling.id && w.action === 'park' && w.executed === false));
  assert.equal(getWorkItem(root, sibling.id).state, 'Building');
});

test('itemAuthorities observe override keeps an approved item hands-off', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root, { id: 'WI-2026-323' });
  const snap = createSnapshot(root, { write: true }).document;
  const mandate = issueFor(root, item, { snapshot: snap });
  putState(root, { ...item, mandate: mandate.id, constitution_snapshot: snap.id }, 'Building', {
    updatedAt: '2026-11-18T08:00:00+08:00',
  });

  const tick = runtime.watchdog.tick({
    root,
    now: new Date('2026-11-18T12:00:00+08:00'),
    authority: 'observe',
    idleAfterMinutes: 30,
    itemAuthorities: { [item.id]: 'observe' },
  });
  assert.equal(tick.authority, 'observe');
  assert.equal(tick.executed, false);
  assert.ok(tick.wouldAccept.some((w) => w.workItem === item.id));
  assert.equal(getMandate(root, mandate.id).revokedAt, null);
  assert.equal(getWorkItem(root, item.id).state, 'Building');
});

test('halt and over-budget stay record-only even when the approved item is execute', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root, { id: 'WI-2026-324' });
  const snap = createSnapshot(root, { write: true }).document;
  const mandate = issueFor(root, item, { snapshot: snap });
  // Fresh update: not idle, mandate unexpired, snapshot still bound.
  putState(root, { ...item, mandate: mandate.id, constitution_snapshot: snap.id }, 'Building', {
    updatedAt: '2026-11-18T12:00:00+08:00',
  });

  const tick = runtime.watchdog.tick({
    root,
    now: new Date('2026-11-18T12:05:00+08:00'),
    authority: 'observe',
    idleAfterMinutes: 60,
    usage: { [item.id]: { tokens: 50000, minutes: 120 } },
  });
  assert.equal(tick.authority, 'observe');
  assert.equal(tick.executed, false);
  assert.ok(tick.cost.some((row) => row.workItem === item.id && row.overBudget === true));
  assert.ok(tick.wouldAccept.some((w) => w.action === 'halt' && w.executed === false));
  assert.equal(getMandate(root, mandate.id).revokedAt, null);
  assert.equal(getWorkItem(root, item.id).state, 'Building');
});
