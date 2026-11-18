/**
 * The DSH web client cannot import monorepo packages through ModuleLoader, so
 * presenceOf is synced into client.js. This test proves the copy matches
 * packages/im/src/presence.mjs, and that client.js has no second state→eye table
 * outside the SYNC block.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { presenceOf as imPresenceOf, presenceField as imPresenceField } from '../../im/src/presence.mjs';
import { FACES } from '../../im/src/types.mjs';
import { presenceOf as pluginPresenceOf, presenceField as pluginPresenceField } from '../lib/presence-standalone.mjs';
import { presenceClassNames, ariaLabelFromCaption } from '../lib/presence-classes.mjs';
import { chatSpeechFor, stageField } from '../lib/console-model.mjs';

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(PLUGIN_ROOT, '../client.js');
const STATES = [
  'Signal', 'Candidate', 'Dropped', 'Explored', 'Proposed', 'AwaitingApproval',
  'Authorized', 'Parked', 'Planned', 'Approved', 'Building', 'Verifying',
  'Delivered', 'Failed',
];
const SPEAK = [undefined, 'approval', 'result'];

function item(state, id = 'WI-2026-114') {
  return { id, state };
}

function allCases(run) {
  for (const state of STATES) {
    for (const face of FACES) {
      for (const speakKind of SPEAK) {
        run(item(state), face, speakKind, state);
      }
    }
  }
}

test('plugin standalone presenceOf matches packages/im/src/presence.mjs', () => {
  allCases((workItem, face, speakKind) => {
    const im = imPresenceOf({ workItem, face, speakKind });
    const copy = pluginPresenceOf({ workItem, face, speakKind });
    assert.deepEqual(copy, im, `${workItem.state}/${face}/${speakKind}`);
  });
  for (const state of STATES) {
    for (const speakKind of SPEAK) {
      assert.deepEqual(
        pluginPresenceField(item(state), speakKind),
        imPresenceField(item(state), speakKind),
        `field ${state}/${speakKind}`,
      );
    }
  }
});

test('client.js SYNC block matches packages/im/src/presence.mjs', async () => {
  const source = readFileSync(CLIENT, 'utf8');
  const match = source.match(/\/\/ --- BEGIN SYNC: packages\/im\/src\/presence\.mjs ---\n([\s\S]*?)\n\s*\/\/ --- END SYNC ---/);
  assert.ok(match, 'client.js must wrap presenceOf in SYNC markers');
  const body = match[1]
    .replace(/^    /gm, '')
    .replace(/^const /gm, 'export const ')
    .replace(/^function /gm, 'export function ');
  const url = `data:text/javascript,${encodeURIComponent(body)}`;
  const embedded = await import(url);
  allCases((workItem, face, speakKind) => {
    const im = imPresenceOf({ workItem, face, speakKind });
    const copy = embedded.presenceOf({ workItem, face, speakKind });
    assert.deepEqual(copy, im, `client ${workItem.state}/${face}/${speakKind}`);
  });
});

test('client.js has no second state-to-eye table outside the SYNC block', () => {
  const source = readFileSync(CLIENT, 'utf8');
  const begin = source.indexOf('// --- BEGIN SYNC: packages/im/src/presence.mjs ---');
  const end = source.indexOf('// --- END SYNC ---');
  assert.ok(begin >= 0 && end > begin, 'SYNC markers are required');
  const outside = source.slice(0, begin) + '\n' + source.slice(end + '// --- END SYNC ---'.length);
  // A second mapping would branch on work-item states to assign an eye or motion.
  const forbidden = [
    /case\s+'AwaitingApproval'[\s\S]{0,180}eye/,
    /case\s+'Building'[\s\S]{0,180}focus/,
    /case\s+'Verifying'[\s\S]{0,180}inspect/,
    /state\s*===\s*'AwaitingApproval'[\s\S]{0,120}eye\s*[:=]/,
    /eye:\s*'await'/,
    /pose\(\s*'focus'/,
    /pose\(\s*'await'/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(outside, pattern, `second mapping leaked outside SYNC: ${pattern}`);
  }
});

test('presenceClassNames and aria labels consume a presenceOf result only', () => {
  const presence = imPresenceOf({ workItem: item('AwaitingApproval'), face: 'cang' });
  assert.equal(presence.caption, '仓正在看你 · 待批 WI-2026-114');
  assert.equal(ariaLabelFromCaption(presence.caption), '仓，正在看你，待批 WI-2026-114');
  const live = presenceClassNames(presence, { reducedMotion: false });
  assert.match(live, /stwd-resident--cang/);
  assert.match(live, /stwd-eye-await/);
  assert.match(live, /stwd-motion-gaze/);
  assert.match(live, /stwd-energy-high/);
  const reduced = presenceClassNames(presence, { reducedMotion: true });
  assert.match(reduced, /stwd-motion-still/);
  assert.match(reduced, /stwd-reduced/);
  assert.match(reduced, /stwd-eye-await/);
  assert.doesNotMatch(reduced, /stwd-motion-gaze/);
});

test('stage field still has at most one high-energy face', () => {
  const items = [
    item('AwaitingApproval', 'WI-1'),
    { id: 'WI-2', state: 'Failed' },
    { id: 'WI-3', state: 'Delivered' },
  ];
  const field = stageField(items);
  const highs = field.filter((entry) => entry.energy === 'high');
  assert.ok(highs.length <= 1, `highs: ${highs.map((entry) => entry.face)}`);
});

test('chat stays quiet while Building or Verifying', () => {
  assert.equal(chatSpeechFor({ state: 'Building' }).ok, false);
  assert.equal(chatSpeechFor({ state: 'Verifying' }).ok, false);
  assert.equal(chatSpeechFor({ state: 'AwaitingApproval' }).ok, true);
  assert.equal(chatSpeechFor({ state: 'AwaitingApproval' }).kind, 'approval');
  assert.equal(chatSpeechFor({ state: 'Delivered' }).ok, true);
  assert.equal(chatSpeechFor({ state: 'Failed' }).ok, true);
});
