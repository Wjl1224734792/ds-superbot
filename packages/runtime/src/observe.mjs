/**
 * Default authority is observe: record would-accept, do not execute,
 * and never auto-merge. Auto grayscale (execution grayscale, NOT merge)
 * is a separate request token (`auto`) and is only allowed after a
 * persisted would-accept observe record exists for a comparable action.
 * Auto-merge stays disabled forever: assertNoAutoMerge still throws
 * for merge / auto-merge, and even a granted grayscale sets
 * would.merge = false and does not execute a merge.
 */
import * as bus from './bus.mjs';

export const DEFAULT_AUTHORITY = 'observe';

export const AUTHORITY_LEVELS = Object.freeze(['observe', 'auto', 'execute']);

export const SENSITIVE_TOUCHES = Object.freeze(['prod', 'billing', 'delete', 'secrets']);

export function touchesSensitive(touches) {
  const have = Array.isArray(touches) ? touches : [];
  return SENSITIVE_TOUCHES.some((t) => have.includes(t));
}

/**
 * Normalize a requested authority token.
 *
 * - omitted / unknown → observe
 * - `auto` is auto grayscale (a request, not a grant). Call
 *   evaluateAuto / canEnterAuto before treating it as entered.
 * - `auto-merge` is still auto-merge and always throws.
 */
export function resolveAuthority(value) {
  const raw = value ?? DEFAULT_AUTHORITY;
  if (raw === 'auto-merge') {
    const err = new Error('auto-merge is disabled; default authority is observe');
    err.code = 'AUTO_MERGE_DISABLED';
    throw err;
  }
  if (raw === 'auto') return 'auto';
  if (raw !== 'observe' && raw !== 'execute') {
    return DEFAULT_AUTHORITY;
  }
  return raw;
}

export function assertNoAutoMerge(action) {
  const name = String(action ?? '');
  if (name === 'merge' || name === 'auto-merge' || name === 'autoMerge') {
    const err = new Error('auto-merge is disabled in P1; merge remains a human decision');
    err.code = 'AUTO_MERGE_DISABLED';
    throw err;
  }
  return true;
}

/**
 * Persist a would-accept record on the file-backed bus.
 * @returns {object} the event written (or the in-memory record when no root)
 */
export function recordWouldAccept(root, entry = {}, { write = true } = {}) {
  assertNoAutoMerge(entry.action);
  const record = {
    action: entry.action ?? 'unknown',
    workItem: entry.workItem ?? null,
    reason: entry.reason ?? '',
    mentioned: entry.mentioned ?? null,
    authority: resolveAuthority(entry.authority),
    risk: entry.risk ?? entry.details?.risk ?? null,
    would: {
      propose: Boolean(entry.would?.propose),
      assign: Boolean(entry.would?.assign),
      execute: false,
      merge: false,
      revoke: Boolean(entry.would?.revoke),
      park: Boolean(entry.would?.park),
      halt: Boolean(entry.would?.halt),
      ...(entry.would ?? {}),
    },
    executed: false,
    policy: entry.policy ?? null,
    details: entry.details ?? null,
  };
  // Execution and merge are never flipped on by the caller.
  record.would.execute = false;
  record.would.merge = false;
  record.executed = false;

  if (!root || write === false) return { ...record, id: null, persisted: false };
  const event = bus.append({
    root,
    type: bus.EVENT_TYPES.WOULD_ACCEPT,
    source: entry.source ?? 'observe',
    workItem: record.workItem,
    mentioned: record.mentioned,
    payload: record,
  });
  return { ...record, id: event.id, at: event.at, persisted: true };
}

export function listWouldAccept(root, query = {}) {
  if (!root) return [];
  return bus.read({ root, type: bus.EVENT_TYPES.WOULD_ACCEPT, workItem: query.workItem, since: query.since, until: query.until, limit: query.limit })
    .map((ev) => ({ ...ev.payload, id: ev.id, at: ev.at, persisted: true }));
}

/**
 * Match key for auto grayscale: same `action`, and the same risk band
 * when the request carries a risk. Pre-P3 records without `risk` do
 * not match a risk-banded request.
 */
export function autoRecordsMatch(record, request = {}) {
  if (!record || record.executed !== false) return false;
  if (!record.id || record.persisted === false) return false;
  if (String(record.action) !== String(request.action ?? '')) return false;
  if (request.risk) return record.risk === request.risk;
  return true;
}

