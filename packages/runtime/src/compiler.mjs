/**
 * Capability Compiler: assemble a Mandate *draft* from a work item
 * by capability state (Discover / Build / Verify + Cartographer).
 *
 * This module never issues a Mandate, never marks gates as passed,
 * never starts a process, and never merges. Issuance stays with
 * constitution `issueMandate` and still requires a human for R2/R3
 * / human-approval. The compiler does not call a network.
 *
 * `roles/*.md` are fallback templates only. There is no 8th writable
 * role; Cartographer is a capability, not a new charter file.
 *
 * Owner → capability (Goal §2 / §4.1 / §9 P3):
 *   pm, architect                     → Discover
 *   backend-dev, frontend-dev         → Build
 *   qa-engineer, browser-tester, reviewer → Verify
 * If owners are missing, capabilities are inferred from gates, scope
 * and intent (see inferCapabilities). Unknown owner ids are ignored;
 * this compiler never invents a new role id.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROLES_DIR = join(HERE, '../../dsh-plugin/roles');

/** Vague AC patterns — same intent as constitution workitem.mjs. */
const VAGUE_AC = [/体验好/, /功能正常/];

export const KNOWN_ROLE_IDS = Object.freeze([
  'pm',
  'architect',
  'backend-dev',
  'frontend-dev',
  'qa-engineer',
  'browser-tester',
  'reviewer',
]);

export const OWNER_TO_CAPABILITY = Object.freeze({
  pm: 'Discover',
  architect: 'Discover',
  'backend-dev': 'Build',
  'frontend-dev': 'Build',
  'qa-engineer': 'Verify',
  'browser-tester': 'Verify',
  reviewer: 'Verify',
});

export const CAPABILITY_PARTS = Object.freeze({
  Discover: Object.freeze(['Scout', 'Explorer', 'Curator']),
  Build: Object.freeze(['Worker']),
  Verify: Object.freeze(['Verifier', 'Critic']),
  Cartographer: Object.freeze(['Cartographer']),
});

/** Tightened tool lists. Order is always shell, read, edit, git. */
export const TOOLS_BY_CAPABILITY = Object.freeze({
  Discover: Object.freeze(['read']),
  Build: Object.freeze(['shell', 'read', 'edit', 'git']),
  Verify: Object.freeze(['shell', 'read']),
  Cartographer: Object.freeze(['read']),
});

const TOOL_ORDER = Object.freeze(['shell', 'read', 'edit', 'git']);

const DISCOVER_GATES = new Set(['validate-plan', 'docs-ready', 'docs-gate', 'naming-guard']);
const VERIFY_GATES = new Set(['verify', 'browser-ac', 'review']);
const FRONTEND_RE = /\.(?:css|scss|less|html|htm|vue|jsx|tsx|svelte)$/i;

const DEFAULT_BUDGET = Object.freeze({ tokens: 200000, minutes: 45 });

export function isKnownRole(id) {
  return Object.prototype.hasOwnProperty.call(OWNER_TO_CAPABILITY, id);
}

/**
 * Load a 0.1.0 role charter. Unknown ids return null (no 8th role).
 * @param {string} roleId
 * @param {string} [rolesDir]
 * @returns {{ id: string, path: string, text: string }|null}
 */
export function loadRoleCharter(roleId, rolesDir = DEFAULT_ROLES_DIR) {
  if (!isKnownRole(roleId)) return null;
  const file = join(rolesDir, `${roleId}.md`);
  if (!existsSync(file)) return null;
  return {
    id: roleId,
    path: `roles/${roleId}.md`,
    text: readFileSync(file, 'utf8'),
  };
}

function unique(list) {
  const out = [];
  for (const item of list) {
    if (item != null && !out.includes(item)) out.push(item);
  }
  return out;
}

function cloneScope(scope) {
  return {
    files: [...(scope?.files ?? [])],
    newFiles: [...(scope?.newFiles ?? [])],
    owners: [...(scope?.owners ?? [])],
  };
}

function cloneAc(ac) {
  return Array.isArray(ac)
    ? ac.map((a) => ({ id: a?.id, text: a?.text, coveredBy: [...(a?.coveredBy ?? [])] }))
    : [];
}

export function isVagueAcText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return true;
  return VAGUE_AC.some((pat) => pat.test(raw));
}

