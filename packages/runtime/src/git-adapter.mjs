/**
 * Real git adapter: inspect / adapt a repository root by shelling out to
 * `git`. Allowed read operations are `status`, `diff`, `log`, `rev-parse`,
 * and `branch` (read-only). A human-only `applyMerge` may run `git merge`.
 *
 * Never runs `git push`. Never auto-merges. `recordMergeIntent` stays in
 * `loop.mjs` and must not call this module — recording intent does not
 * mutate git. Machine issuers (watchdog / observe / auto / plugin / …)
 * cannot merge. Missing `.git` fails safely without throwing raw git noise.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HUMAN_ISSUER_REQUIRED, isHumanIssuer } from './loop.mjs';
import { assertNoAutoMerge } from './observe.mjs';

export const GIT_NOT_A_REPO = 'GIT_NOT_A_REPO';
export const GIT_PUSH_FORBIDDEN = 'GIT_PUSH_FORBIDDEN';
export const GIT_COMMAND_REFUSED = 'GIT_COMMAND_REFUSED';
export const GIT_MERGE_REF = 'GIT_MERGE_REF';

const READ_VERBS = new Set(['status', 'diff', 'log', 'rev-parse', 'branch']);
const BRANCH_MUTATING = /^(?:-d|-D|-m|-M|-c|-C|--delete|--move|--copy|--force|-f|--set-upstream|--set-upstream-to|--unset-upstream|--track|-u|--edit-description)$/;

const TAKES_VALUE = new Set(['-C', '-c']);

function coded(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * First non-option token, skipping flags that take a value (`-C`, `-c`).
 * @param {string[]} args
 * @returns {string|null}
 */
export function gitVerb(args) {
  const list = Array.isArray(args) ? [...args] : [];
  while (list.length) {
    const token = list.shift();
    if (token === '--') return list[0] ?? null;
    if (TAKES_VALUE.has(token)) {
      list.shift();
      continue;
    }
    if (typeof token === 'string' && token.startsWith('-c') && token.includes('=')) {
      continue;
    }
    if (typeof token === 'string' && token.startsWith('-')) continue;
    return token ?? null;
  }
  return null;
}

export function argvIncludesPush(args) {
  if (gitVerb(args) === 'push') return true;
  return Array.isArray(args) && args.some((token) => token === 'push');
}

export function isGitRepo(root) {
  if (!root) return false;
  try {
    return existsSync(join(root, '.git'));
  } catch {
    return false;
  }
}

function defaultRun(root, args, options = {}) {
  if (argvIncludesPush(args)) {
    throw coded(GIT_PUSH_FORBIDDEN, 'git push is forbidden');
  }
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 15_000,
  });
}

function notARepoResult(args) {
  return {
    ok: false,
    code: GIT_NOT_A_REPO,
    executed: false,
    git: false,
    stdout: '',
    stderr: 'not a git repository',
    status: 1,
    args,
  };
}

/**
 * Run `git <args>` in `root`. Inject `options.run(root, args, options)` in
 * tests to spy argv. Push is refused before the runner is called.
 */
export function runGit(root, args = [], options = {}) {
  const argv = Array.isArray(args) ? [...args] : [];
  if (argvIncludesPush(argv)) {
    throw coded(GIT_PUSH_FORBIDDEN, 'git push is forbidden');
  }
  if (!isGitRepo(root)) {
    return notARepoResult(argv);
  }
  const run = options.run ?? defaultRun;
  const result = run(root, argv, options) ?? {};
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    executed: true,
    git: true,
    args: argv,
    error: result.error ?? null,
    code: result.status === 0 ? null : (result.code ?? 'GIT_FAILED'),
  };
}

/**
 * Allowed inspect operations. `branch` rejects mutating flags.
 */
export function inspect(root, verb, extra = [], options = {}) {
  if (!READ_VERBS.has(verb)) {
    throw coded(GIT_COMMAND_REFUSED, `git ${verb} is not an allowed inspect operation`);
  }
  const rest = Array.isArray(extra) ? extra : [];
  if (verb === 'branch') {
    for (const flag of rest) {
      const token = String(flag);
      if (BRANCH_MUTATING.test(token) || token.startsWith('--set-upstream-to=') || token.startsWith('--track=')) {
        throw coded(GIT_COMMAND_REFUSED, `git branch ${token} is not a read operation`);
      }
    }
  }
  return runGit(root, [verb, ...rest], options);
}

export function status(root, extra = [], options = {}) {
  return inspect(root, 'status', extra, options);
}

export function diff(root, extra = [], options = {}) {
  return inspect(root, 'diff', extra, options);
}

export function log(root, extra = [], options = {}) {
  return inspect(root, 'log', extra, options);
}

export function revParse(root, extra = [], options = {}) {
  return inspect(root, 'rev-parse', extra, options);
}

export function branch(root, extra = [], options = {}) {
  return inspect(root, 'branch', extra, options);
}

/**
 * Human-only merge. Runs `git merge <ref>` only when `issuedBy` /
 * `decidedBy` is a human. Does not add `--ff-only` on its own; a
 * fast-forward may still result from a normal merge. Never pushes.
 * Auto-merge throws `AUTO_MERGE_DISABLED`.
 *
 * @param {string} root
 * @param {{
 *   issuedBy?: string,
 *   decidedBy?: string,
 *   approvedBy?: string,
 *   ref?: string,
 *   branch?: string,
 *   commit?: string,
 *   rev?: string,
 *   args?: string[],
 *   action?: string,
 *   autoMerge?: boolean,
 * }} input
 * @param {{ run?: Function, timeout?: number, env?: object }} [options]
 */
export function applyMerge(root, input = {}, options = {}) {
  if (input.action === 'auto-merge' || input.action === 'autoMerge' || input.autoMerge === true) {
    assertNoAutoMerge('auto-merge');
  }
  const issuedBy = input.issuedBy ?? input.decidedBy ?? input.approvedBy;
  if (!isHumanIssuer(issuedBy)) {
    throw coded(
      HUMAN_ISSUER_REQUIRED,
      `applyMerge requires a human issuedBy / decidedBy, not ${issuedBy || '(empty)'}`,
    );
  }
  const ref = input.ref ?? input.branch ?? input.commit ?? input.rev;
  if (!ref) {
    throw coded(GIT_MERGE_REF, 'applyMerge requires ref / branch / commit');
  }
  const extra = Array.isArray(input.args) ? input.args : [];
  const args = ['merge', String(ref), ...extra];
  if (argvIncludesPush(args)) {
    throw coded(GIT_PUSH_FORBIDDEN, 'git push is forbidden');
  }
  const result = runGit(root, args, options);
  return {
    ...result,
    action: 'merge',
    issuedBy,
    ref: String(ref),
    attempted: result.executed === true,
  };
}

export { defaultRun as defaultGitRunner };
