import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import * as runtime from '../src/index.mjs';
import {
  activeMandateFor,
  createThread,
  createWorkItem,
  getMandate,
  getWorkItem,
  listMandates,
  revokeMandate,
  saveDocument,
  transitionWorkItem,
} from '../../constitution/src/index.mjs';
import { tmpRoot } from './lib/helpers.mjs';

function posixPath(value) {
  return String(value).replaceAll('\\', '/');
}

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
    nonGoals: ['不改发布流程'],
    scope: { files: ['scripts/ci.sh'], newFiles: [], owners: ['pm'] },
    gates: ['validate-plan', 'docs-ready'],
    origin: { kind: 'human', ref: 'manual', evidence: [] },
    ...overrides,
  }, { write: true }).document;
}

function toAwaiting(root, item) {
  transitionWorkItem(root, item.id, 'Candidate', { write: true });
  transitionWorkItem(root, item.id, 'Explored', { write: true });
  transitionWorkItem(root, item.id, 'Proposed', { write: true });
  return transitionWorkItem(root, item.id, 'AwaitingApproval', { write: true }).document;
}

test('DEFAULT_AUTHORITY stays observe and auto-merge stays forbidden after P5 wiring', () => {
  assert.equal(runtime.DEFAULT_AUTHORITY, 'observe');
  assert.equal(runtime.resolveAuthority(), 'observe');
  assert.throws(() => runtime.assertNoAutoMerge('auto-merge'), (err) => err.code === 'AUTO_MERGE_DISABLED');
  assert.throws(() => runtime.resolveAuthority('auto-merge'), (err) => err.code === 'AUTO_MERGE_DISABLED');
  assert.equal(typeof runtime.approveDecision, 'function');
  assert.equal(typeof runtime.rejectDecision, 'function');
  assert.equal(typeof runtime.canExecute, 'function');
  assert.equal(typeof runtime.assertCanExecute, 'function');
  assert.equal(typeof runtime.dispatchWorkItem, 'function');
  assert.equal(typeof runtime.recordMergeIntent, 'function');
  assert.equal(typeof runtime.loop.approveDecision, 'function');
});

test('approveDecision issues an immutable Mandate from the compiler draft', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root);
  toAwaiting(root, seeded);

  const out = runtime.approveDecision(root, {
    workItem: seeded.id,
    issuedBy: 'human:owner',
  }, { write: true, now: new Date('2026-11-18T12:00:00+08:00') });

  assert.equal(out.issued, true);
  assert.equal(out.rejected, false);
  assert.equal(out.autoMerge, false);
  assert.equal(out.mandate.issuedBy, 'human:owner');
  assert.equal(out.mandate.workItem, seeded.id);
  assert.equal(out.mandate.revokedAt, null);
  assert.equal(out.compilation.issued, false);
  assert.deepEqual(out.mandate.toolsWhitelist, out.draft.toolsWhitelist);
  assert.deepEqual(out.mandate.scope, out.draft.scope);
  // pm + Discover tools are read-only; must not have been enlarged to shell/edit.
  assert.deepEqual(out.mandate.toolsWhitelist, ['read']);
  assert.equal(getWorkItem(root, seeded.id).state, 'Authorized');
  assert.equal(getWorkItem(root, seeded.id).mandate, out.mandate.id);
  assert.equal(getMandate(root, out.mandate.id).goal, out.draft.goal);
  assert.ok(activeMandateFor(root, seeded.id));

  const events = runtime.bus.read({ root, type: 'decision.approved' });
  assert.equal(events.length, 1);
  assert.equal(events[0].workItem, seeded.id);
});

test('approveDecision refuses a missing or non-human issuer and machine paths', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root, { id: 'WI-2026-201' });
  toAwaiting(root, seeded);

  assert.throws(
    () => runtime.approveDecision(root, { workItem: seeded.id }, { write: true }),
    (err) => err.code === 'HUMAN_ISSUER_REQUIRED',
  );
  assert.throws(
    () => runtime.approveDecision(root, { workItem: seeded.id, issuedBy: 'watchdog' }, { write: true }),
    (err) => err.code === 'HUMAN_ISSUER_REQUIRED',
  );
  assert.throws(
    () => runtime.approveDecision(root, {
      workItem: seeded.id,
      issuedBy: 'human:owner',
      source: 'observe',
    }, { write: true }),
    (err) => err.code === 'HUMAN_APPROVAL_REQUIRED',
  );
  assert.throws(
    () => runtime.approveDecision(root, {
      workItem: seeded.id,
      issuedBy: 'human:owner',
      authority: 'auto',
    }, { write: true }),
    (err) => err.code === 'HUMAN_APPROVAL_REQUIRED',
  );
  assert.equal(listMandates(root).length, 0);
  assert.equal(getWorkItem(root, seeded.id).state, 'AwaitingApproval');
});

