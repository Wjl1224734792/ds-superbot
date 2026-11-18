import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import {
  addItemToThread,
  assertChannelUri,
  bindChannel,
  createThread,
  createWorkItem,
  findThreadsByChannel,
  getThread,
  listThreads,
  resolveThread,
} from '../src/index.mjs';
import { ConstitutionError } from '../src/errors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '../bin/constitution.mjs');
const DEFAULT_POLICY = readFileSync(join(HERE, '../templates/policy.default.yaml'), 'utf8');

function tmpRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'constitution-th-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'AGENTS.md'), '# AGENTS\n\nfixture.\n');
  writeFileSync(join(root, 'README.md'), '# Fixture\n');
  mkdirSync(join(root, '.superbot/policy'), { recursive: true });
  writeFileSync(join(root, '.superbot/policy/default.yaml'), DEFAULT_POLICY);
  return root;
}

test('assertChannelUri accepts scheme://… and rejects bare or empty values', () => {
  assert.equal(assertChannelUri('group://repo-ops'), 'group://repo-ops');
  assert.equal(assertChannelUri('github://owner/repo'), 'github://owner/repo');
  assert.throws(() => assertChannelUri('repo-ops'), ConstitutionError);
  assert.throws(() => assertChannelUri('group:foo'), ConstitutionError);
  assert.throws(() => assertChannelUri('://missing'), ConstitutionError);
  assert.throws(() => assertChannelUri('group://'), ConstitutionError);
  assert.throws(() => assertChannelUri('group://foo/../bar'), /invalid channel URI/);
});

test('bindChannel is idempotent and does not fork a second thread', (t) => {
  const root = tmpRoot(t);
  const created = createThread(root, {
    slug: 'repo-ops-ci',
    title: 'CI 持续变红',
    channels: ['group://repo-ops'],
  }, { write: true }).document;
  const once = bindChannel(root, created.id, 'github://owner/repo', { write: true }).document;
  assert.deepEqual(once.channels, ['group://repo-ops', 'github://owner/repo']);
  const twice = bindChannel(root, created.id, 'github://owner/repo', { write: true });
  assert.equal(twice.skipped, true);
  assert.deepEqual(twice.document.channels, once.channels);
  assert.equal(listThreads(root).length, 1);
  assert.equal(getThread(root, created.id).schemaVersion, 1);
});

test('resolveThread reuses the existing thread and unions channels', (t) => {
  const root = tmpRoot(t);
  createThread(root, {
    slug: 'repo-ops-ci',
    title: 'CI 持续变红',
    channels: ['group://repo-ops'],
  }, { write: true });
  const resolved = resolveThread({
    root,
    channels: ['group://repo-ops', 'github://owner/repo'],
    slug: 'should-not-create',
    title: 'Should not fork',
    write: true,
  });
  assert.equal(resolved.reused, true);
  assert.equal(resolved.document.id, 'TH-repo-ops-ci');
  assert.deepEqual(resolved.document.channels, ['group://repo-ops', 'github://owner/repo']);
  assert.equal(listThreads(root).length, 1);
  assert.deepEqual(findThreadsByChannel(root, 'github://owner/repo').map((th) => th.id), ['TH-repo-ops-ci']);
  assert.deepEqual(findThreadsByChannel(root, 'group://repo-ops').map((th) => th.id), ['TH-repo-ops-ci']);
});

test('a work item on the thread is associated with every bound channel', (t) => {
  const root = tmpRoot(t);
  createThread(root, {
    slug: 'repo-ops-ci',
    title: 'CI 持续变红',
    channels: ['group://repo-ops'],
  }, { write: true });
  bindChannel(root, 'TH-repo-ops-ci', 'github://owner/repo', { write: true });
  const item = createWorkItem(root, {
    thread: 'TH-repo-ops-ci',
    intent: '把 CI 红灯率降到 0',
    risk: 'R1',
    reversible: true,
    authority: 'policy:auto-low',
    ac: [{ id: 'AC-1', text: '主干最近 20 次 CI 全绿', coveredBy: [] }],
    nonGoals: [],
    scope: { files: [], newFiles: [], owners: [] },
    gates: ['validate-plan', 'verify'],
    origin: { kind: 'human', ref: 'group://repo-ops/msg/abc', evidence: [] },
  }, { write: true }).document;
  const viaGroup = findThreadsByChannel(root, 'group://repo-ops')[0];
  const viaGithub = findThreadsByChannel(root, 'github://owner/repo')[0];
  assert.equal(viaGroup.id, viaGithub.id);
  assert.ok(viaGroup.workItems.includes(item.id));
  assert.ok(viaGithub.workItems.includes(item.id));
  const again = addItemToThread(root, viaGroup.id, item.id, { write: true });
  assert.equal(again.document.workItems.filter((id) => id === item.id).length, 1);
});

test('resolveThread refuses to merge two existing thread objects', (t) => {
  const root = tmpRoot(t);
  createThread(root, { slug: 'ops', title: 'Ops', channels: ['group://repo-ops'] }, { write: true });
  createThread(root, { slug: 'code', title: 'Code', channels: ['github://owner/repo'] }, { write: true });
  assert.throws(
    () => resolveThread({
      root,
      channels: ['group://repo-ops', 'github://owner/repo'],
      write: false,
    }),
    /multiple threads/,
  );
  assert.equal(listThreads(root).length, 2);
});

test('CLI thread bind-channel unions a channel onto the same object', (t) => {
  const root = tmpRoot(t);
  const created = spawnSync(process.execPath, [
    CLI, root, 'thread', 'create', '--slug', 'demo', '--title', 'Demo',
    '--channel', 'group://repo-ops', '--write', '--json',
  ], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  const bound = spawnSync(process.execPath, [
    CLI, root, 'thread', 'bind-channel', '--id', 'TH-demo',
    '--channel', 'github://owner/repo', '--write', '--json',
  ], { encoding: 'utf8' });
  assert.equal(bound.status, 0, bound.stderr);
  const doc = JSON.parse(bound.stdout).document ?? JSON.parse(bound.stdout);
  const channels = doc.channels ?? doc.document?.channels;
  assert.ok(channels.includes('group://repo-ops'));
  assert.ok(channels.includes('github://owner/repo'));
});
