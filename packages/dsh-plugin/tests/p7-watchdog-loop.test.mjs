/**
 * P7 Watchdog loop: after human approve, start is called and a tick runs;
 * approved items are execute on later ticks; unapproved siblings stay
 * would-accept; stop clears the timer; DEFAULT_AUTHORITY stays observe.
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
  saveDocument,
  transitionWorkItem,
} from '../../constitution/src/index.mjs';
import { DEFAULT_AUTHORITY } from '../../runtime/src/loop.mjs';
import * as watchdog from '../../runtime/src/watchdog.mjs';
import { tmpRoot } from '../../runtime/tests/lib/helpers.mjs';
import { handleConsoleDecide } from '../lib/decide-adapter.mjs';
import * as consoleModel from '../lib/console-model.mjs';
import {
  armWatchdogLoop,
  disarmAllWatchdogLoops,
  disarmIfNoExecutable,
  disarmWatchdogLoop,
  hasExecutableWorkItems,
  isWatchdogLoopArmed,
} from '../lib/watchdog-loop-adapter.mjs';

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

function fakeScheduler() {
  const timers = new Map();
  let next = 1;
  return {
    setInterval(fn, ms) {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    tickAll() {
      for (const entry of [...timers.values()]) entry.fn();
    },
    get size() {
      return timers.size;
    },
  };
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
  const state = { skills: [], tools: [], commands: [], activations: [], config: emptyConfig(), disposers: [] };
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
      if (typeof disposer === 'function') state.disposers.push(disposer);
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

test('console-model.mjs stays a pure helper with no watchdog-loop imports', () => {
  const source = readFileSync(new URL('../lib/console-model.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /watchdog-loop-adapter|armWatchdogLoop|auto-low-adapter|applyAutoLow|git-adapter/);
  assert.equal(typeof consoleModel.armWatchdogLoop, 'undefined');
});

test('after approve, start is called and a tick runs; later ticks treat the item as execute', (t) => {
  t.after(() => { disarmAllWatchdogLoops(); });
  const root = tmpRoot(t);
  const approved = seedItem(root, { id: 'WI-2026-701' });
  const sibling = seedItem(root, { id: 'WI-2026-702', skipThread: true, intent: '未批准的兄弟项' });
  toAwaiting(root, approved);
  toAwaiting(root, sibling);

  const decision = handleConsoleDecide(root, approved, 'approve', {
    issuedBy: 'human:owner',
    write: true,
    now: new Date('2026-11-18T12:00:00+08:00'),
  });
  assert.equal(decision.issued, true);
  assert.ok(decision.mandate?.id);

  // transitionWorkItem stamps updatedAt with wall-clock time; pin it so idle is deterministic.
  const approvedNow = getWorkItem(root, approved.id);
  saveDocument(root, 'workitem', { ...approvedNow, updatedAt: '2026-11-18T12:00:00+08:00' }, { write: true });
  const siblingNow = getWorkItem(root, sibling.id);
  saveDocument(root, 'workitem', { ...siblingNow, state: 'Building', updatedAt: '2026-11-18T12:00:00+08:00' }, { write: true });

  const scheduler = fakeScheduler();
  const watch = armWatchdogLoop(root, {
    scheduler,
    intervalMs: 30_000,
    now: new Date('2026-11-18T12:00:00+08:00'),
    idleAfterMinutes: 15,
  });
  assert.equal(watch.started, true);
  assert.equal(watch.armed, true);
  assert.equal(watch.mandatePreserved, true);
  assert.equal(watch.loop.status, 'running');
  assert.equal(watch.loop.authority, 'observe');
  assert.equal(watch.firstTick.loop.ticks, 1);
  assert.equal(isWatchdogLoopArmed(root), true);
  assert.equal(scheduler.size, 1);
  assert.equal(DEFAULT_AUTHORITY, 'observe');
  assert.equal(hasExecutableWorkItems(root, { now: new Date('2026-11-18T12:00:00+08:00') }), true);

  // Advance past the idle threshold so the next tick parks the approved item.
  const idleNow = new Date('2026-11-18T13:00:00+08:00');
  const tick2 = watchdog.tick({
    root,
    now: idleNow,
    idleAfterMinutes: 15,
  });
  assert.ok(tick2.actions.some((action) => action.workItem === approved.id && (action.type === 'revoke' || action.type === 'park')));
  assert.equal(tick2.actions.some((action) => action.workItem === sibling.id), false);
  assert.ok(tick2.wouldAccept.some((row) => row.workItem === sibling.id && row.action === 'park'));
  assert.equal(getWorkItem(root, sibling.id).state, 'Building');
  assert.equal(getWorkItem(root, approved.id).state, 'Parked');

  const stopped = disarmWatchdogLoop(root, { now: idleNow });
  assert.equal(stopped.cleared, true);
  assert.equal(stopped.stopped, true);
  assert.equal(isWatchdogLoopArmed(root), false);
  assert.equal(scheduler.size, 0);
  assert.equal(watchdog.getLoop(root).status, 'stopped');
});

test('missing scheduler keeps the Mandate and reports the loop was not armed', (t) => {
  t.after(() => { disarmAllWatchdogLoops(); });
  const root = tmpRoot(t);
  const item = seedItem(root);
  toAwaiting(root, item);
  const decision = handleConsoleDecide(root, item, 'approve', {
    issuedBy: 'human:owner',
    write: true,
  });
  const watch = armWatchdogLoop(root, { setInterval: null, scheduler: null });
  assert.equal(decision.issued, true);
  assert.equal(watch.started, true);
  assert.equal(watch.armed, false);
  assert.equal(watch.mandatePreserved, true);
  assert.match(watch.reason, /Watchdog 循环未能武装/);
  assert.equal(listMandates(root).some((entry) => entry.workItem === item.id), true);
  assert.equal(getWorkItem(root, item.id).state, 'Authorized');
  assert.equal(isWatchdogLoopArmed(root), false);
  assert.ok((watch.firstTick?.loop?.ticks ?? 0) >= 1);
});

test('reject does not arm an execute loop; last watched item can disarm', (t) => {
  t.after(() => { disarmAllWatchdogLoops(); });
  const root = tmpRoot(t);
  const item = seedItem(root);
  toAwaiting(root, item);
  const rejected = handleConsoleDecide(root, item, 'reject', {
    issuedBy: 'human:owner',
    write: true,
    reason: '范围过大',
  });
  assert.equal(rejected.issued, false);
  assert.equal(listMandates(root).length, 0);
  assert.equal(hasExecutableWorkItems(root), false);

  const scheduler = fakeScheduler();
  // Reject path must not need a loop; if one is somehow started, disarmIfNoExecutable stops it.
  const after = disarmIfNoExecutable(root, { scheduler });
  assert.equal(after.stopped || after.reason === 'no-executable-items', true);
  assert.equal(isWatchdogLoopArmed(root), false);
  assert.equal(DEFAULT_AUTHORITY, 'observe');
});

test('/superbot-decide approve arms the loop; reject of the last item clears it', async (t) => {
  t.after(() => { disarmAllWatchdogLoops(); });
  const root = tmpRoot(t);
  const approvedItem = seedItem(root, { id: 'WI-2026-711' });
  toAwaiting(root, approvedItem);

  const bucket = await boot({ root, workingDirectory: { ensure: async () => root } });
  const decide = bucket.state.commands.find((entry) => entry.name === 'superbot-decide');
  assert.ok(decide);

  const approved = await decide.handler({
    rawInput: `approve ${approvedItem.id}`,
    agent: { id: 'session-parent', user: { displayName: '建霖' } },
    signal: new AbortController().signal,
  });
  assert.equal(approved.kind, 'success');
  assert.match(approved.text, /已签发/);
  assert.equal(approved.started, true);
  assert.equal(approved.watchdog?.armed, true);
  assert.equal(approved.watchdog?.mandatePreserved, true);
  assert.match(approved.text, /Watchdog 循环已按 observe 武装/);
  assert.equal(isWatchdogLoopArmed(root), true);
  assert.equal(watchdog.getLoop(root).authority, 'observe');
  assert.ok((watchdog.getLoop(root).ticks ?? 0) >= 1);
  assert.deepEqual(bucket.state.tools.map((tool) => tool.name).sort(), ['superbot_board', 'superbot_dispatch']);

  const rejected = await decide.handler({
    rawInput: `reject ${approvedItem.id} 停止`,
    agent: { id: 'session-parent', user: { displayName: '建霖' } },
    signal: new AbortController().signal,
  });
  assert.equal(rejected.kind, 'success');
  assert.match(rejected.text, /未签发/);
  assert.equal(isWatchdogLoopArmed(root), false);
  const loop = watchdog.getLoop(root);
  assert.ok(!loop || loop.status === 'stopped');

  for (const disposer of bucket.state.disposers) disposer();
  assert.equal(isWatchdogLoopArmed(root), false);
});

test('plugin and adapters still have no HTTP server', () => {
  const source = readFileSync(fileURLToPath(PLUGIN), 'utf8');
  const loop = readFileSync(new URL('../lib/watchdog-loop-adapter.mjs', import.meta.url), 'utf8');
  for (const banned of ['webServer', '/api/ds-superbot', 'createServer(', 'listen(']) {
    assert.ok(!source.includes(banned), `index.js must not reference ${banned}`);
    assert.ok(!loop.includes(banned), `watchdog-loop-adapter must not reference ${banned}`);
  }
  assert.match(source, /armWatchdogLoop/);
  assert.match(loop, /authority: 'observe'/);
  assert.doesNotMatch(loop, /DEFAULT_AUTHORITY\s*=\s*'execute'/);
});
