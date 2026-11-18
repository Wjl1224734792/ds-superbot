/**
 * Limited auto-low live path.
 *
 * When `evalPolicy` matches `auto-low` (and only then), the runtime may
 * call `dispatchWorkItem` without `approveDecision` and without issuing a
 * Mandate. Machine tokens (watchdog / observe / auto / plugin) are not
 * issuers. Global DEFAULT_AUTHORITY stays observe. Watchdog for these
 * items stays observe (would-accept only) until a later human approve
 * issues a Mandate and arms execute. Never auto-merges, never runs git,
 * never starts a process or opens a network.
 *
 * R2 / R3, sensitive touches, `human-approval`, and `requireHuman` must
 * still wait for the human console path.
 */
import { evalPolicy, getWorkItem } from '../../constitution/src/index.mjs';
import {
  DEFAULT_AUTHORITY,
  dispatchWorkItem,
} from './loop.mjs';
import { assertNoAutoMerge } from './observe.mjs';

export const AUTO_LOW_RULE = 'auto-low';

function resolveItem(root, workItemOrId, input = {}) {
  if (workItemOrId && typeof workItemOrId === 'object' && workItemOrId.id) {
    return workItemOrId;
  }
  const id = typeof workItemOrId === 'string'
    ? workItemOrId
    : (input.workItem?.id ?? input.workItem ?? input.workItemId ?? input.id);
  if (!id) return null;
  if (root) return getWorkItem(root, id);
  return typeof workItemOrId === 'object' ? workItemOrId : null;
}

/**
 * @returns {{
 *   allowed: boolean,
 *   reason: string,
 *   ruleId: string|null,
 *   requireHuman: boolean,
 *   item: object|null,
 *   policy: object|null,
 * }}
 */
export function canApplyAutoLow(root, workItemOrId, input = {}) {
  if (input.action === 'auto-merge' || input.action === 'autoMerge' || input.autoMerge === true) {
    assertNoAutoMerge('auto-merge');
  }
  const item = resolveItem(root, workItemOrId, input);
  if (!item) {
    return {
      allowed: false,
      reason: 'missing-work-item',
      ruleId: null,
      requireHuman: true,
      item: null,
      policy: null,
    };
  }
  if (item.risk === 'R2' || item.risk === 'R3') {
    return {
      allowed: false,
      reason: 'risk-human-gated',
      ruleId: null,
      requireHuman: true,
      item,
      policy: null,
    };
  }
  if (item.authority === 'human-approval') {
    return {
      allowed: false,
      reason: 'human-approval',
      ruleId: null,
      requireHuman: true,
      item,
      policy: null,
    };
  }

  let policy = null;
  try {
    policy = root ? evalPolicy(root, item) : input.policy ?? null;
  } catch (error) {
    return {
      allowed: false,
      reason: error.message ?? 'policy-error',
      ruleId: null,
      requireHuman: true,
      item,
      policy: null,
    };
  }
  if (!policy) {
    return {
      allowed: false,
      reason: 'policy-unavailable',
      ruleId: null,
      requireHuman: true,
      item,
      policy: null,
    };
  }
  const ruleId = policy.id ?? policy.rule?.id ?? null;
  if (policy.requireHuman === true) {
    return {
      allowed: false,
      reason: 'require-human',
      ruleId,
      requireHuman: true,
      item,
      policy,
    };
  }
  if (ruleId !== AUTO_LOW_RULE) {
    return {
      allowed: false,
      reason: 'not-auto-low',
      ruleId,
      requireHuman: Boolean(policy.requireHuman),
      item,
      policy,
    };
  }
  return {
    allowed: true,
    reason: AUTO_LOW_RULE,
    ruleId: AUTO_LOW_RULE,
    requireHuman: false,
    item,
    policy,
  };
}

/**
 * Dispatch an auto-low work item without issuing a Mandate.
 * Does not start a process or touch the network; the plugin adapter may
 * start a DSH sub-session when a parent / subagents context exists.
 */
export function dispatchAutoLow(root, input = {}) {
  if (input.action === 'auto-merge' || input.autoMerge === true) {
    assertNoAutoMerge('auto-merge');
  }
  const check = canApplyAutoLow(root, input.workItem ?? input.workItemId ?? input, input);
  if (!check.allowed) {
    return {
      applied: false,
      issued: false,
      mandate: null,
      dispatched: false,
      started: false,
      network: false,
      autoMerge: false,
      authority: DEFAULT_AUTHORITY,
      reason: check.reason,
      ruleId: check.ruleId,
      requireHuman: check.requireHuman,
      workItem: check.item?.id ?? null,
      dispatch: null,
    };
  }
  const dispatched = dispatchWorkItem(root, {
    workItem: check.item,
    workItemId: check.item.id,
    mandate: null,
    config: input.config ?? {},
    routes: input.routes,
    runId: input.runId,
    capability: input.capability,
    role: input.role,
    risk: input.risk ?? check.item.risk,
  });
  return {
    applied: true,
    issued: false,
    mandate: null,
    dispatched: true,
    started: false,
    network: false,
    process: null,
    autoMerge: false,
    authority: DEFAULT_AUTHORITY,
    reason: AUTO_LOW_RULE,
    ruleId: AUTO_LOW_RULE,
    requireHuman: false,
    workItem: check.item.id,
    item: check.item,
    policy: check.policy,
    dispatch: dispatched,
    route: dispatched.route,
    assignment: dispatched.assignment,
    isolation: dispatched.isolation,
  };
}

export { DEFAULT_AUTHORITY };