/**
 * @param {object} workItem
 * @returns {string|null} reason code when the work item cannot be compiled
 */
export function compilationFailure(workItem) {
  if (!workItem) return 'missing-work-item';
  if (!String(workItem.intent ?? workItem.goal ?? '').trim()) return 'missing-intent';
  const ac = workItem.ac;
  if (!Array.isArray(ac) || ac.length === 0) return 'missing-ac';
  for (const item of ac) {
    if (isVagueAcText(item?.text)) return 'unjudgeable-ac';
  }
  const scopeIssue = unusableScopeReason(workItem.scope);
  if (scopeIssue) return scopeIssue;
  return null;
}

/**
 * A scope is unusable when any provided path is empty, absolute, or
 * climbs out of the repository root with `..`. Empty files/newFiles
 * arrays are allowed (Discover-only work).
 * @param {{ files?: string[], newFiles?: string[] }|null} scope
 * @returns {string|null}
 */
export function unusableScopeReason(scope) {
  const paths = [...(scope?.files ?? []), ...(scope?.newFiles ?? [])];
  for (const p of paths) {
    if (escapesRepo(p)) return 'unusable-scope';
  }
  return null;
}

export function escapesRepo(p) {
  const s = String(p ?? '');
  if (!s.trim()) return true;
  if (s.includes('\0')) return true;
  if (s.startsWith('/') || s.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(s)) return true;
  const norm = s.replace(/\\/g, '/');
  if (norm.split('/').includes('..')) return true;
  return false;
}

function unionTools(states) {
  const have = new Set();
  for (const state of states) {
    for (const tool of (TOOLS_BY_CAPABILITY[state] ?? [])) have.add(tool);
  }
  return TOOL_ORDER.filter((t) => have.has(t));
}

/**
 * Map known owner / role ids to capability states.
 * Unknown ids are reported but never turned into a new role.
 * @param {string[]} owners
 * @returns {{ states: string[], owners: string[], unknown: string[] }}
 */
export function mapOwnersToCapabilities(owners = []) {
  const known = [];
  const unknown = [];
  const states = [];
  for (const id of owners) {
    const cap = OWNER_TO_CAPABILITY[id];
    if (!cap) {
      unknown.push(id);
      continue;
    }
    known.push(id);
    if (!states.includes(cap)) states.push(cap);
  }
  return { states, owners: known, unknown };
}

/**
 * Infer capability states when owners are missing or none of the
 * owners are known role ids.
 *
 * Rules (in order, then always append Cartographer):
 * 1. gates include validate-plan / docs-ready / docs-gate / naming-guard → Discover
 * 2. scope.files or scope.newFiles is non-empty → Build
 * 3. gates include verify / browser-ac / review → Verify
 * 4. if nothing matched but intent is present → Discover only
 * 5. Cartographer is always assembled as a post-task capability
 *    (write-back loop is P4; this only puts it on the draft)
 * 6. never invent a new role id; inferred assemblies keep scope.owners as given
 *
 * @param {object} workItem
 * @returns {{ states: string[], owners: string[], inferred: boolean, unknown: string[], reason: string|null }}
 */
export function inferCapabilities(workItem = {}) {
  const given = mapOwnersToCapabilities(workItem.scope?.owners ?? []);
  if (given.owners.length) {
    const states = [...given.states, 'Cartographer'].filter((s, i, arr) => arr.indexOf(s) === i);
    return {
      states,
      owners: given.owners,
      inferred: false,
      unknown: given.unknown,
      reason: null,
    };
  }

  const states = [];
  const reasons = [];
  const gates = workItem.gates ?? [];
  const files = [...(workItem.scope?.files ?? []), ...(workItem.scope?.newFiles ?? [])];

  if (gates.some((g) => DISCOVER_GATES.has(g))) {
    states.push('Discover');
    reasons.push('gates include planning or docs gates');
  }
  if (files.length > 0) {
    states.push('Build');
    reasons.push('scope has files or newFiles');
  }
  if (gates.some((g) => VERIFY_GATES.has(g))) {
    states.push('Verify');
    reasons.push('gates include verify, browser-ac, or review');
  }
  if (states.length === 0 && String(workItem.intent ?? workItem.goal ?? '').trim()) {
    states.push('Discover');
    reasons.push('no owners or files; intent present so Discover-only');
  }
  if (!states.includes('Cartographer')) states.push('Cartographer');

  return {
    states,
    owners: [],
    inferred: true,
    unknown: given.unknown,
    reason: reasons.join('; ') || 'inferred-from-gates-and-scope',
  };
}

