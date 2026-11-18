/**
 * Real git adapter: inspect works; recordMergeIntent does not mutate git;
 * human merge may fast-forward or merge; machine issuers cannot merge;
 * auto-merge throws; push is never invoked.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as runtime from '../src/index.mjs';
import { tmpRoot } from './lib/helpers.mjs';

function git(root, args, opts = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' },
    ...opts,
  });
  if (result.status !== 0 && opts.allowFail !== true) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function initRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'superbot-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'init']);
  return root;
}

function head(root) {
  return git(root, ['rev-parse', 'HEAD']).stdout.trim();
}

function spyRun(calls) {
  return (root, args, options = {}) => {
    calls.push(['git', ...args]);
    if (runtime.argvIncludesPush(args)) {
      const err = new Error('spy saw git push');
      err.code = runtime.GIT_PUSH_FORBIDDEN;
      throw err;
    }
    return spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...(options.env ?? {}) },
      timeout: options.timeout ?? 15_000,
    });
  };
}

test('runtime exports the git adapter and DEFAULT_AUTHORITY stays observe', () => {
  assert.equal(runtime.DEFAULT_AUTHORITY, 'observe');
  assert.equal(typeof runtime.applyMerge, 'function');
  assert.equal(typeof runtime.gitStatus, 'function');
  assert.equal(typeof runtime.gitDiff, 'function');
  assert.equal(typeof runtime.git.isGitRepo, 'function');
  assert.equal(typeof runtime.recordMergeIntent, 'function');
});

test('status / diff / log / rev-parse / branch work in a real git repo', (t) => {
  const root = initRepo(t);
  const calls = [];
  const run = spyRun(calls);

  const st = runtime.gitStatus(root, ['--porcelain'], { run });
  assert.equal(st.ok, true);
  assert.equal(st.stdout.trim(), '');

  writeFileSync(join(root, 'README.md'), '# fixture\nchanged\n');
  const diff = runtime.gitDiff(root, [], { run });
  assert.equal(diff.ok, true);
  assert.match(diff.stdout, /changed/);

  const log = runtime.gitLog(root, ['-1', '--oneline'], { run });
  assert.equal(log.ok, true);
  assert.match(log.stdout, /init/);

  const parsed = runtime.revParse(root, ['HEAD'], { run });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.stdout.trim(), head(root));

  const branches = runtime.gitBranch(root, [], { run });
  assert.equal(branches.ok, true);
  assert.match(branches.stdout, /main/);

  assert.equal(calls.some((argv) => argv.includes('push')), false);
  assert.throws(
    () => runtime.gitBranch(root, ['-d', 'main'], { run }),
    (err) => err.code === runtime.GIT_COMMAND_REFUSED,
  );
});

test('missing git repo fails safely and never pushes', (t) => {
  const root = tmpRoot(t);
  const st = runtime.gitStatus(root, ['--porcelain']);
  assert.equal(st.ok, false);
  assert.equal(st.executed, false);
  assert.equal(st.code, runtime.GIT_NOT_A_REPO);
  assert.equal(runtime.isGitRepo(root), false);

  const merged = runtime.applyMerge(root, { decidedBy: 'human:owner', ref: 'main' });
  assert.equal(merged.ok, false);
  assert.equal(merged.executed, false);
  assert.equal(merged.code, runtime.GIT_NOT_A_REPO);

  assert.throws(
    () => runtime.runGit(root, ['push', 'origin', 'main']),
    (err) => err.code === runtime.GIT_PUSH_FORBIDDEN,
  );
});

test('recordMergeIntent still does not mutate git', (t) => {
  const root = initRepo(t);
  writeFileSync(join(root, 'notes.txt'), 'keep\n');
  git(root, ['add', 'notes.txt']);
  git(root, ['commit', '-m', 'notes']);
  const before = head(root);
  const trackedBefore = git(root, ['status', '--porcelain', '--untracked-files=no']).stdout;

  const recorded = runtime.recordMergeIntent(root, {
    workItem: 'WI-2026-700',
    action: 'merge',
    decidedBy: 'human:owner',
  }, { write: true });
  assert.equal(recorded.executed, false);
  assert.equal(recorded.git, false);
  assert.equal(head(root), before);
  // Ledger writes may add untracked `.superbot/` files; git itself must not change.
  assert.equal(git(root, ['status', '--porcelain', '--untracked-files=no']).stdout, trackedBefore);
  assert.equal(git(root, ['diff', '--name-only']).stdout.trim(), '');

  assert.throws(
    () => runtime.recordMergeIntent(root, { workItem: 'WI-2026-700', action: 'auto-merge' }, { write: true }),
    (err) => err.code === 'AUTO_MERGE_DISABLED',
  );
  assert.equal(head(root), before);
});

test('human merge can fast-forward or merge when explicitly called', (t) => {
  const root = initRepo(t);
  const calls = [];
  const run = spyRun(calls);

  git(root, ['checkout', '-b', 'feature']);
  writeFileSync(join(root, 'feature.txt'), 'feat\n');
  git(root, ['add', 'feature.txt']);
  git(root, ['commit', '-m', 'feature']);
  const featureHead = head(root);
  git(root, ['checkout', 'main']);
  const mainBefore = head(root);
  assert.notEqual(featureHead, mainBefore);

  const ff = runtime.applyMerge(root, { decidedBy: 'human:owner', ref: 'feature' }, { run });
  assert.equal(ff.ok, true);
  assert.equal(ff.executed, true);
  assert.equal(ff.git, true);
  assert.equal(head(root), featureHead);

  // Diverged histories: a real merge commit.
  git(root, ['checkout', '-b', 'other']);
  writeFileSync(join(root, 'other.txt'), 'other\n');
  git(root, ['add', 'other.txt']);
  git(root, ['commit', '-m', 'other']);
  git(root, ['checkout', 'main']);
  writeFileSync(join(root, 'main-extra.txt'), 'main\n');
  git(root, ['add', 'main-extra.txt']);
  git(root, ['commit', '-m', 'main extra']);

  const merged = runtime.applyMerge(root, {
    issuedBy: 'human:owner',
    ref: 'other',
    args: ['-m', 'merge other', '--no-ff'],
  }, { run });
  assert.equal(merged.ok, true, merged.stderr);
  assert.equal(merged.executed, true);
  const parents = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).stdout.trim().split(' ');
  assert.ok(parents.length >= 3, 'merge commit should have two parents');
  assert.equal(calls.some((argv) => argv.includes('push')), false);
});

test('auto / watchdog issuers cannot merge; auto-merge throws; push is never invoked', (t) => {
  const root = initRepo(t);
  const calls = [];
  const run = spyRun(calls);
  git(root, ['checkout', '-b', 'topic']);
  writeFileSync(join(root, 'topic.txt'), 'x\n');
  git(root, ['add', 'topic.txt']);
  git(root, ['commit', '-m', 'topic']);
  git(root, ['checkout', 'main']);
  const before = head(root);

  for (const issuer of ['watchdog', 'observe', 'auto', 'plugin', 'watchdog:tick', 'auto:low']) {
    assert.throws(
      () => runtime.applyMerge(root, { decidedBy: issuer, ref: 'topic' }, { run }),
      (err) => err.code === runtime.HUMAN_ISSUER_REQUIRED,
    );
  }
  assert.throws(
    () => runtime.applyMerge(root, { decidedBy: 'human:owner', action: 'auto-merge', ref: 'topic' }, { run }),
    (err) => err.code === 'AUTO_MERGE_DISABLED',
  );
  assert.throws(
    () => runtime.applyMerge(root, { decidedBy: 'human:owner', ref: 'topic', args: ['push'] }, { run }),
    (err) => err.code === runtime.GIT_PUSH_FORBIDDEN,
  );
  assert.equal(head(root), before);
  assert.equal(calls.some((argv) => argv.includes('push')), false);
});