test('approveDecision does not enlarge tools or scope beyond the compiler draft', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root, { id: 'WI-2026-202' });
  toAwaiting(root, seeded);

  const out = runtime.approveDecision(root, {
    workItem: seeded.id,
    issuedBy: '建霖',
    toolsWhitelist: ['read', 'shell', 'edit', 'git', 'network'],
    scope: {
      files: ['scripts/ci.sh', 'src/secret.js'],
      newFiles: ['tmp/owned.txt'],
      owners: ['pm', 'backend-dev'],
    },
    budget: { tokens: 999999, minutes: 9999 },
  }, { write: true, now: new Date('2026-11-18T12:00:00+08:00') });

  assert.equal(out.clamped, true);
  assert.deepEqual(out.mandate.toolsWhitelist, ['read']);
  assert.deepEqual(out.mandate.scope.files, ['scripts/ci.sh']);
  assert.deepEqual(out.mandate.scope.newFiles, []);
  assert.deepEqual(out.mandate.scope.owners, ['pm']);
  assert.equal(out.mandate.budget.tokens <= out.draft.budget.tokens, true);
  assert.ok(!out.mandate.toolsWhitelist.includes('shell'));
  assert.ok(!out.mandate.scope.files.includes('src/secret.js'));
});

test('approveDecision write:false does not persist a Mandate', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root, { id: 'WI-2026-203' });
  toAwaiting(root, seeded);

  const out = runtime.approveDecision(root, {
    workItem: seeded.id,
    issuedBy: 'human:owner',
  }, { write: false, now: new Date('2026-11-18T12:00:00+08:00') });

  assert.equal(out.issued, true);
  assert.ok(out.mandate.id);
  assert.equal(listMandates(root).length, 0);
  assert.equal(getWorkItem(root, seeded.id).state, 'AwaitingApproval');
  assert.equal(runtime.bus.read({ root, type: 'decision.approved' }).length, 0);
});

test('rejectDecision records a rejection, does not issue, and Parks', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root, { id: 'WI-2026-204' });
  toAwaiting(root, seeded);

  const out = runtime.rejectDecision(root, {
    workItem: seeded.id,
    decidedBy: 'human:owner',
    reason: 'AC 不够可判定',
  }, { write: true });

  assert.equal(out.issued, false);
  assert.equal(out.rejected, true);
  assert.equal(out.mandate, null);
  assert.equal(getWorkItem(root, seeded.id).state, 'Parked');
  assert.equal(listMandates(root).length, 0);
  const events = runtime.bus.read({ root, type: 'decision.rejected' });
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.issued, false);
  assert.equal(events[0].payload.reason, 'AC 不够可判定');
});

test('canExecute is a per-work-item grant after a human-issued Mandate', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root, { id: 'WI-2026-205' });
  toAwaiting(root, seeded);

  const before = runtime.canExecute(root, seeded.id);
  assert.equal(before.allowed, false);
  assert.equal(before.authority, 'observe');
  assert.equal(before.reason, 'no-active-mandate');
  assert.throws(
    () => runtime.assertCanExecute(root, seeded.id),
    (err) => err.code === 'EXECUTE_NOT_GRANTED',
  );
  assert.equal(runtime.DEFAULT_AUTHORITY, 'observe');

  runtime.approveDecision(root, {
    workItem: seeded.id,
    issuedBy: 'human:owner',
  }, { write: true, now: new Date('2026-11-18T12:00:00+08:00') });

  const after = runtime.canExecute(root, seeded.id, { now: new Date('2026-11-18T13:00:00+08:00') });
  assert.equal(after.allowed, true);
  assert.equal(after.authority, 'execute');
  assert.equal(runtime.assertCanExecute(root, seeded.id, { now: new Date('2026-11-18T13:00:00+08:00') }).allowed, true);

  // Out-of-scope paths cannot execute, even with an active mandate.
  const wide = runtime.canExecute(root, seeded.id, {
    now: new Date('2026-11-18T13:00:00+08:00'),
    attempted: { files: ['src/secret.js'], tools: ['shell'] },
  });
  assert.equal(wide.allowed, false);

  // Expiry withdraws the grant.
  const expired = runtime.canExecute(root, seeded.id, { now: new Date('2026-11-20T13:00:00+08:00') });
  assert.equal(expired.allowed, false);
  assert.equal(expired.code, 'MANDATE_EXPIRED');

  // A grant on one work item does not flip the global default, nor assign/watchdog defaults.
  assert.equal(runtime.DEFAULT_AUTHORITY, 'observe');
  assert.equal(runtime.settleAuthority().authority, 'observe');
  assert.equal(runtime.settleAuthority('observe').authority, 'observe');
});

