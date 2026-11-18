/**
 * P5 closed-loop orchestration.
 *
 * Console 「待你决定」 approve / reject, per-work-item execute authority,
 * work-item dispatch via `routeModel`, and merge-intent recording.
 * Side effects live here so `packages/dsh-plugin/lib/console-model.mjs`
 * stays a pure view helper with no constitution / runtime imports.
 *
 * This module never auto-merges, never starts a process, never touches
 * the network, and never runs git. Default authority remains observe.
 * `write: true` is required to persist; otherwise results stay dry-run.
 */
import {
  activeMandateFor,
  assertUsableMandate,
  checkSnapshot,
  createSnapshot,
  evalPolicy,
  formatIso,
  getMandate,
  getWorkItem,
  isExpired,
  isLegalTransition,
  issueMandate,
  listReceipts,
  PARK_FROM,
  revokeMandate,
  saveDocument,
  TERMINAL,
  transitionWorkItem,
} from '../../constitution/src/index.mjs';
import * as bus from './bus.mjs';
import { compileMandate } from './compiler.mjs';
import { create as createAssignment } from './assignment.mjs';
import {
  assertNoAutoMerge,
  DEFAULT_AUTHORITY,
  resolveAuthority,
} from './observe.mjs';
import { routeModel } from './routing.mjs';
import { inferCapabilities } from './compiler.mjs';

export const DEFAULT_MANDATE_TTL_MS = 24 * 60 * 60 * 1000;

const NON_HUMAN_ISSUERS = Object.freeze([
  'watchdog', 'observe', 'auto', 'auto-merge', 'automerge',
  'system', 'runtime', 'plugin', 'steward', 'compiler', 'machine', 'bot',
]);

const NON_HUMAN_PREFIXES = Object.freeze([
  'watchdog:', 'observe:', 'auto:', 'system:', 'runtime:', 'plugin:', 'steward:',
]);

export const EXECUTE_NOT_GRANTED = 'EXECUTE_NOT_GRANTED';
export const HUMAN_ISSUER_REQUIRED = 'HUMAN_ISSUER_REQUIRED';
export const HUMAN_APPROVAL_REQUIRED = 'HUMAN_APPROVAL_REQUIRED';