/**
 * Roles used when compilation falls back to `roles/*.md`.
 * Only known 0.1.0 ids. Never enlarges the set with a new role.
 */
export function fallbackRolesFor(workItem, assembly) {
  const owners = (workItem?.scope?.owners ?? []).filter(isKnownRole);
  if (owners.length) return unique(owners);
  const states = (assembly?.states ?? []).filter((s) => s !== 'Cartographer');
  const roles = [];
  if (states.includes('Discover')) roles.push('pm', 'architect');
  if (states.includes('Build')) {
    const files = [...(workItem?.scope?.files ?? []), ...(workItem?.scope?.newFiles ?? [])];
    const hasFront = files.some((f) => FRONTEND_RE.test(String(f)));
    const hasBack = files.some((f) => !FRONTEND_RE.test(String(f)));
    if (hasFront && !hasBack) roles.push('frontend-dev');
    else if (hasBack && !hasFront) roles.push('backend-dev');
    else if (hasFront && hasBack) roles.push('backend-dev', 'frontend-dev');
    else roles.push('backend-dev');
  }
  if (states.includes('Verify')) {
    const gates = workItem?.gates ?? [];
    if (gates.includes('verify')) roles.push('qa-engineer');
    if (gates.includes('browser-ac')) roles.push('browser-tester');
    if (gates.includes('review')) roles.push('reviewer');
    if (!roles.some((r) => OWNER_TO_CAPABILITY[r] === 'Verify')) roles.push('qa-engineer');
  }
  return unique(roles);
}

function loadCharters(roleIds, loader) {
  const load = loader ?? loadRoleCharter;
  const out = [];
  for (const id of roleIds) {
    const charter = load(id);
    if (charter) out.push(charter);
  }
  return out;
}

function buildAssembly(workItem, inferred, chartersByRole = []) {
  const byRole = new Map(chartersByRole.map((c) => [c.id, c]));
  const capabilities = inferred.states.map((state) => {
    const owners = inferred.owners.filter((id) => OWNER_TO_CAPABILITY[id] === state);
    const entry = {
      state,
      parts: [...(CAPABILITY_PARTS[state] ?? [])],
      owners,
      tools: [...(TOOLS_BY_CAPABILITY[state] ?? ['read'])],
    };
    if (state === 'Build') {
      entry.workers = (owners.length ? owners : [])
        .filter((id) => OWNER_TO_CAPABILITY[id] === 'Build')
        .map((id) => ({
          role: id,
          capability: 'Build',
          charter: byRole.get(id) ? { id, path: byRole.get(id).path } : null,
        }));
    }
    if (state === 'Discover') {
      entry.notes = 'Scout is read-only sensing; Explorer is a read-only Fact Pack; Curator returns Top-K only';
    }
    if (state === 'Verify') {
      entry.notes = 'Verifier runs in an independent context with deterministic scripts; Critic does adversarial final review';
    }
    if (state === 'Cartographer') {
      entry.notes = 'Post-task knowledge-base (Decision / Invariant) only; must not touch business code. Full write-back loop is P4 and is not executed here.';
      entry.writeBack = false;
    }
    return entry;
  });
  return {
    capabilities,
    states: [...inferred.states],
    owners: [...inferred.owners],
    inferred: inferred.inferred,
    inferenceReason: inferred.reason,
    unknownOwners: [...inferred.unknown],
    mapping: { ...OWNER_TO_CAPABILITY },
  };
}

function planNeedsOf(workItem, snapshot) {
  const ac = workItem.ac ?? [];
  const missingCover = ac.filter((a) => !(a.coveredBy && a.coveredBy.length)).map((a) => a.id);
  return {
    impact: Boolean(workItem.intent ?? workItem.goal),
    acceptanceCriteria: ac,
    missingCoveredBy: missingCover,
    scope: workItem.scope ?? { files: [], newFiles: [], owners: [] },
    gates: workItem.gates ?? [],
    snapshotId: snapshot?.id ?? workItem.constitution_snapshot ?? null,
  };
}