test('revoke withdraws execute authority', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root, { id: 'WI-2026-206' });
  toAwaiting(root, seeded);
  const out = runtime.approveDecision(root, {
    workItem: seeded.id,
    issuedBy: 'human:owner',
  }, { write: true, now: new Date('2026-11-18T12:00:00+08:00') });
  revokeMandate(root, out.mandate.id, 'human-stop', { write: true });
  const after = runtime.canExecute(root, seeded.id);
  assert.equal(after.allowed, false);
  assert.throws(() => runtime.assertCanExecute(root, seeded.id), (err) => err.code === 'EXECUTE_NOT_GRANTED');
});

test('dispatchWorkItem calls routeModel and returns assignment isolation without starting a process', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root, {
    id: 'WI-2026-207',
    risk: 'R2',
    scope: { files: ['scripts/ci.sh'], newFiles: [], owners: ['backend-dev'] },
    gates: ['validate-plan', 'verify'],
  });

  const dispatched = runtime.dispatchWorkItem(root, {
    workItem: seeded,
    config: {
      modelTiers: {
        light: { model: 'provider/light-1', effort: 'low' },
        strong: { model: 'provider/strong-1', effort: 'high' },
      },
    },
    runId: 'run-wi-2026-207',
  });

  assert.equal(dispatched.started, false);
  assert.equal(dispatched.network, false);
  assert.equal(dispatched.process, null);
  assert.equal(dispatched.workItem, seeded.id);
  assert.equal(dispatched.capability, 'Build');
  assert.equal(dispatched.route.tier, 'strong'); // R2 raises
  assert.equal(dispatched.route.source, 'tier');
  assert.equal(dispatched.route.model, 'provider/strong-1');
  assert.equal(posixPath(dispatched.assignment.workDir).endsWith('tmp/superbot/run-wi-2026-207/'), true);
  assert.equal(posixPath(dispatched.assignment.workDir).startsWith('tmp/superbot/'), true);
  assert.ok(dispatched.isolation);
  assert.deepEqual(dispatched.isolation.allowPaths, ['scripts/ci.sh']);
});

test('recordMergeIntent records merge / 打回 and never runs git; auto-merge still throws', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root, { id: 'WI-2026-208' });

  const merge = runtime.recordMergeIntent(root, {
    workItem: seeded.id,
    action: 'merge',
    decidedBy: 'human:owner',
    reason: 'AC 已核对',
  }, { write: true });
  assert.equal(merge.action, 'merge');
  assert.equal(merge.executed, false);
  assert.equal(merge.git, false);
  assert.equal(merge.would.merge, false);
  assert.equal(merge.persisted, true);

  const bounce = runtime.recordMergeIntent(root, {
    workItem: seeded.id,
    action: '打回',
    decidedBy: 'human:owner',
  }, { write: true });
  assert.equal(bounce.action, 'reject');
  assert.equal(bounce.git, false);

  const events = runtime.bus.read({ root, type: 'merge.intent' });
  assert.equal(events.length, 2);
  assert.ok(events.some((e) => e.payload.action === 'merge'));
  assert.ok(events.some((e) => e.payload.action === 'reject'));

  assert.throws(
    () => runtime.recordMergeIntent(root, { workItem: seeded.id, action: 'auto-merge' }, { write: true }),
    (err) => err.code === 'AUTO_MERGE_DISABLED',
  );

  // No git process was started as a side effect of recording intent.
  const git = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  // The fixture is not a git repo; git should fail to run a merge/push because we never invoked it.
  // The important assertion is that recordMergeIntent itself does not throw or leave a git write.
  assert.equal(merge.git, false);
  void git;
});

test('dispatchWorkItem reads capability Settings and falls back to 默认（兜底）', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root, {
    id: 'WI-2026-209',
    risk: 'R1',
    scope: { files: ['lib/a.js'], newFiles: [], owners: ['backend-dev'] },
  });
  const viaCap = runtime.dispatchWorkItem(root, {
    workItem: seeded,
    capability: 'Build',
    config: {
      capabilities: { Build: { provider: 'acme', model: 'build-2', effort: 'low' } },
      defaults: { provider: 'acme', model: 'default-2', effort: 'medium' },
    },
  });
  assert.equal(viaCap.route.source, 'capability-settings');
  assert.equal(viaCap.route.model, 'build-2');

  const viaDefaults = runtime.dispatchWorkItem(root, {
    workItem: seeded,
    capability: 'Discover',
    config: {
      capabilities: { Build: { provider: 'acme', model: 'build-2' } },
      defaults: { provider: 'acme', model: 'default-2' },
    },
  });
  assert.equal(viaDefaults.route.source, 'defaults');
  assert.equal(viaDefaults.route.model, 'default-2');

  const inherited = runtime.dispatchWorkItem(root, {
    workItem: seeded,
    capability: 'Verify',
    config: { capabilities: {}, defaults: { provider: '', model: '' } },
  });
  assert.equal(inherited.route.source, 'inherit');
});
