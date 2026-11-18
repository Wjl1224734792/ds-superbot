import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createThread, addItemToThread, getThread,
  createWorkItem, getWorkItem, transitionWorkItem,
  issueMandate, revokeMandate, getMandate, assertFrozen,
  createSnapshot, checkSnapshot,
  evalPolicy, parsePolicyYaml, matchWhen,
  issueReceipt, revalidateReceipt, getReceipt, computeHashes,
  renderCard,
  validateNamed, loadSchema, validate,
} from '../src/index.mjs';
import { ConstitutionError } from '../src/errors.mjs';
import { formatIso } from '../src/time.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '../bin/constitution.mjs');
const DEFAULT_POLICY = readFileSync(join(HERE, '../templates/policy.default.yaml'), 'utf8');

function tmpRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'constitution-'));
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
    risk: 'R1',
    reversible: true,
    authority: 'policy:auto-low',
    ac: [{ id: 'AC-1', text: '主干最近 20 次 CI 全绿', coveredBy: [] }],
    nonGoals: ['不改发布流程'],
    scope: { files: [], newFiles: [], owners: ['backend-dev'] },
    gates: ['validate-plan', 'verify'],
    origin: { kind: 'human', ref: 'group://repo-ops/msg/abc', evidence: [] },
    ...overrides,
  }, { write: true }).document;
}

function cli(root, args) {
  return spawnSync(process.execPath, [CLI, root, ...args], { encoding: 'utf8' });
}

test('schemas reject additional properties and accept a valid work item', () => {
  const schema = loadSchema('workitem');
  const ok = validate({
    schemaVersion: 1,
    id: 'WI-2026-114',
    thread: 'TH-repo-ops-ci',
    origin: { kind: 'human', ref: 'x', evidence: [] },
    intent: 'x',
    ac: [{ id: 'AC-1', text: '主干最近 20 次 CI 全绿', coveredBy: [] }],
    nonGoals: [],
    scope: { files: [], newFiles: [], owners: [] },
    risk: 'R2',
    reversible: true,
    authority: 'human-approval',
    gates: ['verify'],
    state: 'Proposed',
    constitution_snapshot: null,
    mandate: null,
    plan: null,
    receipts: [],
    createdAt: '2026-11-18T11:20:00+08:00',
    updatedAt: '2026-11-18T11:20:00+08:00',
  }, schema);
  assert.equal(ok.ok, true);
  const bad = validate({ ...ok.value, extra: 1 }, schema);
  assert.equal(bad.ok, false);
});

test('policy YAML parses and first-match semantics are deterministic', () => {
  const doc = parsePolicyYaml(DEFAULT_POLICY);
  assert.deepEqual(doc.rules.map((r) => r.id), ['auto-low', 'human-default', 'human-critical']);
  assert.equal(matchWhen(doc.rules[0].when, { risk: 'R1', reversible: true }), true);
  assert.equal(matchWhen(doc.rules[0].when, { risk: 'R2', reversible: true }), false);
  assert.equal(matchWhen(doc.rules[1].when, { risk: 'R2', reversible: true }), true);
  assert.equal(matchWhen(doc.rules[1].when, { risk: 'R0', reversible: true, intentAmbiguous: true }), true);
  assert.equal(matchWhen(doc.rules[2].when, { risk: 'R0', reversible: false, touches: ['secrets'] }), true);
});

test('creates a thread and work item, then walks legal transitions', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root);
  assert.equal(item.state, 'Signal');
  assert.ok(getThread(root, 'TH-repo-ops-ci').workItems.includes(item.id));

  transitionWorkItem(root, item.id, 'Candidate', { write: true });
  transitionWorkItem(root, item.id, 'Explored', { write: true });
  transitionWorkItem(root, item.id, 'Proposed', { write: true });
  const authorized = transitionWorkItem(root, item.id, 'Authorized', { write: true }).document;
  assert.equal(authorized.state, 'Authorized');
  assert.equal(authorized.authority, 'policy:auto-low');
  assert.ok(authorized.constitution_snapshot);
  assert.match(authorized.constitution_snapshot, /^CS-[0-9a-f]{12}$/);
});

