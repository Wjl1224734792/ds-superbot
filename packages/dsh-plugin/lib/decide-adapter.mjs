/**
 * Thin adapter: left-console approve / reject → runtime `approveDecision` /
 * `rejectDecision`. Side effects stay here so `console-model.mjs` remains a
 * pure view helper with no constitution / runtime imports.
 *
 * This module never auto-merges, never starts a process, never opens HTTP,
 * and never runs git. Default authority remains observe.
 */
import {
  approveDecision,
  rejectDecision,
  isHumanIssuer,
} from '../../runtime/src/loop.mjs';

export const CONSOLE_DECIDE_SOURCE = 'console';
export const DEFAULT_CONSOLE_ISSUER = 'human';
export { isHumanIssuer };

/**
 * @param {unknown} action
 * @returns {'approve'|'reject'|null}
 */
export function normalizeDecideAction(action) {
  const raw = String(action ?? '').trim().toLowerCase();
  if (raw === 'approve' || raw === 'approved' || raw === 'accept') return 'approve';
  if (raw === 'reject' || raw === 'rejected' || raw === 'deny') return 'reject';
  return null;
}

/**
 * Parse `/superbot-decide` free-form input: `approve <id>` or `reject <id> [reason]`.
 * @param {unknown} rawInput
 * @returns {{ action: 'approve'|'reject', workItemId: string, reason: string }|null}
 */
export function parseDecideInput(rawInput) {
  const raw = String(rawInput ?? '').trim();
  const matched = raw.match(/^(approve|reject)\s+(\S+)(?:\s+([\s\S]+))?$/i);
  if (!matched) return null;
  return {
    action: matched[1].toLowerCase(),
    workItemId: matched[2],
    reason: matched[3] ? matched[3].trim() : '',
  };
}

/**
 * A usable human issuer, or the console default `human`.
 * Reserved machine tokens are left intact so `approveDecision` can refuse them.
 * @param {object} [input]
 * @returns {string}
 */
export function resolveConsoleIssuer(input = {}) {
  const issuedBy = String(input.issuedBy ?? input.approvedBy ?? input.decidedBy ?? '').trim();
  return issuedBy || DEFAULT_CONSOLE_ISSUER;
}

/**
 * Route one console decision to the closed-loop APIs.
 *
 * @param {string} root repository root that holds `.superbot/ledger/`
 * @param {object|string} item work item or its id
 * @param {string} action `approve` or `reject`
 * @param {{
 *   issuedBy?: string,
 *   approvedBy?: string,
 *   decidedBy?: string,
 *   reason?: string,
 *   source?: string,
 *   write?: boolean,
 *   now?: Date,
 * }} [options]
 */
export function handleConsoleDecide(root, item, action, options = {}) {
  const verb = normalizeDecideAction(action);
  if (!verb) {
    const err = new Error(`unknown decide action: ${action}`);
    err.code = 'DECIDE_ACTION';
    throw err;
  }
  const workItemId = item && typeof item === 'object'
    ? (item.id ?? item.workItemId ?? item.workItem)
    : item;
  const issuedBy = resolveConsoleIssuer(options);
  const source = options.source ?? CONSOLE_DECIDE_SOURCE;
  const opts = { write: options.write !== false, now: options.now };

  if (verb === 'approve') {
    return approveDecision(root, {
      workItemId,
      issuedBy,
      source,
    }, opts);
  }

  return rejectDecision(root, {
    workItemId,
    issuedBy,
    source,
    reason: options.reason,
  }, opts);
}

/**
 * @param {string} root
 * @param {object} [options]
 * @returns {(item: object|string, action: string) => ReturnType<typeof handleConsoleDecide>}
 */
export function createConsoleOnDecide(root, options = {}) {
  return (item, action) => handleConsoleDecide(root, item, action, options);
}
