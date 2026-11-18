import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createThread,
  createWorkItem,
  getWorkItem,
  transitionWorkItem,
  issueMandate,
  revokeMandate,
  getMandate,
  createSnapshot,
  issueReceipt,
  renderCard,
  renderResultCard,
  REVOKE_REASONS,
  PARK_FROM,
  isLegalTransition,
  TERMINAL,
  STATES,
} from '../src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY = readFileSync(join(HERE, '../templates/policy.default.yaml'), 'utf8');

function tmpRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'constitution-p5-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'AGENTS.md'), '# AGENTS\n\nconstitution fixture.\n');
  writeFileSync(join(root, 'README.md'), '# Fixture\n\nA fixture project used by constitution tests.\n');
  mkdirSync(join(root, 'docs/03-契约'), { recursive: true });
  writeFileSync(join(root, 'docs/03-契约/API接口.md'), '# API\n\nBaseURL /api, 错误码 4001, 权限从凭据解析。\n');
  mkdirSync(join(root, '.superbot/policy'), { recursive: true });
  writeFileSync(join(root, '.superbot/policy/default.yaml'), DEFAULT_POLICY);
  return root;
}

function seedItem(root, overrides = {}) {
  createThread(root, { slug: 'repo-ops-ci', title: 'CI 持续变红', channels: ['group://repo-ops'] }, { write: true });
  return createWorkItem(root, {
    thread: 'TH-repo-ops-ci',
    intent: '把 CI 红灯率降到 0',
    risk: 'R2',
    reversible: true,
    authority: 'human-approval',
    ac: [{ id: 'AC-1', text: '主干最近 20 次 CI 全绿', coveredBy: ['T1'] }],
    nonGoals: ['不改发布流程'],
    scope: { files: ['scripts/ci.sh'], newFiles: [], owners: ['backend-dev'] },
    gates: ['validate-plan', 'verify'],
    origin: { kind: 'human', ref: 'manual', evidence: [] },
    ...overrides,
  }, { write: true }).document;
}

test('P5 Park edges are legal; other illegal transitions still fail', (t) => {
  const expected = ['Proposed', 'AwaitingApproval', 'Authorized', 'Planned', 'Approved', 'Building', 'Verifying'];
  assert.deepEqual([...PARK_FROM], expected);
  for (const from of expected) {
    assert.equal(isLegalTransition(from, 'Parked'), true, `${from} → Parked`);
  }
  assert.equal(isLegalTransition('Signal', 'Parked'), false);
  assert.equal(isLegalTransition('Candidate', 'Parked'), false);
  assert.equal(isLegalTransition('Explored', 'Parked'), false);
  for (const term of TERMINAL) {
    for (const to of STATES) {
      if (to !== term) assert.equal(isLegalTransition(term, to), false, `${term} → ${to}`);
    }
  }

  const root = tmpRoot(t);
  const item = seedItem(root, { id: 'WI-2026-401' });
  assert.throws(
    () => transitionWorkItem(root, item.id, 'Parked', { write: true }),
    /illegal state transition Signal → Parked/,
  );

  transitionWorkItem(root, item.id, 'Candidate', { write: true });
  transitionWorkItem(root, item.id, 'Explored', { write: true });
  const proposed = transitionWorkItem(root, item.id, 'Proposed', { write: true }).document;
  const parked = transitionWorkItem(root, proposed.id, 'Parked', { write: true }).document;
  assert.equal(parked.state, 'Parked');
  assert.throws(
    () => transitionWorkItem(root, parked.id, 'Authorized', { write: true }),
    /terminal/,
  );
});

test('Authorized / Verifying can be Parked through the transition table', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root, { id: 'WI-2026-402' });
  for (const to of ['Candidate', 'Explored', 'Proposed', 'AwaitingApproval']) {
    transitionWorkItem(root, item.id, to, { write: true, approvedBy: 'human:owner' });
  }
  const authorized = transitionWorkItem(root, item.id, 'Authorized', {
    write: true,
    approvedBy: 'human:owner',
  }).document;
  assert.equal(authorized.state, 'Authorized');
  const parked = transitionWorkItem(root, item.id, 'Parked', { write: true }).document;
  assert.equal(parked.state, 'Parked');
});