test('illegal transitions fail and do not mutate state', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root);
  assert.throws(() => transitionWorkItem(root, item.id, 'Delivered', { write: true }), (err) => {
    assert.equal(err.code, 'TRANSITION');
    return true;
  });
  assert.equal(getWorkItem(root, item.id).state, 'Signal');
  transitionWorkItem(root, item.id, 'Candidate', { write: true });
  transitionWorkItem(root, item.id, 'Dropped', { write: true });
  assert.throws(() => transitionWorkItem(root, item.id, 'Explored', { write: true }), /terminal/);
});

test('R2 cannot enter Authorized without a human approval', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root, { risk: 'R2', reversible: true, authority: 'human-approval' });
  for (const to of ['Candidate', 'Explored', 'Proposed']) {
    transitionWorkItem(root, item.id, to, { write: true });
  }
  assert.throws(() => transitionWorkItem(root, item.id, 'Authorized', { write: true }), (err) => {
    assert.equal(err.code, 'TRANSITION');
    assert.match(err.message, /human approval/);
    return true;
  });
  const waiting = transitionWorkItem(root, item.id, 'AwaitingApproval', { write: true }).document;
  assert.equal(waiting.state, 'AwaitingApproval');
  const authorized = transitionWorkItem(root, item.id, 'Authorized', { write: true, approvedBy: 'human:owner' }).document;
  assert.equal(authorized.state, 'Authorized');
  assert.equal(authorized.authority, 'human-approval');
});

test('issues, revokes, and keeps mandate fields frozen after revoke', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root);
  const snap = createSnapshot(root, { write: true }).document;
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const issued = issueMandate(root, {
    workItem: item.id,
    issuedBy: 'human:owner',
    expiresAt: formatIso(tomorrow),
    constitution_snapshot: snap.id,
    goal: item.intent,
    ac: item.ac,
    nonGoals: item.nonGoals,
    scope: item.scope,
    toolsWhitelist: ['shell', 'read'],
    budget: { tokens: 1000, minutes: 10 },
    evidenceRequired: ['verify'],
  }, { write: true }).document;
  assert.equal(issued.id, `MD-${item.id}`);
  assert.throws(() => issueMandate(root, { ...issued, goal: 'changed' }, { write: true }), /already exists/);

  const revoked = revokeMandate(root, issued.id, 'human-stop', { write: true }).document;
  assert.equal(revoked.revokeReason, 'human-stop');
  assert.ok(revoked.revokedAt);
  assert.throws(() => {
    assertFrozen(revoked, { ...revoked, goal: 'sneak' });
  }, (err) => {
    assert.equal(err.code, 'MANDATE_FROZEN');
    return true;
  });
  assert.throws(() => revokeMandate(root, issued.id, 'expired', { write: true }), /already revoked/);
});

