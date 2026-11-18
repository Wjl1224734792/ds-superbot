/**
 * Limited auto-low live path: dispatch + optional sub-session without
 * issuing a Mandate; R2/R3 / requireHuman / touches still wait for a human.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createThread,
  createWorkItem,
  listMandates,
} from '../../constitution/src/index.mjs';
import { canExecute, DEFAULT_AUTHORITY } from '../../runtime/src/loop.mjs';
import { tmpRoot } from '../../runtime/tests/lib/helpers.mjs';
import {
  applyAutoLow,
  buildAutoLowPrompt,
  canApplyAutoLow,
} from '../lib/auto-low-adapter.mjs';
import * as consoleModel from '../lib/console-model.mjs';
import { armWatchdogLoop, disarmAllWatchdogLoops } from '../lib/watchdog-loop-adapter.mjs';
import * as watchdog from '../../runtime/src/watchdog.mjs';

function seed(root, overrides = {}) {
  if (!overrides.skipThread) {
    try {
      createThread(root, { slug: 'repo-ops-ci', title: 'CI', channels: [] }, { write: true });
    } catch {
      // already exists
    }
  }
  return createWorkItem(root, {
    thread: 'TH-repo-ops-ci',
    intent: '整理文档索引',
    risk: 'R1',
    reversible: true,
    authority: 'policy:auto-low',
    ac: [{ id: 'AC-1', text: '索引可读', coveredBy: ['T1'] }],
    nonGoals: [],
    scope: { files: ['docs/README.md'], newFiles: [], owners: ['pm'] },
    gates: ['validate-plan', 'verify'],
    origin: { kind: 'human', ref: 'manual', evidence: [] },
    ...overrides,
  }, { write: true }).document;
}

test('console-model.mjs does not import auto-low', () => {
  const source = readFileSync(new URL('../lib/console-model.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /applyAutoLow|dispatchAutoLow|auto-low-adapter/);
  assert.equal(typeof consoleModel.applyAutoLow, 'undefined');
});

test('applyAutoLow dispatches and can start a spawn child without a Mandate', async (t) => {
  t.after(() => { disarmAllWatchdogLoops(); });
  const root = tmpRoot(t);
  const item = seed(root);
  const activations = [];
  const out = await applyAutoLow(root, item, {
    parent: { id: 'session-parent' },
    subagents: {
      getProvider: (name) => (name === 'spawn' ? { name, capabilities: { agentPreset: true } } : undefined),
      startActivation: async (spec) => {
        activations.push(spec);
        return { childId: 'child-auto-low-1' };
      },
    },
  });

  assert.equal(out.applied, true);
  assert.equal(out.issued, false);
  assert.equal(out.mandate, null);
  assert.equal(out.started, true);
  assert.equal(out.childId, 'child-auto-low-1');
  assert.equal(out.autoMerge, false);
  assert.equal(out.canExecute, false);
  assert.equal(out.executeArmed, false);
  assert.equal(out.defaultAuthority, 'observe');
  assert.equal(DEFAULT_AUTHORITY, 'observe');
  assert.equal(canExecute(root, item).allowed, false);
  assert.equal(listMandates(root).length, 0);
  assert.equal(activations.length, 1);
  assert.equal(activations[0].provider, 'spawn');
  assert.equal(activations[0].agentPreset, 'standard');
  const text = activations[0].prompt[0].text;
  assert.match(text, /auto-low/);
  assert.match(text, /未签发 Mandate/);
  assert.doesNotMatch(text, /人已批准/);

  const prompt = buildAutoLowPrompt({
    workItem: item,
    workItemId: item.id,
    route: out.route,
    assignment: out.assignment,
    isolation: out.isolation,
    resident: out.resident,
  });
  assert.match(prompt, /有限 auto-low/);

  // Watchdog for unapproved auto-low stays would-accept even if a loop is armed.
  const scheduler = { setInterval: () => 1, clearInterval() {}, size: 0 };
  const watch = armWatchdogLoop(root, {
    scheduler,
    intervalMs: 30_000,
    now: new Date('2026-11-18T15:00:00+08:00'),
  });
  assert.equal(watch.loop.authority, 'observe');
  const later = watchdog.tick({
    root,
    now: new Date('2026-11-18T16:00:00+08:00'),
    idleAfterMinutes: 15,
  });
  assert.equal(later.actions.some((action) => action.workItem === item.id), false);
  assert.equal(canExecute(root, item).allowed, false);
});

test('applyAutoLow refuses R2, R3, requireHuman, and sensitive touches', async (t) => {
  const root = tmpRoot(t);
  const cases = [
    seed(root, { id: 'WI-2026-822', risk: 'R2', authority: 'human-approval', intent: '改计费' }),
    seed(root, { id: 'WI-2026-823', skipThread: true, risk: 'R3', authority: 'human-approval', intent: '删生产' }),
    seed(root, {
      id: 'WI-2026-824',
      skipThread: true,
      risk: 'R1',
      reversible: true,
      authority: 'policy:auto-low',
      intent: '碰密钥',
      touches: ['secrets'],
    }),
    seed(root, {
      id: 'WI-2026-825',
      skipThread: true,
      risk: 'R1',
      reversible: true,
      authority: 'human-approval',
      intent: '显式人批',
    }),
  ];
  const activations = [];
  const subagents = {
    getProvider: () => ({ name: 'spawn' }),
    startActivation: async (spec) => {
      activations.push(spec);
      return { childId: 'should-not-start' };
    },
  };
  for (const item of cases) {
    assert.equal(canApplyAutoLow(root, item).allowed, false);
    const out = await applyAutoLow(root, item, {
      parent: { id: 'session-parent' },
      subagents,
    });
    assert.equal(out.applied, false, item.id);
    assert.equal(out.issued, false, item.id);
    assert.equal(out.started, false, item.id);
    assert.equal(out.childId, null);
  }
  assert.equal(activations.length, 0);
  assert.equal(listMandates(root).length, 0);
  assert.equal(DEFAULT_AUTHORITY, 'observe');
});

test('auto-low adapter has no HTTP and does not mention superbot_dispatch', () => {
  const source = readFileSync(new URL('../lib/auto-low-adapter.mjs', import.meta.url), 'utf8');
  for (const banned of ['webServer', '/api/ds-superbot', 'createServer(', 'listen(', 'slack', 'github.com', 'nodemailer']) {
    assert.ok(!source.includes(banned), `must not reference ${banned}`);
  }
  assert.doesNotMatch(source, /name:\s*['"]superbot_dispatch['"]/);
  assert.doesNotMatch(source, /import\s*\{[^}]*approveDecision/);
  assert.equal(source.includes('approveDecision('), false);
});
