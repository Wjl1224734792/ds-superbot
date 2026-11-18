/**
 * P6 live loop: after human approve, dispatchWorkItem + official
 * startActivation; reject starts nothing; missing subagents keeps the Mandate.
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
import { handleConsoleDecide } from '../lib/decide-adapter.mjs';
import {
  buildLivePrompt,
  liveLoopLabel,
  residentForCapability,
  startApprovedWorkItem,
} from '../lib/live-loop-adapter.mjs';
import * as consoleModel from '../lib/console-model.mjs';

const PLUGIN = new URL('../index.js', import.meta.url);
const ROLE_IDS = ['pm', 'architect', 'backend-dev', 'frontend-dev', 'qa-engineer', 'browser-tester', 'reviewer'];

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
    scope: { files: ['scripts/ci.sh'], newFiles: [], owners: ['backend-dev'] },
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

function emptyConfig() {
  return { defaults: { provider: '', model: '', effort: '' }, roles: Object.fromEntries(ROLE_IDS.map((id) => [id, { provider: '', model: '', effort: '' }])) };
}

function liveConfig(state) {
  const route = (read) => ({
    provider: { get: () => read().provider },
    model: { get: () => read().model },
    effort: { get: () => read().effort },
  });
  return {
    defaults: route(() => state.config.defaults),
    roles: Object.fromEntries(ROLE_IDS.map((id) => [id, route(() => state.config.roles[id])])),
  };
}

function createBucket(overrides = {}) {
  const state = { skills: [], tools: [], commands: [], activations: [], config: emptyConfig() };
  const services = {
    skills: { register(skill) { state.skills.push(skill); return () => {}; } },
    tools: { register(definition) { state.tools.push(definition); return () => {}; } },
    llm: {
      resolveModelInfo: async (provider, model) => ({
        provider,
        id: model,
        name: model,
        reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' },
      }),
    },
    subagents: {
      getProvider: (name) => (name === 'spawn'
        ? { name, capabilities: { agentOptions: true, agentPreset: true } }
        : undefined),
      startActivation: async (spec) => {
        state.activations.push(spec);
        return { childId: 'child-live-1' };
      },
    },
    agentPresets: { async resolve(id) { return id === 'standard' ? { id } : null; } },
    commands: { register(definition) { state.commands.push(definition); return () => {}; } },
    workingDirectory: overrides.workingDirectory ?? { ensure: async () => overrides.root },
  };
  for (const [name, value] of Object.entries(overrides.services ?? {})) services[name] = value;
  const scoped = {
    get: (name) => services[name],
    ...services,
    effect(callback) {
      const disposer = callback();
      return disposer ?? (() => {});
    },
    logger: { info() {}, warn() {}, error() {} },
  };
  const ctx = {
    ...scoped,
    inject(names, callback) {
      for (const name of names) assert.ok(services[name] !== undefined, `missing service ${name}`);
      callback(scoped);
    },
  };
  return { ctx, state, services, config: liveConfig(state) };
}

let plugin;
async function boot(overrides) {
  if (!plugin) plugin = await import(PLUGIN.href);
  const bucket = createBucket(overrides);
  plugin.apply(bucket.ctx, bucket.config);
  await new Promise((resolve) => setImmediate(resolve));
  return bucket;
}

test('console-model.mjs stays a pure helper with no live-loop imports', () => {
  const source = readFileSync(new URL('../lib/console-model.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /startApprovedWorkItem|live-loop-adapter|dispatchWorkItem|startActivation/);
  assert.equal(typeof consoleModel.startApprovedWorkItem, 'undefined');
});

test('live loop labels name the resident and work item, not a seven-role dispatch', () => {
  assert.equal(residentForCapability('Build').short, '作');
  assert.equal(residentForCapability('Discover').face, 'tan');
  assert.equal(liveLoopLabel({ resident: residentForCapability('Build'), workItemId: 'WI-9' }), '作 · Build · WI-9');
  const prompt = buildLivePrompt({
    workItem: { id: 'WI-9', intent: '修好 CI' },
    workItemId: 'WI-9',
    mandate: { id: 'MD-WI-9', goal: '修好 CI', scope: { files: ['scripts/ci.sh'], newFiles: [] }, toolsWhitelist: ['shell'], budget: { tokens: 1, minutes: 2 } },
    route: { provider: 'p1', model: 'm-high', effort: 'high', source: 'tier', capability: 'Build' },
    assignment: { workDir: 'tmp/superbot/run-x/', isolation: { cwd: 'tmp/superbot/run-x/', allowPaths: ['scripts/ci.sh'], allowNewFiles: [] }, toolsWhitelist: ['shell'], budget: { tokens: 1, minutes: 2 } },
    resident: residentForCapability('Build'),
  });
  assert.match(prompt, /WI-9/);
  assert.match(prompt, /MD-WI-9/);
  assert.match(prompt, /修好 CI/);
  assert.match(prompt, /tmp\/superbot\/run-x\//);
  assert.match(prompt, /scripts\/ci\.sh/);
  assert.doesNotMatch(prompt, /backend-dev · /);
});

test('after approve, the adapter dispatches and starts a spawn standard child', async (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root);
  toAwaiting(root, seeded);
  const approved = handleConsoleDecide(root, seeded, 'approve', {
    issuedBy: 'human:owner',
    write: true,
    now: new Date('2026-11-18T16:00:00+08:00'),
  });
  assert.equal(approved.issued, true);
  assert.ok(approved.mandate?.id);

  const activations = [];
  const live = await startApprovedWorkItem(root, approved, {
    parent: { id: 'session-parent' },
    signal: new AbortController().signal,
    subagents: {
      getProvider: (name) => (name === 'spawn' ? { name, capabilities: { agentPreset: true } } : undefined),
      startActivation: async (spec) => {
        activations.push(spec);
        return { childId: 'child-live-1' };
      },
    },
  });

  assert.equal(live.started, true);
  assert.equal(live.childId, 'child-live-1');
  assert.ok(live.route);
  assert.ok(live.assignment);
  assert.equal(live.dispatch.started, false);
  assert.equal(live.dispatch.process, null);
  assert.equal(live.autoMerge, false);
  assert.equal(activations.length, 1);
  const spec = activations[0];
  assert.equal(spec.provider, 'spawn');
  assert.equal(spec.agentPreset, 'standard');
  assert.equal(spec.delivery, 'parent');
  assert.deepEqual(spec.parent, { id: 'session-parent' });
  assert.match(spec.label, /作|Build|仓|Steward|探|Discover|验|Verify/);
  assert.match(spec.label, new RegExp(seeded.id));
  assert.doesNotMatch(spec.label, /backend-dev · /);
  const text = Array.isArray(spec.prompt) ? spec.prompt.map((block) => block.text).join('\n') : String(spec.prompt);
  assert.match(text, new RegExp(seeded.id));
  assert.match(text, new RegExp(approved.mandate.id));
  assert.match(text, /人已批准/);
  assert.equal(listMandates(root).length, 1);
});

test('missing subagents keeps the Mandate and does not start a session', async (t) => {
  const root = tmpRoot(t);
  const seeded = seedItem(root);
  toAwaiting(root, seeded);
  const approved = handleConsoleDecide(root, seeded, 'approve', {
    issuedBy: 'human:owner',
    write: true,
  });
  const live = await startApprovedWorkItem(root, approved, {
    parent: { id: 'session-parent' },
    ctx: { get: () => undefined },
  });
  assert.equal(approved.issued, true);
  assert.equal(live.started, false);
  assert.equal(live.childId, null);
  assert.match(live.reason, /子会话未启动/);
  assert.equal(listMandates(root).some((entry) => entry.workItem === seeded.id), true);
  assert.equal(getWorkItem(root, seeded.id).state, 'Authorized');
});

test('/superbot-decide approve starts a child; missing spawn keeps the Mandate; reject starts nothing', async (t) => {
  const root = tmpRoot(t);
  const approvedItem = seedItem(root, { id: 'WI-2026-601' });
  toAwaiting(root, approvedItem);
  const missingItem = seedItem(root, { id: 'WI-2026-602', skipThread: true, intent: '缺后端时仍要保留批准' });
  toAwaiting(root, missingItem);
  const rejectedItem = seedItem(root, { id: 'WI-2026-603', skipThread: true, intent: '应被否决' });
  toAwaiting(root, rejectedItem);

  const happy = await boot({ root, workingDirectory: { ensure: async () => root } });
  assert.deepEqual(happy.state.tools.map((tool) => tool.name).sort(), ['superbot_board', 'superbot_dispatch']);
  const decide = happy.state.commands.find((entry) => entry.name === 'superbot-decide');
  assert.ok(decide);
  assert.equal(happy.state.tools.some((tool) => tool.name === 'superbot-decide'), false);

  const approved = await decide.handler({
    rawInput: `approve ${approvedItem.id}`,
    agent: { id: 'session-parent', user: { displayName: '建霖' } },
    signal: new AbortController().signal,
  });
  assert.equal(approved.kind, 'success');
  assert.match(approved.text, /已签发/);
  assert.equal(approved.started, true);
  assert.equal(approved.childId, 'child-live-1');
  assert.ok(approved.route);
  assert.ok(approved.assignment);
  assert.equal(happy.state.activations.length, 1);
  const spec = happy.state.activations[0];
  assert.equal(spec.provider, 'spawn');
  assert.equal(spec.agentPreset, 'standard');
  assert.equal(spec.parent.id, 'session-parent');
  const promptText = spec.prompt[0].text;
  assert.match(promptText, new RegExp(approvedItem.id));
  assert.match(promptText, /Mandate/);
  assert.equal(getWorkItem(root, approvedItem.id).state, 'Authorized');

  const isolated = await boot({
    root,
    workingDirectory: { ensure: async () => root },
    services: { subagents: undefined },
  });
  const isolatedDecide = isolated.state.commands.find((entry) => entry.name === 'superbot-decide');
  const kept = await isolatedDecide.handler({
    rawInput: `approve ${missingItem.id}`,
    agent: { id: 'session-parent', user: { displayName: '建霖' } },
    signal: new AbortController().signal,
  });
  assert.equal(kept.kind, 'success');
  assert.match(kept.text, /已签发/);
  assert.match(kept.text, /子会话未启动/);
  assert.equal(kept.started, false);
  assert.equal(listMandates(root).some((entry) => entry.workItem === missingItem.id), true);
  assert.equal(getWorkItem(root, missingItem.id).state, 'Authorized');

  const beforeReject = happy.state.activations.length;
  const rejected = await decide.handler({
    rawInput: `reject ${rejectedItem.id} 范围过大`,
    agent: { id: 'session-parent', user: { displayName: '建霖' } },
    signal: new AbortController().signal,
  });
  assert.equal(rejected.kind, 'success');
  assert.match(rejected.text, /未签发/);
  assert.equal(rejected.started, false);
  assert.equal(rejected.childId, null);
  assert.equal(happy.state.activations.length, beforeReject);
  assert.equal(listMandates(root).some((entry) => entry.workItem === rejectedItem.id), false);
});

test('plugin source still has no HTTP server and does not register occupied slots', () => {
  const source = readFileSync(fileURLToPath(PLUGIN), 'utf8');
  const adapter = readFileSync(new URL('../lib/live-loop-adapter.mjs', import.meta.url), 'utf8');
  for (const banned of ['webServer', '/api/ds-superbot', 'createServer(', 'listen(']) {
    assert.ok(!source.includes(banned), `index.js must not reference ${banned}`);
    assert.ok(!adapter.includes(banned), `live-loop-adapter must not reference ${banned}`);
  }
  assert.match(adapter, /dispatchWorkItem/);
  assert.match(adapter, /startActivation/);
  assert.doesNotMatch(adapter, /name:\s*['"]superbot_dispatch['"]/);
  assert.doesNotMatch(adapter, /tools\.register\(/);
});
