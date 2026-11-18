import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as runtime from '../src/index.mjs';
import { listMandates } from '../../constitution/src/index.mjs';
import { tmpRoot } from './lib/helpers.mjs';

const ROLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../dsh-plugin/roles');

function workItem(overrides = {}) {
  return {
    id: 'WI-2026-101',
    intent: '把主干最近 20 次 CI 修到全绿',
    ac: [{ id: 'AC-1', text: '主干最近 20 次 CI 全绿', coveredBy: ['T1'] }],
    nonGoals: ['不改发布流程'],
    scope: { files: ['scripts/ci.sh'], newFiles: [], owners: ['backend-dev'] },
    gates: ['validate-plan', 'verify', 'review'],
    risk: 'R1',
    reversible: true,
    ...overrides,
  };
}

test('seven role charters remain and no 8th role file is added', () => {
  const md = readdirSync(ROLES_DIR).filter((name) => name.endsWith('.md')).sort();
  assert.deepEqual(md, [
    'architect.md',
    'backend-dev.md',
    'browser-tester.md',
    'frontend-dev.md',
    'pm.md',
    'qa-engineer.md',
    'reviewer.md',
  ]);
  assert.equal(md.includes('explorer.md'), false);
  assert.equal(runtime.loadRoleCharter('explorer'), null);
  assert.equal(runtime.loadRoleCharter('cartographer'), null);
});

test('OWNER_TO_CAPABILITY maps the seven 0.1.0 role ids and nothing else', () => {
  assert.equal(runtime.OWNER_TO_CAPABILITY.pm, 'Discover');
  assert.equal(runtime.OWNER_TO_CAPABILITY.architect, 'Discover');
  assert.equal(runtime.OWNER_TO_CAPABILITY['backend-dev'], 'Build');
  assert.equal(runtime.OWNER_TO_CAPABILITY['frontend-dev'], 'Build');
  assert.equal(runtime.OWNER_TO_CAPABILITY['qa-engineer'], 'Verify');
  assert.equal(runtime.OWNER_TO_CAPABILITY['browser-tester'], 'Verify');
  assert.equal(runtime.OWNER_TO_CAPABILITY.reviewer, 'Verify');
  assert.equal(Object.keys(runtime.OWNER_TO_CAPABILITY).length, 7);
  const mapped = runtime.mapOwnersToCapabilities(['pm', 'backend-dev', 'reviewer', 'not-a-role']);
  assert.deepEqual(mapped.states, ['Discover', 'Build', 'Verify']);
  assert.deepEqual(mapped.unknown, ['not-a-role']);
});

test('compiler assembles a Mandate draft from the work item and does not issue it', (t) => {
  const root = tmpRoot(t);
  const snapshot = { id: 'CS-aaaaaaaaaaaa' };
  const out = runtime.compileMandate(workItem(), snapshot);
  assert.equal(out.via, 'compiler');
  assert.equal(out.issued, false);
  assert.equal(out.reason, null);
  const draft = out.mandateDraft;
  assert.equal(draft.workItem, 'WI-2026-101');
  assert.equal(draft.goal, '把主干最近 20 次 CI 修到全绿');
  assert.deepEqual(draft.ac[0].coveredBy, ['T1']);
  assert.deepEqual(draft.nonGoals, ['不改发布流程']);
  assert.deepEqual(draft.scope.owners, ['backend-dev']);
  assert.deepEqual(draft.toolsWhitelist, ['shell', 'read', 'edit', 'git']);
  assert.deepEqual(draft.budget, { tokens: 200000, minutes: 45 });
  assert.deepEqual(draft.evidenceRequired, ['validate-plan', 'verify', 'review']);
  assert.equal(draft.constitution_snapshot, 'CS-aaaaaaaaaaaa');
  assert.equal('id' in draft, false);
  assert.equal('issuedBy' in draft, false);
  assert.equal('issuedAt' in draft, false);
  const states = out.assembly.states;
  assert.ok(states.includes('Build'));
  assert.ok(states.includes('Cartographer'));
  const carto = out.assembly.capabilities.find((c) => c.state === 'Cartographer');
  assert.equal(carto.writeBack, false);
  assert.equal(carto.writeBackCapable, true);
  const cartoTools = out.assembly.capabilities.find((c) => c.state === 'Cartographer').tools;
  assert.equal(cartoTools.includes('edit'), false);
  assert.equal(cartoTools.includes('git'), false);
  // Compiler must not write a mandate to the ledger.
  assert.equal(listMandates(root).length, 0);
});

test('compileIntent delegates to the compiler and keeps the P0 structured draft', () => {
  const out = runtime.compileIntent(workItem({
    id: 'WI-2026-001',
    intent: 'fix ci',
    ac: [{ id: 'AC-1', text: 'green', coveredBy: [] }],
    nonGoals: [],
    scope: { files: ['a.js'], newFiles: [], owners: ['backend-dev'] },
    gates: ['verify'],
  }), { id: 'CS-aaaaaaaaaaaa' });
  assert.equal(out.via, 'compiler');
  assert.ok(out.planNeeds);
  assert.deepEqual(out.planNeeds.missingCoveredBy, ['AC-1']);
  assert.equal(out.mandateDraft.workItem, 'WI-2026-001');
  assert.equal(out.mandateDraft.constitution_snapshot, 'CS-aaaaaaaaaaaa');
  assert.equal(out.issued, false);
});