test('revokeReason timeout is a documented extension and still freezes the Mandate', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root, { id: 'WI-2026-403' });
  const snap = createSnapshot(root, { write: true }).document;
  const issued = issueMandate(root, {
    workItem: item.id,
    issuedBy: 'human:owner',
    expiresAt: '2026-11-19T12:00:00+08:00',
    constitution_snapshot: snap.id,
    goal: item.intent,
    ac: item.ac,
    nonGoals: item.nonGoals,
    scope: item.scope,
    toolsWhitelist: ['read'],
    budget: { tokens: 1000, minutes: 10 },
    evidenceRequired: ['verify'],
  }, { write: true, now: new Date('2026-11-18T12:00:00+08:00') }).document;

  assert.ok(REVOKE_REASONS.includes('timeout'));
  assert.throws(
    () => revokeMandate(root, issued.id, 'idle-timeout', { write: true }),
    /revoke reason must be one of/,
  );
  const revoked = revokeMandate(root, issued.id, 'timeout', { write: true }).document;
  assert.equal(revoked.revokeReason, 'timeout');
  assert.ok(revoked.revokedAt);
  assert.equal(getMandate(root, issued.id).goal, issued.goal);
  assert.throws(
    () => revokeMandate(root, issued.id, 'human-stop', { write: true }),
    (err) => err.code === 'MANDATE_FROZEN',
  );
});

test('renderResultCard includes AC, receipts, and plural artifact paths; can load receipts from the ledger', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root, { id: 'WI-2026-404' });
  const snap = createSnapshot(root, { write: true }).document;
  const rc1 = issueReceipt(root, {
    workItem: item.id,
    gate: 'validate-plan',
    exitCode: 0,
    status: 'pass',
    constitution_snapshot: snap.id,
    artifacts: ['tmp/superbot/run/plan.json'],
  }, { write: true }).document;
  const rc2 = issueReceipt(root, {
    workItem: item.id,
    gate: 'verify',
    exitCode: 0,
    status: 'pass',
    constitution_snapshot: snap.id,
    artifacts: ['tmp/superbot/run/diff.patch'],
  }, { write: true }).document;

  const delivered = { ...getWorkItem(root, item.id), state: 'Delivered' };
  const explicit = renderResultCard(delivered, {
    conclusion: 'CI 已连续 20 次全绿',
    receipts: [
      { gate: 'validate-plan', status: 'pass', id: rc1.id },
      { gate: 'verify', status: 'pass', id: rc2.id },
    ],
    artifacts: ['tmp/superbot/run/plan.json', 'tmp/superbot/run/diff.patch'],
  });
  assert.match(explicit, /^【结果】WI-2026-404  状态：Delivered$/m);
  assert.match(explicit, /AC 逐条：AC-1 通过/);
  assert.match(explicit, /Receipt：validate-plan pass RC-/);
  assert.match(explicit, /verify pass RC-/);
  assert.match(explicit, /产物：tmp\/superbot\/run\/plan\.json, tmp\/superbot\/run\/diff\.patch/);
  assert.match(explicit, /请你：合并 \/ 打回/);

  // Existing single-artifact shape still works.
  const legacy = renderCard('result', delivered, {
    conclusion: 'CI 已连续 20 次全绿',
    receipts: [{ gate: 'validate-plan', status: 'pass' }, { gate: 'verify', status: 'pass' }],
    artifact: 'tmp/superbot/run/diff.patch',
  });
  assert.match(legacy, /Receipt：validate-plan pass, verify pass/);
  assert.match(legacy, /产物：tmp\/superbot\/run\/diff\.patch/);

  const loaded = renderResultCard(delivered, {
    root,
    conclusion: 'CI 已连续 20 次全绿',
  });
  assert.match(loaded, /Receipt：validate-plan pass /);
  assert.match(loaded, /verify pass /);
  assert.match(loaded, /产物：tmp\/superbot\/run\/plan\.json, tmp\/superbot\/run\/diff\.patch/);
});
