import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createThread, createWorkItem, createSnapshot,
  issueMandate, revokeMandate, getMandate, listMandates, activeMandateFor,
} from '../src/index.mjs';
import { isMandateId, mandateIdFor, nextMandateId, parseMandateId } from '../src/ids.mjs';
import { formatIso } from '../src/time.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY = readFileSync(join(HERE, '../templates/policy.default.yaml'), 'utf8');

function tmpRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'mandate-history-'));
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
    scope: { files: [], newFiles: [], owners: ['backend-dev'] },
    gates: ['validate-plan', 'verify', 'review'],
    origin: { kind: 'human', ref: 'group://repo-ops/msg/abc', evidence: [] },
    ...overrides,
  }, { write: true }).document;
}

function mandateInput(item, snapshot, extra = {}) {
  return {
    workItem: item.id,
    issuedBy: 'human:owner',
    expiresAt: '2099-01-01T00:00:00+08:00',
    constitution_snapshot: snapshot.id,
    goal: item.intent,
    ac: item.ac,
    nonGoals: item.nonGoals,
    scope: item.scope,
    toolsWhitelist: ['shell', 'read', 'edit', 'git'],
    budget: { tokens: 200000, minutes: 45 },
    evidenceRequired: ['validate-plan', 'verify', 'review'],
    ...extra,
  };
}

test('mandate id helpers stay in the MD-<workItemId> family', () => {
  assert.equal(mandateIdFor('WI-2026-114'), 'MD-WI-2026-114');
  assert.equal(isMandateId('MD-WI-2026-114'), true);
  assert.equal(isMandateId('MD-WI-2026-114-2'), true);
  assert.equal(isMandateId('MD-WI-2026-114-1'), false);
  assert.equal(isMandateId('MD-WI-2026-114-01'), false);
  assert.equal(isMandateId('MND-WI-2026-114'), false);
  assert.deepEqual(parseMandateId('MD-WI-2026-114'), { workItemId: 'WI-2026-114', revision: 1 });
  assert.deepEqual(parseMandateId('MD-WI-2026-114-2'), { workItemId: 'WI-2026-114', revision: 2 });
  assert.equal(nextMandateId([], 'WI-2026-114'), 'MD-WI-2026-114');
  assert.equal(nextMandateId(['MD-WI-2026-114'], 'WI-2026-114'), 'MD-WI-2026-114-2');
  assert.equal(nextMandateId(['MD-WI-2026-114', 'MD-WI-2026-114-2'], 'WI-2026-114'), 'MD-WI-2026-114-3');
});

test('re-issue after revoke keeps the revoked copy and uses a unique id', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root);
  const snapshot = createSnapshot(root, { write: true }).document;

  const first = issueMandate(root, mandateInput(item, snapshot), { write: true }).document;
  assert.equal(first.id, `MD-${item.id}`);
  const firstPath = join(root, '.superbot/ledger/mandates', `${first.id}.json`);
  assert.equal(existsSync(firstPath), true);

  const revoked = revokeMandate(root, first.id, 'human-stop', { write: true }).document;
  assert.equal(revoked.revokedAt != null, true);
  const frozenGoal = revoked.goal;
  const frozenIssuedAt = revoked.issuedAt;

  const second = issueMandate(root, mandateInput(item, snapshot, { goal: '把 CI 红灯率降到 0（重签）' }), { write: true }).document;
  assert.equal(second.id, `MD-${item.id}-2`);
  assert.equal(second.revokedAt, null);
  assert.equal(second.goal, '把 CI 红灯率降到 0（重签）');

  const historical = getMandate(root, first.id);
  assert.equal(historical.revokedAt, revoked.revokedAt);
  assert.equal(historical.revokeReason, 'human-stop');
  assert.equal(historical.goal, frozenGoal);
  assert.equal(historical.issuedAt, frozenIssuedAt);

  assert.equal(activeMandateFor(root, item.id).id, second.id);

  const listed = listMandates(root).map((d) => d.id).sort();
  assert.deepEqual(listed, [first.id, second.id].sort());

  assert.throws(
    () => issueMandate(root, mandateInput(item, snapshot, { id: first.id, goal: 'overwrite' }), { write: true }),
    /historical record and cannot be overwritten/,
  );
});

test('cannot issue a second active mandate without revoking the first', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root);
  const snapshot = createSnapshot(root, { write: true }).document;
  const first = issueMandate(root, mandateInput(item, snapshot), { write: true }).document;
  assert.throws(
    () => issueMandate(root, mandateInput(item, snapshot, { id: `${first.id}-2`, goal: 'other' }), { write: true }),
    /already exists; revoke it before re-issuing/,
  );
  assert.equal(activeMandateFor(root, item.id).id, first.id);
});