function draftOf(workItem, snapshot, toolsWhitelist) {
  return {
    workItem: workItem.id,
    goal: workItem.intent ?? workItem.goal ?? '',
    ac: cloneAc(workItem.ac),
    nonGoals: [...(workItem.nonGoals ?? [])],
    scope: cloneScope(workItem.scope),
    toolsWhitelist: [...toolsWhitelist],
    budget: {
      tokens: Number(workItem.budget?.tokens ?? DEFAULT_BUDGET.tokens),
      minutes: Number(workItem.budget?.minutes ?? DEFAULT_BUDGET.minutes),
    },
    evidenceRequired: [...(workItem.gates ?? [])],
    constitution_snapshot: snapshot?.id ?? workItem.constitution_snapshot ?? null,
  };
}

function maybeTouchModel(model, workItem) {
  if (model && typeof model.completeSync === 'function' && model.kind === 'rules') {
    model.completeSync('draft-intent', workItem);
  }
}

function parseCompileArgs(snapshotOrOptions, maybeOptions) {
  if (maybeOptions && typeof maybeOptions === 'object') {
    return { snapshot: snapshotOrOptions ?? maybeOptions.snapshot ?? null, options: maybeOptions };
  }
  if (!snapshotOrOptions || typeof snapshotOrOptions !== 'object') {
    return { snapshot: snapshotOrOptions ?? null, options: {} };
  }
  const looksLikeOptions = Boolean(
    snapshotOrOptions.snapshot
    || snapshotOrOptions.loadRoleCharter
    || snapshotOrOptions.roleCharterLoader
    || snapshotOrOptions.model
    || snapshotOrOptions.rolesDir,
  );
  if (looksLikeOptions && !snapshotOrOptions.id) {
    return { snapshot: snapshotOrOptions.snapshot ?? null, options: snapshotOrOptions };
  }
  // A 2nd argument with `id` is a constitution snapshot (P0 compileIntent shape).
  return { snapshot: snapshotOrOptions, options: {} };
}

/**
 * Compile a Mandate draft from a work item.
 * @param {object} workItem
 * @param {object} [snapshotOrOptions]  snapshot, or options bag
 * @param {object} [maybeOptions]
 * @returns {{
 *   planNeeds: object,
 *   mandateDraft: object,
 *   via: 'compiler'|'fallback',
 *   reason: string|null,
 *   assembly: object,
 *   fallbackRoles: string[],
 *   charters: object[],
 *   issued: false
 * }}
 */
export function compileMandate(workItem, snapshotOrOptions, maybeOptions) {
  if (!workItem) throw new Error('compileIntent requires a work item');

  const parsed = parseCompileArgs(snapshotOrOptions, maybeOptions);
  const snapshot = parsed.snapshot;
  const options = parsed.options;

  const loader = options.loadRoleCharter
    ?? options.roleCharterLoader
    ?? ((id) => loadRoleCharter(id, options.rolesDir ?? DEFAULT_ROLES_DIR));

  const failure = compilationFailure(workItem);
  const inferred = inferCapabilities(workItem);
  const planNeeds = planNeedsOf(workItem, snapshot);

  if (failure) {
    const roles = fallbackRolesFor(workItem, inferred);
    const charters = loadCharters(roles, loader);
    // Fallback must not grant extra tools or enlarge scope. Tools are
    // tightened to the inferred capabilities (or read-only if none).
    const fallbackStates = inferred.states.length ? inferred.states : ['Discover', 'Cartographer'];
    const tools = unionTools(fallbackStates);
    const assembly = buildAssembly(workItem, { ...inferred, states: fallbackStates }, charters);
    const mandateDraft = draftOf(workItem, snapshot, tools);
    maybeTouchModel(options.model, workItem);
    return {
      planNeeds,
      mandateDraft,
      via: 'fallback',
      reason: failure,
      assembly,
      fallbackRoles: roles,
      charters,
      issued: false,
    };
  }

  const ownerRoles = inferred.owners.filter(isKnownRole);
  const charters = loadCharters(ownerRoles, loader);
  const assembly = buildAssembly(workItem, inferred, charters);
  const tools = unionTools(inferred.states);
  const mandateDraft = draftOf(workItem, snapshot, tools);
  maybeTouchModel(options.model, workItem);
  return {
    planNeeds,
    mandateDraft,
    via: 'compiler',
    reason: null,
    assembly,
    fallbackRoles: [],
    charters,
    issued: false,
  };
}

export { compileMandate as compile };