function refused(reason, extra = {}) {
  return {
    allowed: false,
    authority: DEFAULT_AUTHORITY,
    reason,
    would: { execute: false, merge: false },
    requested: extra.requested ?? 'auto',
    matchKey: extra.matchKey ?? { action: extra.action ?? null, risk: extra.risk ?? null },
    ...extra,
  };
}

/**
 * May this action enter auto grayscale (execution grayscale, NOT merge)?
 *
 * Rules:
 * - Default / missing request → remain observe.
 * - Requested `auto` is allowed only when there is already at least one
 *   persisted would-accept record for a comparable action (same action,
 *   and same risk band when risk is present).
 * - R2 / R3, `human-approval`, or `requireHuman` cannot enter auto.
 * - `touches` of prod | billing | delete | secrets cannot enter auto
 *   (aligned with the tightened default Policy).
 * - Eligible actions must be reversible and low risk (R0 / R1).
 * - A grant still sets would.merge = false and does not execute a merge.
 * - Auto-merge / merge still throws AUTO_MERGE_DISABLED.
 *
 * This API only answers eligibility. assign / consider / watchdog stay
 * on their default observe path and do not start executing work just
 * because eligibility is true.
 *
 * @param {{
 *   root?: string,
 *   action?: string,
 *   requested?: string,
 *   authority?: string,
 *   request?: string,
 *   risk?: string,
 *   reversible?: boolean,
 *   touches?: string[],
 *   requireHuman?: boolean,
 *   itemAuthority?: string,
 *   workItem?: object
 * }} input
 */
export function evaluateAuto(input = {}) {
  assertNoAutoMerge(input.action);

  const requested = input.requested ?? input.request ?? input.authority ?? null;
  const item = input.workItem ?? {};
  const risk = input.risk ?? item.risk ?? null;
  const reversible = input.reversible ?? item.reversible;
  const touches = input.touches ?? item.touches;
  const itemAuthority = input.itemAuthority ?? item.authority ?? null;
  const requireHuman = Boolean(input.requireHuman);
  const action = input.action ?? null;
  const matchKey = { action, risk };

  if (requested == null || requested === '' || requested === DEFAULT_AUTHORITY) {
    return refused('default-observe', { requested: requested ?? null, action, risk, matchKey });
  }
  if (requested !== 'auto') {
    return refused('not-requested', { requested, action, risk, matchKey });
  }

  if (risk === 'R2' || risk === 'R3') {
    return refused('risk-human-gated', { requested: 'auto', action, risk, matchKey });
  }
  if (itemAuthority === 'human-approval' || requireHuman) {
    return refused('human-approval', { requested: 'auto', action, risk, matchKey });
  }
  if (touchesSensitive(touches)) {
    return refused('touches-sensitive', { requested: 'auto', action, risk, matchKey });
  }
  if (reversible !== true) {
    return refused('not-reversible', { requested: 'auto', action, risk, matchKey });
  }
  if (!action) {
    return refused('missing-action', { requested: 'auto', action, risk, matchKey });
  }
  if (!input.root) {
    return refused('no-persisted-observe-record', { requested: 'auto', action, risk, matchKey });
  }

  const records = listWouldAccept(input.root);
  const matched = records.find((r) => autoRecordsMatch(r, { action, risk }));
  if (!matched) {
    return refused('no-persisted-observe-record', { requested: 'auto', action, risk, matchKey });
  }

  return {
    allowed: true,
    authority: 'auto',
    reason: 'observe-record-matched',
    would: { execute: false, merge: false },
    requested: 'auto',
    matchKey,
    matched: { id: matched.id, action: matched.action, risk: matched.risk ?? null },
  };
}

export function canEnterAuto(input = {}) {
  return evaluateAuto(input).allowed;
}

/**
 * Turn a requested token into the authority assign/consider/watchdog
 * should actually run under. `auto` is only kept when evaluateAuto
 * allows it; otherwise we remain observe. Execution still does not
 * start just because eligibility is true.
 */
export function settleAuthority(value, evalInput = {}) {
  const requested = resolveAuthority(value);
  if (requested !== 'auto') return { authority: requested, auto: null, requested };
  const auto = evaluateAuto({ ...evalInput, requested: 'auto' });
  return {
    authority: auto.allowed ? 'auto' : DEFAULT_AUTHORITY,
    auto,
    requested,
  };
}

/** Hands-off authorities record would-accept and never mutate or merge. */
export function isHandsOffAuthority(authority) {
  return authority === 'observe' || authority === 'auto';
}