test('Discover-only draft is read-only; Verify-only has shell+read and no edit', () => {
  const discover = runtime.compileMandate(workItem({
    scope: { files: [], newFiles: [], owners: ['pm', 'architect'] },
    gates: ['validate-plan'],
  }));
  assert.equal(discover.via, 'compiler');
  assert.deepEqual(discover.mandateDraft.toolsWhitelist, ['read']);
  assert.ok(discover.assembly.states.includes('Discover'));
  assert.equal(discover.assembly.states.includes('Build'), false);

  const verify = runtime.compileMandate(workItem({
    scope: { files: [], newFiles: [], owners: ['qa-engineer', 'reviewer'] },
    gates: ['verify', 'review'],
  }));
  assert.equal(verify.via, 'compiler');
  assert.deepEqual(verify.mandateDraft.toolsWhitelist, ['shell', 'read']);
  assert.ok(verify.assembly.states.includes('Verify'));
  assert.equal(verify.mandateDraft.toolsWhitelist.includes('edit'), false);
});

test('missing owners are inferred from gates and scope, without inventing a role id', () => {
  const out = runtime.compileMandate(workItem({
    scope: { files: ['scripts/ci.sh'], newFiles: [], owners: [] },
    gates: ['validate-plan', 'verify', 'review'],
  }));
  assert.equal(out.via, 'compiler');
  assert.equal(out.assembly.inferred, true);
  assert.ok(out.assembly.states.includes('Discover'));
  assert.ok(out.assembly.states.includes('Build'));
  assert.ok(out.assembly.states.includes('Verify'));
  assert.ok(out.assembly.states.includes('Cartographer'));
  assert.deepEqual(out.mandateDraft.scope.owners, []);
  assert.ok(out.assembly.inferenceReason.includes('files'));
});

test('unknown owners do not become a new role and fall through to inference when none are known', () => {
  const out = runtime.inferCapabilities(workItem({
    scope: { files: ['a.js'], newFiles: [], owners: ['mystery-agent'] },
    gates: ['verify'],
  }));
  assert.equal(out.inferred, true);
  assert.deepEqual(out.unknown, ['mystery-agent']);
  assert.ok(out.states.includes('Build'));
  assert.ok(out.states.includes('Verify'));
  assert.equal(out.owners.includes('mystery-agent'), false);
});

test('fallback on missing AC, unjudgeable AC, missing intent, and unusable scope', () => {
  const missingAc = runtime.compileIntent(workItem({ ac: [] }));
  assert.equal(missingAc.via, 'fallback');
  assert.equal(missingAc.reason, 'missing-ac');
  assert.ok(missingAc.fallbackRoles.includes('backend-dev'));
  assert.equal(missingAc.issued, false);

  const vague = runtime.compileMandate(workItem({
    ac: [{ id: 'AC-1', text: '体验好', coveredBy: [] }],
  }));
  assert.equal(vague.via, 'fallback');
  assert.equal(vague.reason, 'unjudgeable-ac');

  const alsoVague = runtime.compileMandate(workItem({
    ac: [{ id: 'AC-1', text: '功能正常', coveredBy: [] }],
  }));
  assert.equal(alsoVague.via, 'fallback');
  assert.equal(alsoVague.reason, 'unjudgeable-ac');

  const noIntent = runtime.compileMandate(workItem({ intent: '   ' }));
  assert.equal(noIntent.via, 'fallback');
  assert.equal(noIntent.reason, 'missing-intent');

  const escaped = runtime.compileMandate(workItem({
    scope: { files: ['../secret.txt'], newFiles: [], owners: ['backend-dev'] },
  }));
  assert.equal(escaped.via, 'fallback');
  assert.equal(escaped.reason, 'unusable-scope');
  assert.deepEqual(escaped.mandateDraft.scope.files, ['../secret.txt']);
});

test('fallback does not grant extra tools or enlarge scope', () => {
  const out = runtime.compileMandate(workItem({
    intent: '',
    scope: { files: ['a.js'], newFiles: [], owners: ['pm'] },
    gates: ['validate-plan'],
  }));
  assert.equal(out.via, 'fallback');
  assert.deepEqual(out.mandateDraft.scope, { files: ['a.js'], newFiles: [], owners: ['pm'] });
  // pm → Discover (+ Cartographer): read only, never edit/git/shell
  assert.deepEqual(out.mandateDraft.toolsWhitelist, ['read']);
  assert.ok(out.charters.some((c) => c.id === 'pm' && c.text.includes('需求分析师')));
  assert.equal(out.fallbackRoles.includes('explorer'), false);
});

test('compiler does not start a process or mark gates as passed', () => {
  const out = runtime.compileMandate(workItem());
  assert.equal(out.issued, false);
  assert.equal(out.mandateDraft.gatesPassed, undefined);
  assert.equal(out.started, undefined);
  assert.equal(out.pid, undefined);
});