test('expired mandate cannot be used to enter Building', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root, { risk: 'R2', authority: 'human-approval', reversible: true });
  for (const to of ['Candidate', 'Explored', 'Proposed', 'AwaitingApproval']) {
    transitionWorkItem(root, item.id, to, { write: true, approvedBy: 'human:owner' });
  }
  transitionWorkItem(root, item.id, 'Authorized', { write: true, approvedBy: 'human:owner' });
  const current = getWorkItem(root, item.id);
  mkdirSync(join(root, 'tmp/superbot/run-1'), { recursive: true });
  const planPath = 'tmp/superbot/run-1/03-plan.json';
  writeFileSync(join(root, planPath), JSON.stringify({
    schemaVersion: 1,
    impact: '02-impact.md',
    acceptanceCriteria: [{ id: 'AC-1', text: '主干最近 20 次 CI 全绿', coveredBy: ['T1'] }],
    testChanges: [{ file: 'tests/ci.test.mjs', task: 'T1', reason: 'cover AC-1' }],
    tasks: [{
      id: 'T1', role: 'backend-dev', title: '修 CI',
      files: [], newFiles: ['scripts/ci.sh'], dependsOn: [], doneWhen: '主干最近 20 次 CI 全绿',
    }],
  }, null, 2));
  const planned = transitionWorkItem(root, item.id, 'Planned', {
    write: true,
    plan: planPath,
    ac: [{ id: 'AC-1', text: '主干最近 20 次 CI 全绿', coveredBy: ['T1'] }],
  }).document;
  const issued = issueMandate(root, {
    workItem: item.id,
    issuedBy: 'human:owner',
    expiresAt: formatIso(new Date(Date.now() + 60_000)),
    constitution_snapshot: planned.constitution_snapshot,
    goal: item.intent,
    ac: [{ id: 'AC-1', text: '主干最近 20 次 CI 全绿', coveredBy: ['T1'] }],
    nonGoals: item.nonGoals,
    scope: item.scope,
    toolsWhitelist: ['shell'],
    budget: { tokens: 1, minutes: 1 },
    evidenceRequired: ['validate-plan'],
  }, { write: true }).document;
  transitionWorkItem(root, item.id, 'Approved', { write: true, planValid: true });
  assert.throws(
    () => transitionWorkItem(root, item.id, 'Building', { write: true, now: new Date(Date.now() + 120_000) }),
    (err) => {
      assert.equal(err.code, 'MANDATE_EXPIRED');
      return true;
    },
  );
  assert.equal(getWorkItem(root, item.id).state, 'Approved');
  assert.equal(getMandate(root, issued.id).revokedAt, null);
});

test('cannot issue an already-expired mandate', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root);
  const snap = createSnapshot(root, { write: true }).document;
  assert.throws(() => issueMandate(root, {
    workItem: item.id,
    issuedBy: 'human:owner',
    expiresAt: formatIso(new Date(Date.now() - 60_000)),
    constitution_snapshot: snap.id,
    goal: item.intent,
    ac: item.ac,
    nonGoals: item.nonGoals,
    scope: item.scope,
    toolsWhitelist: ['shell'],
    budget: { tokens: 1, minutes: 1 },
    evidenceRequired: [],
  }, { write: true }), (err) => {
    assert.equal(err.code, 'MANDATE_EXPIRED');
    return true;
  });
});

test('issues receipts for a successful and a failed gate, and revalidate catches hand-edits', (t) => {
  const root = tmpRoot(t);
  const item = seedItem(root);
  const snap = createSnapshot(root, { write: true }).document;
  mkdirSync(join(root, '.superbot'), { recursive: true });
  writeFileSync(join(root, '.superbot/docs-state.json'), '{"ok":true}\n');

  const pass = issueReceipt(root, {
    workItem: item.id,
    gate: 'docs-ready',
    exitCode: 0,
    constitution_snapshot: snap.id,
    artifacts: ['.superbot/docs-state.json'],
  }, { write: true }).document;
  assert.equal(pass.status, 'pass');
  assert.ok(pass.hashes.seal);

  const failRc = issueReceipt(root, {
    workItem: item.id,
    gate: 'verify',
    exitCode: 1,
    constitution_snapshot: snap.id,
  }, { write: true }).document;
  assert.equal(failRc.status, 'fail');

  assert.throws(() => issueReceipt(root, {
    workItem: item.id, gate: 'docs-gate', exitCode: 1, status: 'pass',
  }, { write: true }), /cannot be signed as pass/);

  const clean = revalidateReceipt(root, pass.id, { write: false });
  assert.equal(clean.ok, true);

  const file = join(root, '.superbot/ledger/receipts', `${pass.id}.json`);
  const tampered = JSON.parse(readFileSync(file, 'utf8'));
  tampered.exitCode = 0;
  tampered.status = 'pass';
  tampered.script = 'scripts/forged.mjs';
  writeFileSync(file, `${JSON.stringify(tampered, null, 2)}\n`);
  const checked = revalidateReceipt(root, pass.id, { write: true });
  assert.equal(checked.ok, false);
  assert.equal(checked.receipt.status, 'stale');
  assert.ok(checked.reasons.length > 0);
  assert.equal(getReceipt(root, pass.id).status, 'stale');
});

