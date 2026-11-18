import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../src/index.mjs';

test('runtime export shape includes P0 APIs and P1 implementations', () => {
  assert.equal(typeof runtime.steward.speakAllowed, 'function');
  assert.equal(typeof runtime.steward.compileIntent, 'function');
  assert.equal(typeof runtime.steward.assign, 'function');
  assert.equal(typeof runtime.filter.fastPath, 'function');
  assert.equal(typeof runtime.filter.slowPath, 'function');
  assert.equal(typeof runtime.curator.rank, 'function');
  assert.equal(typeof runtime.assignment.create, 'function');
  assert.equal(typeof runtime.bus.append, 'function');
  assert.equal(typeof runtime.watchdog.start, 'function');
  assert.equal(typeof runtime.subscribe.connect, 'function');
  assert.equal(typeof runtime.speakAllowed, 'function');
  assert.equal(typeof runtime.compileIntent, 'function');
  assert.equal(typeof runtime.fastPath, 'function');
  assert.equal(typeof runtime.rank, 'function');
  assert.equal(typeof runtime.createAssignment, 'function');
  assert.equal(typeof runtime.consider, 'function');
  assert.equal(typeof runtime.assign, 'function');
  assert.equal(typeof runtime.slowPath, 'function');
  assert.equal(typeof runtime.recordWouldAccept, 'function');
  assert.equal(typeof runtime.listWouldAccept, 'function');
  assert.equal(typeof runtime.createModelPort, 'function');
  assert.equal(typeof runtime.bus.subscribe, 'function');
  assert.equal(typeof runtime.watchdog.tick, 'function');
  assert.equal(typeof runtime.watchdog.stop, 'function');
  assert.equal(typeof runtime.subscribe.ingest, 'function');
  assert.equal(runtime.DEFAULT_AUTHORITY, 'observe');
  assert.equal(typeof runtime.compileMandate, 'function');
  assert.equal(typeof runtime.routeModel, 'function');
  assert.equal(typeof runtime.evaluateAuto, 'function');
  assert.equal(typeof runtime.canEnterAuto, 'function');
  assert.equal(typeof runtime.compiler.compileMandate, 'function');
  assert.equal(typeof runtime.routing.routeModel, 'function');
});

test('speakAllowed allows the three taxed events only', () => {
  assert.equal(runtime.speakAllowed({ type: 'needs-decision' }), true);
  assert.equal(runtime.speakAllowed({ type: 'result-ready' }), true);
  assert.equal(runtime.speakAllowed({ type: 'failed' }), true);
  assert.equal(runtime.speakAllowed({ type: 'heartbeat' }), false);
  assert.equal(runtime.speakAllowed({ type: 'analyzing' }), false);
  assert.equal(runtime.speakAllowed({ kind: 'approval', state: 'AwaitingApproval' }), true);
});

test('compileIntent returns a structured draft and does not throw NOT_IMPLEMENTED', () => {
  const out = runtime.compileIntent({
    id: 'WI-2026-001',
    intent: 'fix ci',
    ac: [{ id: 'AC-1', text: 'green', coveredBy: [] }],
    nonGoals: [],
    scope: { files: ['a.js'], newFiles: [], owners: ['backend-dev'] },
    gates: ['verify'],
  }, { id: 'CS-aaaaaaaaaaaa' });
  assert.ok(out.planNeeds);
  assert.deepEqual(out.planNeeds.missingCoveredBy, ['AC-1']);
  assert.equal(out.mandateDraft.workItem, 'WI-2026-001');
  assert.equal(out.mandateDraft.constitution_snapshot, 'CS-aaaaaaaaaaaa');
});

test('filter.fastPath is a pure rule sieve', () => {
  assert.equal(runtime.fastPath({ source: 'human', text: 'CI is red' }).accept, true);
  assert.equal(runtime.fastPath({ source: 'spam', text: 'CI is red' }).accept, false);
  assert.equal(runtime.fastPath({ source: 'human', sender: 'bot-noise', text: 'x' }).accept, false);
  assert.equal(runtime.fastPath({ source: 'human', text: 'lol' }).accept, false);
  const strict = runtime.fastPath({ source: 'human', text: 'hello' }, { ...runtime.DEFAULT_RULES, requireKeyword: true });
  assert.equal(strict.accept, false);
});

test('curator.rank uses documented weights and returns Top-K', () => {
  assert.deepEqual(runtime.WEIGHTS, { value: 4, reversible: 2, evidence: 1, attention: 3 });
  const { top, archived } = runtime.rank([
    { id: 'a', value: 1, reversible: false, evidenceCount: 0, attentionCost: 5 },
    { id: 'b', value: 3, reversible: true, evidenceCount: 4, attentionCost: 1 },
    { id: 'c', value: 2, reversible: true, evidenceCount: 1, attentionCost: 2 },
  ], { k: 1 });
  assert.equal(top.length, 1);
  assert.equal(top[0].id, 'b');
  assert.equal(archived.length, 2);
});

test('assignment.create returns an isolation structure and does not start a process', () => {
  const a = runtime.createAssignment({
    workItem: { id: 'WI-2026-009', scope: { files: ['x.js'], newFiles: [] } },
    mandate: { id: 'MD-WI-2026-009', toolsWhitelist: ['read'], budget: { tokens: 10, minutes: 5 }, scope: { files: ['x.js'], newFiles: [] } },
  });
  assert.equal(a.workItem, 'WI-2026-009');
  assert.match(a.workDir, /^tmp\/superbot\//);
  assert.deepEqual(a.toolsWhitelist, ['read']);
  assert.equal(a.budget.tokens, 10);
  assert.ok(!('pid' in a));
});