function coded(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * A usable human issuer is a non-empty id or display name.
 * Reserved machine tokens (watchdog / observe / auto / …) are refused.
 */
export function isHumanIssuer(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (NON_HUMAN_ISSUERS.includes(lower)) return false;
  if (NON_HUMAN_PREFIXES.some((p) => lower.startsWith(p))) return false;
  return true;
}

function assertHumanIssuer(input = {}) {
  const issuedBy = String(input.issuedBy ?? input.approvedBy ?? input.decidedBy ?? '').trim();
  if (!issuedBy) {
    throw coded(HUMAN_ISSUER_REQUIRED, 'approveDecision requires issuedBy (a human id or name)');
  }
  if (!isHumanIssuer(issuedBy)) {
    throw coded(HUMAN_ISSUER_REQUIRED, `issuedBy must be a human id or name, not ${issuedBy}`);
  }
  return issuedBy;
}

/**
 * Watchdog / observe / auto (and explicit machine sources) must not issue.
 * The approve API itself is the human action.
 */
export function assertHumanApprovalPath(input = {}) {
  const source = String(input.source ?? input.issuerSource ?? '').trim().toLowerCase();
  if (source && (NON_HUMAN_ISSUERS.includes(source) || NON_HUMAN_PREFIXES.some((p) => source.startsWith(p)))) {
    throw coded(HUMAN_APPROVAL_REQUIRED, 'watchdog/observe/auto must not issue a Mandate');
  }
  const authority = input.authority ?? input.requestedAuthority ?? null;
  if (authority === 'observe' || authority === 'auto' || authority === 'watchdog') {
    throw coded(HUMAN_APPROVAL_REQUIRED, 'watchdog/observe/auto must not issue a Mandate');
  }
  if (authority === 'auto-merge' || authority === 'autoMerge') {
    assertNoAutoMerge(authority);
  }
}

function requireWorkItem(root, input) {
  const id = input.workItem?.id ?? input.workItem ?? input.workItemId ?? input.id;
  if (!id) throw coded('WORKITEM', 'work item id is required');
  if (input.workItem && typeof input.workItem === 'object' && input.workItem.id && !root) {
    return input.workItem;
  }
  const item = getWorkItem(root, id);
  if (!item) throw coded('WORKITEM', `work item not found: ${id}`);
  return item;
}

function uniqueSubset(requested, allowed) {
  const allow = new Set(allowed ?? []);
  const src = requested == null ? [...allow] : [...requested];
  const out = [];
  for (const item of src) {
    if (allow.has(item) && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Never enlarge tools, scope, or budget past the compiler draft.
 * AC / nonGoals / goal may be edited by the human.
 */
export function clampToDraft(overrides, draft) {
  const toolsWhitelist = uniqueSubset(
    overrides?.toolsWhitelist ?? overrides?.tools,
    draft.toolsWhitelist ?? [],
  );
  const draftScope = draft.scope ?? { files: [], newFiles: [], owners: [] };
  const reqScope = overrides?.scope ?? {};
  const scope = {
    files: uniqueSubset(reqScope.files ?? draftScope.files, draftScope.files),
    newFiles: uniqueSubset(reqScope.newFiles ?? draftScope.newFiles, draftScope.newFiles),
    owners: uniqueSubset(reqScope.owners ?? draftScope.owners, draftScope.owners),
  };
  const draftBudget = draft.budget ?? { tokens: 0, minutes: 0 };
  const reqBudget = overrides?.budget ?? {};
  const budget = {
    tokens: Math.min(
      Number(reqBudget.tokens ?? draftBudget.tokens ?? 0),
      Number(draftBudget.tokens ?? 0),
    ),
    minutes: Math.min(
      Number(reqBudget.minutes ?? draftBudget.minutes ?? 0),
      Number(draftBudget.minutes ?? 0),
    ),
  };
  const ac = Array.isArray(overrides?.ac) ? overrides.ac : draft.ac;
  const nonGoals = Array.isArray(overrides?.nonGoals) ? [...overrides.nonGoals] : [...(draft.nonGoals ?? [])];
  const goal = overrides?.goal != null ? String(overrides.goal) : draft.goal;
  const evidenceRequired = uniqueSubset(
    overrides?.evidenceRequired,
    draft.evidenceRequired ?? [],
  );
  const requestedTools = overrides?.toolsWhitelist ?? overrides?.tools;
  const requestedBudget = overrides?.budget;
  const requestedScope = overrides?.scope;
  const droppedTools = Array.isArray(requestedTools)
    && requestedTools.some((t) => !toolsWhitelist.includes(t));
  const droppedScope = Boolean(requestedScope) && (
    (requestedScope.files ?? []).some((f) => !scope.files.includes(f))
    || (requestedScope.newFiles ?? []).some((f) => !scope.newFiles.includes(f))
    || (requestedScope.owners ?? []).some((o) => !scope.owners.includes(o))
  );
  const reducedBudget = Boolean(requestedBudget) && (
    (requestedBudget.tokens != null && Number(requestedBudget.tokens) > budget.tokens)
    || (requestedBudget.minutes != null && Number(requestedBudget.minutes) > budget.minutes)
  );
  const droppedEvidence = Array.isArray(overrides?.evidenceRequired)
    && overrides.evidenceRequired.some((g) => !evidenceRequired.includes(g));
  const clamped = droppedTools || droppedScope || reducedBudget || droppedEvidence;
  return {
    goal,
    ac: Array.isArray(ac)
      ? ac.map((a) => ({ id: a.id, text: a.text, coveredBy: [...(a.coveredBy ?? [])] }))
      : [],
    nonGoals,
    scope,
    toolsWhitelist,
    budget,
    evidenceRequired,
    clamped,
  };
}

function defaultExpiresAt(now, override) {
  if (override) return override;
  return formatIso(new Date(now.getTime() + DEFAULT_MANDATE_TTL_MS));
}

function persistEvent(root, write, event) {
  if (!root || write === false) {
    return { ...event, id: null, persisted: false };
  }
  return { ...bus.append({ root, ...event }), persisted: true };
}

function ensureSnapshot(root, item, { write, snapshot }) {
  if (snapshot?.id) return snapshot;
  const id = item.constitution_snapshot ?? snapshot;
  if (id && typeof id === 'string') return { id };
  return createSnapshot(root, { write }).document;
}

/**
 * Approve a left-console decision: compile the Mandate draft and call
 * constitution `issueMandate`. R2/R3, `human-approval`, and Policy
 * `requireHuman` must go through this human path.
 *
 * @param {string} root
 * @param {{
 *   workItem?: object|string,
 *   workItemId?: string,
 *   issuedBy?: string,
 *   approvedBy?: string,
 *   expiresAt?: string,
 *   snapshot?: object,
 *   toolsWhitelist?: string[],
 *   scope?: object,
 *   budget?: object,
 *   ac?: object[],
 *   nonGoals?: string[],
 *   goal?: string,
 *   source?: string,
 *   authority?: string,
 * }} input
 * @param {{ write?: boolean, now?: Date }} [options]
 */
export function approveDecision(root, input = {}, options = {}) {
  const write = Boolean(options.write);
  const now = options.now ?? new Date();
  assertNoAutoMerge(input.action === 'auto-merge' || input.action === 'autoMerge' ? 'auto-merge' : input.guardAction);
  assertHumanApprovalPath(input);
  const issuedBy = assertHumanIssuer(input);
  if (!root) throw coded('LOOP', 'approveDecision requires a repository root');

  const current = requireWorkItem(root, input);
  const policy = evalPolicy(root, current);
  const needsHuman = policy.requireHuman
    || current.authority === 'human-approval'
    || current.risk === 'R2'
    || current.risk === 'R3';
  if (needsHuman) {
    // Already on the human approve path (issuedBy checked above).
  }

  const snapshot = ensureSnapshot(root, current, { write, snapshot: input.snapshot });
  const compilation = compileMandate(current, snapshot, input.compileOptions ?? {});
  const draft = compilation.mandateDraft;
  const clamped = clampToDraft(input, draft);

  const issued = issueMandate(root, {
    workItem: current.id,
    issuedBy,
    issuedAt: input.issuedAt,
    expiresAt: defaultExpiresAt(now, input.expiresAt),
    constitution_snapshot: draft.constitution_snapshot ?? snapshot.id,
    goal: clamped.goal,
    ac: clamped.ac,
    nonGoals: clamped.nonGoals,
    scope: clamped.scope,
    toolsWhitelist: clamped.toolsWhitelist,
    budget: clamped.budget,
    evidenceRequired: clamped.evidenceRequired,
  }, { write, now }).document;

  let item = current;
  if (item.state === 'Proposed' && isLegalTransition('Proposed', 'AwaitingApproval')) {
    item = transitionWorkItem(root, item.id, 'AwaitingApproval', {
      write,
      approvedBy: issuedBy,
      mandate: issued.id,
      now,
    }).document;
  }
  if (item.state === 'AwaitingApproval' && isLegalTransition('AwaitingApproval', 'Authorized')) {
    item = transitionWorkItem(root, item.id, 'Authorized', {
      write,
      approvedBy: issuedBy,
      mandate: issued.id,
      now,
    }).document;
  }

  const bound = { ...item, mandate: issued.id, authority: item.authority ?? current.authority };
  if (bound.mandate !== item.mandate || bound.authority !== item.authority) {
    bound.updatedAt = formatIso(now);
    const saved = saveDocument(root, 'workitem', bound, { write });
    item = saved.document ?? saved;
  }

  const event = persistEvent(root, write, {
    type: bus.EVENT_TYPES.DECISION_APPROVED ?? 'decision.approved',
    source: 'loop',
    workItem: current.id,
    payload: {
      action: 'approve',
      issuedBy,
      mandate: issued.id,
      via: compilation.via,
      clamped: clamped.clamped,
    },
  });

  return {
    issued: true,
    rejected: false,
    mandate: issued,
    workItem: item,
    compilation,
    draft,
    clamped: clamped.clamped,
    issuedBy,
    event,
    autoMerge: false,
  };
}

/**
 * Reject a left-console decision: record the rejection, do not issue
 * a Mandate, and Park when the current state may legally enter Parked.
 */
export function rejectDecision(root, input = {}, options = {}) {
  const write = Boolean(options.write);
  const now = options.now ?? new Date();
  if (input.action === 'auto-merge' || input.action === 'autoMerge') {
    assertNoAutoMerge('auto-merge');
  }
  const decidedBy = String(input.issuedBy ?? input.approvedBy ?? input.decidedBy ?? input.rejectedBy ?? '').trim();
  if (!root) throw coded('LOOP', 'rejectDecision requires a repository root');

  const current = requireWorkItem(root, input);
  const active = activeMandateFor(root, current.id);
  // Rejection never issues. If a mandate is already active, a human
  // stop may revoke it, but this path will not create a new one.
  let mandate = null;
  if (active && input.revoke !== false && isHumanIssuer(decidedBy || 'human:owner') === false) {
    // decidedBy missing is allowed for reject (we still record); do not issue.
  }
  if (active && input.revoke !== false) {
    mandate = revokeMandate(root, active.id, 'human-stop', { write, now }).document;
  }

  let item = current;
  if (PARK_FROM.includes(item.state) && isLegalTransition(item.state, 'Parked')) {
    item = transitionWorkItem(root, item.id, 'Parked', {
      write,
      approvedBy: decidedBy || undefined,
      now,
    }).document;
  }

  const event = persistEvent(root, write, {
    type: bus.EVENT_TYPES.DECISION_REJECTED ?? 'decision.rejected',
    source: 'loop',
    workItem: current.id,
    payload: {
      action: 'reject',
      decidedBy: decidedBy || null,
      reason: input.reason ?? '',
      issued: false,
      mandate: mandate?.id ?? null,
    },
  });

  return {
    issued: false,
    rejected: true,
    mandate: null,
    revoked: mandate,
    workItem: item,
    event,
    autoMerge: false,
  };
}

/**
 * Is `attempted` inside an issued Mandate's tools / file scope?
 * An empty attempted set is considered in-scope.
 */
export function isWithinMandateScope(mandate, attempted = {}) {
  if (!mandate) return false;
  const allowedFiles = new Set([
    ...(mandate.scope?.files ?? []),
    ...(mandate.scope?.newFiles ?? []),
  ]);
  const wantFiles = [...(attempted.files ?? []), ...(attempted.newFiles ?? []), ...(attempted.paths ?? [])];
  for (const file of wantFiles) {
    if (!allowedFiles.has(file)) return false;
  }
  const tools = attempted.tools ?? attempted.toolsWhitelist ?? null;
  if (Array.isArray(tools)) {
    const allow = new Set(mandate.toolsWhitelist ?? []);
    for (const tool of tools) {
      if (!allow.has(tool)) return false;
    }
  }
  return true;
}

/**
 * A work item may enter execute only after a human-issued, active,
 * unexpired, unrevoked Mandate exists for it, and only within that
 * Mandate's scope. Global DEFAULT_AUTHORITY stays observe; this is a
 * per-work-item grant, not a default flip for assign / consider / watchdog.
 *
 * @returns {{
 *   allowed: boolean,
 *   authority: 'execute'|'observe',
 *   reason: string,
 *   mandate: object|null,
 *   code?: string
 * }}
 */
export function canExecute(root, workItemOrId, options = {}) {
  const now = options.now ?? new Date();
  const id = typeof workItemOrId === 'string'
    ? workItemOrId
    : (workItemOrId?.id ?? options.workItem ?? options.workItemId);
  if (!id) {
    return {
      allowed: false,
      authority: DEFAULT_AUTHORITY,
      reason: 'missing-work-item',
      mandate: null,
      code: EXECUTE_NOT_GRANTED,
    };
  }
  let mandate = null;
  try {
    mandate = root ? activeMandateFor(root, id) : (options.mandate ?? null);
  } catch (err) {
    return {
      allowed: false,
      authority: DEFAULT_AUTHORITY,
      reason: err.message,
      mandate: null,
      code: err.code ?? EXECUTE_NOT_GRANTED,
    };
  }
  if (!mandate) {
    return {
      allowed: false,
      authority: DEFAULT_AUTHORITY,
      reason: 'no-active-mandate',
      mandate: null,
      code: EXECUTE_NOT_GRANTED,
    };
  }
  if (mandate.revokedAt) {
    return {
      allowed: false,
      authority: DEFAULT_AUTHORITY,
      reason: `mandate ${mandate.id} is revoked`,
      mandate,
      code: EXECUTE_NOT_GRANTED,
    };
  }
  if (isExpired(mandate.expiresAt, now)) {
    return {
      allowed: false,
      authority: DEFAULT_AUTHORITY,
      reason: `mandate ${mandate.id} expired at ${mandate.expiresAt}`,
      mandate,
      code: 'MANDATE_EXPIRED',
    };
  }
  if (!isHumanIssuer(mandate.issuedBy)) {
    return {
      allowed: false,
      authority: DEFAULT_AUTHORITY,
      reason: 'mandate was not issued by a human',
      mandate,
      code: EXECUTE_NOT_GRANTED,
    };
  }
  if (options.attempted && !isWithinMandateScope(mandate, options.attempted)) {
    return {
      allowed: false,
      authority: DEFAULT_AUTHORITY,
      reason: 'attempted tools or paths exceed mandate scope',
      mandate,
      code: EXECUTE_NOT_GRANTED,
    };
  }
  try {
    if (root) assertUsableMandate(root, id, now);
  } catch (err) {
    return {
      allowed: false,
      authority: DEFAULT_AUTHORITY,
      reason: err.message,
      mandate,
      code: err.code ?? EXECUTE_NOT_GRANTED,
    };
  }
  return {
    allowed: true,
    authority: 'execute',
    reason: 'human-mandate-active',
    mandate,
  };
}

export function assertCanExecute(root, workItemOrId, options = {}) {
  const result = canExecute(root, workItemOrId, options);
  if (!result.allowed) {
    throw coded(result.code ?? EXECUTE_NOT_GRANTED, result.reason);
  }
  return result;
}

/**
 * Work-item / capability-state dispatch: calls `routeModel` and returns
 * the route plus the assignment isolation structure from
 * `assignment.create`. Does not start a process or touch the network.
 *
 * 0.1.0 `superbot_dispatch` (including the docTier=3 hard gate) is
 * unchanged and stays the compatibility path.
 */
export function dispatchWorkItem(root, input = {}) {
  const item = input.workItem && typeof input.workItem === 'object' && input.workItem.id
    ? input.workItem
    : requireWorkItem(root, input);
  const inferred = inferCapabilities(item);
  const capability = input.capability
    ?? inferred.states.find((s) => s !== 'Cartographer')
    ?? inferred.states[0]
    ?? 'Discover';
  const role = input.role ?? inferred.owners[0] ?? null;
  const risk = input.risk ?? item.risk ?? null;
  const route = routeModel({
    capability,
    risk,
    role,
    config: input.config ?? {},
    routes: input.routes,
  });
  const mandate = input.mandate
    ?? (root ? activeMandateFor(root, item.id) : null);
  const assignment = createAssignment({
    workItem: item,
    mandate,
    runId: input.runId,
    root: root ?? undefined,
  });
  return {
    route,
    assignment,
    isolation: assignment.isolation,
    workItem: item.id,
    capability,
    states: inferred.states,
    role,
    risk,
    started: false,
    network: false,
    process: null,
  };
}

function normalizeMergeAction(input = {}) {
  const raw = input.action ?? input.intent ?? input.decision ?? 'merge';
  const name = String(raw).trim();
  const lower = name.toLowerCase();
  if (lower === 'auto-merge' || lower === 'automerge' || input.autoMerge === true) {
    return 'auto-merge';
  }
  if (name === '打回' || lower === 'reject' || lower === 'reject-merge' || lower === 'bounce') {
    return 'reject';
  }
  if (lower === 'merge' || name === '合并') {
    return 'merge';
  }
  return name || 'merge';
}

/**
 * Record a human merge / 打回 intent. Never runs `git merge`, `git push`,
 * or any other git write. Auto-merge still throws AUTO_MERGE_DISABLED.
 */
export function recordMergeIntent(root, input = {}, options = {}) {
  const action = normalizeMergeAction(input);
  if (action === 'auto-merge' || action === 'autoMerge') {
    assertNoAutoMerge('auto-merge');
  }
  // Do not call assertNoAutoMerge('merge'): that token stays forbidden
  // as an *automatic* action, but a human merge intent may be recorded.
  const write = options.write !== false;
  const now = options.now ?? new Date();
  const workItem = input.workItem?.id ?? input.workItem ?? input.workItemId ?? input.id ?? null;
  const record = {
    action,
    workItem,
    decidedBy: input.decidedBy ?? input.issuedBy ?? input.approvedBy ?? null,
    reason: input.reason ?? '',
    executed: false,
    git: false,
    would: { merge: false, execute: false },
    at: formatIso(now),
  };
  const event = persistEvent(root, write && Boolean(root), {
    type: bus.EVENT_TYPES.MERGE_INTENT ?? 'merge.intent',
    source: 'loop',
    workItem,
    payload: record,
  });
  return {
    ...record,
    event,
    persisted: Boolean(event.persisted),
  };
}

/** Receipts + artifact paths for a checkable Delivered / Failed result card. */
export function loadResultEvidence(root, workItemOrId) {
  const item = typeof workItemOrId === 'object' && workItemOrId?.id
    ? workItemOrId
    : getWorkItem(root, workItemOrId);
  const receipts = root && item ? listReceipts(root, item.id) : [];
  const artifacts = receipts.flatMap((r) => r.artifacts ?? []);
  return { workItem: item, receipts, artifacts };
}

export { DEFAULT_AUTHORITY, resolveAuthority, assertNoAutoMerge };