test('snapshot check fails after a canon document changes', (t) => {
  const root = tmpRoot(t);
  const snap = createSnapshot(root, { write: true }).document;
  const first = checkSnapshot(root, snap.id);
  assert.equal(first.ok, true);
  writeFileSync(join(root, 'docs/03-契约/API接口.md'), '# API\n\nchanged canon.\n');
  const second = checkSnapshot(root, snap.id);
  assert.equal(second.ok, false);
  assert.ok(second.stale.includes('docs/03-契约/API接口.md'));
});

test('policy eval and three card renderers', (t) => {
  const root = tmpRoot(t);
  const low = seedItem(root, { risk: 'R1', reversible: true, id: 'WI-2026-001' });
  const ev = evalPolicy(root, getWorkItem(root, low.id));
  assert.equal(ev.id, 'auto-low');
  assert.equal(ev.requireHuman, false);

  const high = seedItem(root, {
    id: 'WI-2026-002', risk: 'R2', reversible: true, authority: 'human-approval',
  });
  const ev2 = evalPolicy(root, getWorkItem(root, high.id));
  assert.equal(ev2.id, 'human-default');
  assert.equal(ev2.requireHuman, true);

  const item = getWorkItem(root, high.id);
  const workCard = renderCard('workitem', { ...item, state: 'Proposed' });
  assert.match(workCard, /^【工作项】WI-2026-002  状态：Proposed$/m);
  assert.match(workCard, /意图：把 CI 红灯率降到 0/);
  assert.match(workCard, /风险：R2   可逆：是   授权：human-approval/);
  const approval = renderCard('approval', item);
  assert.match(approval, /^【审批】WI-2026-002  请批 Mandate$/m);
  assert.match(approval, /回复：批准 \/ 改 AC：… \/ 否决/);
  const result = renderCard('result', { ...item, state: 'Delivered' }, {
    conclusion: 'CI 已连续 20 次全绿',
    receipts: [{ gate: 'validate-plan', status: 'pass' }, { gate: 'verify', status: 'pass' }],
    artifact: 'tmp/superbot/run/diff.patch',
  });
  assert.match(result, /^【结果】WI-2026-002  状态：Delivered$/m);
  assert.match(result, /请你：合并 \/ 打回/);
});

test('CLI --help, thread/workitem/policy/card against a temp root', (t) => {
  const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /constitution <root> <resource> <action>/);
  assert.match(help.stdout, /workitem {3}create\|get\|list\|transition/);
  assert.match(help.stdout, /mandate {4}issue\|revoke\|get/);
  assert.match(help.stdout, /snapshot {3}create\|get\|check/);
  assert.match(help.stdout, /policy {5}eval/);
  assert.match(help.stdout, /receipt {4}list\|get\|revalidate/);
  assert.match(help.stdout, /gate {7}<gate-name>/);
  assert.match(help.stdout, /card {7}workitem\|approval\|result/);

  const root = tmpRoot(t);
  const created = cli(root, [
    'thread', 'create', '--slug', 'demo', '--title', 'Demo thread', '--write', '--json',
  ]);
  assert.equal(created.status, 0, created.stderr);
  const wi = cli(root, [
    'workitem', 'create',
    '--thread', 'TH-demo',
    '--intent', '补一门禁测试',
    '--risk', 'R1',
    '--reversible',
    '--ac', 'AC-1=测试退出码为 0',
    '--write', '--json',
  ]);
  assert.equal(wi.status, 0, wi.stderr);
  const item = JSON.parse(wi.stdout).document;
  const ev = cli(root, ['policy', 'eval', '--work-item', item.id, '--json']);
  assert.equal(ev.status, 0, ev.stderr);
  assert.equal(JSON.parse(ev.stdout).rule, 'auto-low');
  const card = cli(root, ['card', 'workitem', '--id', item.id]);
  assert.equal(card.status, 0, card.stderr);
  assert.match(card.stdout, /【工作项】/);
});

test('CLI gate forwards docs-ready --help with exit 0', () => {
  const res = spawnSync(process.execPath, [CLI, tmpdir(), 'gate', 'docs-ready', '--help'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(`${res.stdout}${res.stderr}`, /docs-ready\.mjs/);
});
