import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  checkSnapshot,
  createSnapshot,
  createThread,
  createWorkItem,
  evalPolicy,
  GATE_FILES,
  intensity,
  parsePolicyYaml,
  planSteps,
} from '../src/index.mjs';
import { ConstitutionError } from '../src/errors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY = readFileSync(join(HERE, '../templates/policy.default.yaml'), 'utf8');

function tmpRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'constitution-gov-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'AGENTS.md'), '# AGENTS\n\nfixture.\n');
  writeFileSync(join(root, 'README.md'), '# Fixture\n');
  mkdirSync(join(root, 'docs/03-契约'), { recursive: true });
  writeFileSync(join(root, 'docs/03-契约/API接口.md'), '# API\n\nBaseURL /api, 错误码 4001, 权限从凭据解析。\n');
  mkdirSync(join(root, '.superbot/policy'), { recursive: true });
  writeFileSync(join(root, '.superbot/policy/default.yaml'), DEFAULT_POLICY);
  return root;
}

function item(overrides = {}) {
  return {
    id: 'WI-2026-501',
    intent: 'fix typo',
    ac: [{ id: 'AC-1', text: '文档无错字', coveredBy: [] }],
    risk: 'R0',
    reversible: true,
    intentAmbiguous: false,
    touches: [],
    ...overrides,
  };
}

const TIGHT = `
rules:
  - id: tight
    when: "risk <= R3"
    requireHuman: true
    allow: [explore]
    gates: [validate-plan, docs-ready, docs-gate, verify, browser-ac, review]
    speak: [needs-decision, result-ready, failed]
    merge: human-only
`;

const LOOSE = `
rules:
  - id: loose
    when: "risk <= R3"
    requireHuman: false
    allow: [explore, plan, build, verify, deliver]
    gates: [validate-plan, verify]
    speak: [result-ready, failed]
`;

test('process step count falls when policy is loosened, without deleting gate implementations', () => {
  const work = item({ risk: 'R0', reversible: true });
  const tight = planSteps(work, parsePolicyYaml(TIGHT));
  const loose = planSteps(work, parsePolicyYaml(LOOSE));
  assert.equal(tight.ruleId, 'tight');
  assert.equal(tight.steps, 6);
  assert.equal(tight.stepCount, 6);
  assert.deepEqual(tight.gates, ['validate-plan', 'docs-ready', 'docs-gate', 'verify', 'browser-ac', 'review']);
  assert.equal(tight.merge, 'human-only');
  assert.equal(tight.requireHuman, true);
  assert.equal(loose.ruleId, 'loose');
  assert.equal(loose.steps, 2);
  assert.deepEqual(loose.gates, ['validate-plan', 'verify']);
  assert.ok(loose.steps < tight.steps);
  // Same function, same work item; only the policy document changed.
  assert.equal(typeof planSteps, 'function');
  assert.equal(intensity(work, parsePolicyYaml(LOOSE)).steps, loose.steps);
  // Gate implementations are still present in code.
  assert.ok(GATE_FILES['docs-ready']);
  assert.ok(GATE_FILES['docs-gate']);
  assert.ok(GATE_FILES['validate-plan']);
  assert.ok(GATE_FILES.verify);
  assert.ok(GATE_FILES['naming-guard']);
});

test('default policy yields fewer steps for R0/R1 reversible work than for R3 or sensitive touches', (t) => {
  const root = tmpRoot(t);
  const low = planSteps(item({ risk: 'R1', reversible: true, touches: [] }), { root });
  const r3 = planSteps(item({ risk: 'R3', reversible: false }), { root });
  const touched = planSteps(item({ risk: 'R1', reversible: true, touches: ['secrets'] }), { root });
  assert.equal(low.ruleId, 'auto-low');
  assert.equal(low.steps, 2);
  assert.deepEqual(low.gates, ['validate-plan', 'verify']);
  assert.equal(low.merge, null);
  assert.equal(r3.ruleId, 'human-critical');
  assert.equal(r3.steps, 6);
  assert.equal(r3.merge, 'human-only');
  assert.equal(r3.requireHuman, true);
  assert.equal(touched.ruleId, 'human-critical');
  assert.equal(touched.steps, 6);
  assert.ok(low.steps < r3.steps);
  assert.equal(evalPolicy(root, item({ risk: 'R1', reversible: true })).steps, 2);
});

test('planSteps records merge: human-only and refuses auto-merge in a policy document', () => {
  const work = item({ risk: 'R3' });
  const planned = planSteps(work, parsePolicyYaml(TIGHT));
  assert.equal(planned.merge, 'human-only');
  const illegal = `
rules:
  - id: bad
    when: "risk <= R3"
    requireHuman: false
    allow: [deliver]
    gates: [verify]
    speak: [result-ready]
    merge: auto-merge
`;
  assert.throws(() => planSteps(work, parsePolicyYaml(illegal)), /auto-merge is disabled/);
});

test('snapshot hash-staleness still applies when docs-ready is not in the step list', (t) => {
  const root = tmpRoot(t);
  createThread(root, { slug: 'ops', title: 'Ops', channels: ['group://repo-ops'] }, { write: true });
  const work = createWorkItem(root, {
    thread: 'TH-ops',
    intent: 'fix typo',
    risk: 'R0',
    reversible: true,
    authority: 'policy:auto-low',
    ac: [{ id: 'AC-1', text: '文档无错字', coveredBy: [] }],
    nonGoals: [],
    scope: { files: [], newFiles: [], owners: [] },
    gates: ['validate-plan', 'verify'],
    origin: { kind: 'human', ref: 'group://repo-ops/msg/1', evidence: [] },
  }, { write: true }).document;
  const planned = planSteps(work, { root });
  assert.equal(planned.ruleId, 'auto-low');
  assert.equal(planned.gates.includes('docs-ready'), false);
  assert.equal(planned.snapshotStaleStillApplies, true);
  const snap = createSnapshot(root, { write: true }).document;
  // Bind the snapshot onto the work item file the same way transitions do.
  const file = join(root, '.superbot/ledger/work-items', `${work.id}.json`);
  const current = JSON.parse(readFileSync(file, 'utf8'));
  current.constitution_snapshot = snap.id;
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  assert.equal(checkSnapshot(root, snap.id).ok, true);
  writeFileSync(join(root, 'docs/03-契约/API接口.md'), '# API\n\nchanged canon.\n');
  const stale = checkSnapshot(root, snap.id);
  assert.equal(stale.ok, false);
  assert.ok(stale.stale.includes('docs/03-契约/API接口.md'));
});
