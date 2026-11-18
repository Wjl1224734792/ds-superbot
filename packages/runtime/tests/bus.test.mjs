import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import * as bus from '../src/bus.mjs';
import { tmpRoot } from './lib/helpers.mjs';

test('bus.append writes a file-backed JSONL event and bus.read returns it', (t) => {
  const root = tmpRoot(t);
  const ev = bus.append({
    root,
    type: 'signal',
    source: 'ci',
    payload: { text: 'CI is red' },
  });
  assert.equal(bus.isEventId(ev.id), true);
  assert.equal(ev.type, 'signal');
  assert.equal(ev.source, 'ci');
  assert.match(ev.at, /[+-]\d{2}:\d{2}$/);
  assert.equal(existsSync(bus.eventsPath(root)), true);
  const lines = readFileSync(bus.eventsPath(root), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);

  const ev2 = bus.append(root, { type: 'signal', source: 'github', workItem: 'WI-2026-001', payload: { n: 2 } });
  const all = bus.read({ root });
  assert.equal(all.length, 2);
  assert.equal(all[0].id, ev.id);
  assert.equal(all[1].id, ev2.id);
  assert.equal(bus.read({ root, source: 'ci' }).length, 1);
  assert.equal(bus.read({ root, workItem: 'WI-2026-001' }).length, 1);
  assert.equal(bus.read({ root, type: 'would-accept' }).length, 0);
});

test('bus.subscribe is notified on later appends and can unsubscribe', (t) => {
  const root = tmpRoot(t);
  const seen = [];
  const stop = bus.subscribe({ root, handler: (ev) => seen.push(ev.id) });
  bus.append({ root, type: 'signal', payload: { a: 1 } });
  bus.append({ root, type: 'signal', payload: { a: 2 } });
  assert.equal(seen.length, 2);
  stop();
  bus.append({ root, type: 'signal', payload: { a: 3 } });
  assert.equal(seen.length, 2);
  assert.equal(bus.read({ root }).length, 3);
});
