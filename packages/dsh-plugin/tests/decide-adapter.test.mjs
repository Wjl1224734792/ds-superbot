/**
 * Thin adapter: console approve issues a Mandate; reject records and does not issue.
 * console-model.mjs stays a pure helper (imported only to prove it has no loop API).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createThread,
  createWorkItem,
  getWorkItem,
  listMandates,
  transitionWorkItem,
} from '../../constitution/src/index.mjs';
import { tmpRoot } from '../../runtime/tests/lib/helpers.mjs';
import {
  CONSOLE_DECIDE_SOURCE,
  DEFAULT_CONSOLE_ISSUER,
  createConsoleOnDecide,
  handleConsoleDecide,
  normalizeDecideAction,
  parseDecideInput,
  resolveConsoleIssuer,
} from '../lib/decide-adapter.mjs';
import * as consoleModel from '../lib/console-model.mjs';

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

test('parseDecideInput and issuer helpers stay strict', () => {
  assert.equal(normalizeDecideAction('Approve'), 'approve');
  assert.equal(normalizeDecideAction('REJECT'), 'reject');
  assert.equal(normalizeDecideAction('view'), null);
  assert.deepEqual(parseDecideInput('approve WI-114'), {
    action: 'approve',
    workItemId: 'WI-114',
    reason: '',
  });
  assert.deepEqual(parseDecideInput('reject WI-116 范围不对'), {
    action: 'reject',
    workItemId: 'WI-116',
    reason: '范围不对',
  });
  assert.equal(parseDecideInput('help'), null);
  assert.equal(resolveConsoleIssuer({}), DEFAULT_CONSOLE_ISSUER);
  assert.equal(resolveConsoleIssuer({ issuedBy: '建霖' }), '建霖');
  assert.equal(CONSOLE_DECIDE_SOURCE, 'console');
});

test('console-model.mjs stays a pure helper with no decide / loop imports', () => {
  const source = readFileSync(new URL('../lib/console-model.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /approveDecision|rejectDecision|loop\.mjs|decide-adapter/);
  assert.equal(typeof consoleModel.sortConsoleSections, 'function');
  assert.equal(typeof consoleModel.approveDecision, 'undefined');
  assert.equal(typeof consoleModel.rejectDecision, 'undefined');
});

test('handleConsoleDecide approve issues a Mandate from a human issuer', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root);
  toAwaiting(root, seeded);

  const out = handleConsoleDecide(root, seeded, 'approve', {
    issuedBy: 'human:owner',
    write: true,
    now: new Date('2026-11-18T16:00:00+08:00'),
  });

  assert.equal(out.issued, true);
  assert.equal(out.rejected, false);
  assert.equal(out.autoMerge, false);
  assert.equal(out.mandate.issuedBy, 'human:owner');
  assert.equal(out.mandate.workItem, seeded.id);
  assert.equal(getWorkItem(root, seeded.id).state, 'Authorized');
  assert.equal(listMandates(root).length, 1);
});

test('handleConsoleDecide reject records a rejection and does not issue', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root);
  toAwaiting(root, seeded);

  const out = handleConsoleDecide(root, { id: seeded.id }, 'reject', {
    issuedBy: 'human:owner',
    reason: '范围过大',
    write: true,
  });

  assert.equal(out.issued, false);
  assert.equal(out.rejected, true);
  assert.equal(out.mandate, null);
  assert.equal(out.autoMerge, false);
  assert.equal(getWorkItem(root, seeded.id).state, 'Parked');
  assert.equal(listMandates(root).length, 0);
});

test('createConsoleOnDecide refuses machine issuers on approve and unknown actions', (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root);
  toAwaiting(root, seeded);
  const onDecide = createConsoleOnDecide(root, { issuedBy: 'observe', write: true });
  assert.throws(() => onDecide(seeded.id, 'approve'), (err) => err.code === 'HUMAN_ISSUER_REQUIRED');
  assert.throws(() => handleConsoleDecide(root, seeded.id, 'view', { issuedBy: 'human:owner' }), (err) => err.code === 'DECIDE_ACTION');
});
