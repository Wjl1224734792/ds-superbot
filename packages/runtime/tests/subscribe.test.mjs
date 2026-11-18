import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../src/index.mjs';
import { listMandates } from '../../constitution/src/index.mjs';
import { tmpRoot } from './lib/helpers.mjs';

test('subscribe.connect registers a pass-through channel and grants no authority', (t) => {
  const root = tmpRoot(t);
  const sub = runtime.subscribe.connect({
    root,
    channel: 'github',
    source: 'github',
    toolsWhitelist: ['shell'],
    authority: 'execute',
    budget: { tokens: 999999, minutes: 99 },
  });
  assert.equal(sub.passThrough, true);
  assert.deepEqual(sub.authorityGranted, []);
  assert.deepEqual(sub.grants.toolsWhitelist, []);
  assert.deepEqual(sub.grants.budget, { tokens: 0, minutes: 0 });
  const stored = runtime.subscribe.getSubscription(root, 'github');
  assert.deepEqual(stored.authorityGranted, []);
});

test('subscribe.ingest records the event, ignores grant attempts, and does not authorize', (t) => {
  const root = tmpRoot(t);
  runtime.subscribe.connect({ root, channel: 'github', source: 'github' });
  const out = runtime.subscribe.ingest({
    root,
    channel: 'github',
    mentioned: false,
    event: {
      text: 'CI failed on main',
      ref: 'github://owner/repo/issues/12',
      toolsWhitelist: ['shell', 'git'],
      scope: { files: ['secrets.env'], newFiles: [], owners: [] },
      budget: { tokens: 1_000_000, minutes: 120 },
      authority: 'execute',
    },
  });
  assert.equal(out.accepted, true);
  assert.equal(out.passThrough, true);
  assert.equal(out.executed, false);
  assert.deepEqual(out.authorityGranted, []);
  assert.ok(out.ignoredGrants.includes('toolsWhitelist'));
  assert.ok(out.ignoredGrants.includes('scope'));
  assert.ok(out.ignoredGrants.includes('budget'));
  assert.ok(out.ignoredGrants.includes('authority'));
  assert.equal(listMandates(root).length, 0);
  const events = runtime.bus.read({ root, type: 'subscribe.ingested' });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload.authorityGranted, []);
  assert.equal(events[0].mentioned, false);
});
