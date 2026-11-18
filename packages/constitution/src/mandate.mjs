/**
 * Mandate issue / revoke / get.
 * After issue, every field except revokedAt / revokeReason is frozen.
 * Re-issue requires revoke first. One unrevoked mandate per work item.
 * Revoked records are historical copies: they keep their unique id and
 * are never overwritten by a later issue.
 * Reasons: human-stop, expired, snapshot-stale, and timeout (P5 Watchdog idle).
 */
import { fail } from './errors.mjs';
import { isMandateId, isWorkItemId, mandateIdFor, nextMandateId } from './ids.mjs';
import { listDocuments, readDocument, saveDocument } from './ledger.mjs';
import { loadSchema, assertValid } from './schema.mjs';
import { formatIso, isExpired } from './time.mjs';

export const REVOKE_REASONS = Object.freeze(['human-stop', 'expired', 'snapshot-stale', 'timeout']);

const FROZEN = new Set([
  'schemaVersion', 'id', 'workItem', 'issuedBy', 'issuedAt', 'expiresAt',
  'constitution_snapshot', 'goal', 'ac', 'nonGoals', 'scope',
  'toolsWhitelist', 'budget', 'evidenceRequired',
]);

export function getMandate(root, id) {
  if (!isMandateId(id)) fail('MANDATE', `invalid mandate id: ${id}`);
  return readDocument(root, 'mandate', id);
}

export function listMandates(root) {
  return listDocuments(root, 'mandate');
}

export function mandatesFor(root, workItemId) {
  return listMandates(root).filter((doc) => doc.workItem === workItemId);
}

export function activeMandateFor(root, workItemId) {
  const found = mandatesFor(root, workItemId).filter((doc) => !doc.revokedAt);
  if (found.length > 1) {
    fail('MANDATE', `multiple active mandates for ${workItemId}: ${found.map((d) => d.id).join(', ')}`);
  }
  return found[0] ?? null;
}

export function assertUsableMandate(root, workItemId, now = new Date()) {
  const doc = activeMandateFor(root, workItemId);
  if (!doc) fail('MANDATE', `no active mandate for ${workItemId}`);
  if (isExpired(doc.expiresAt, now)) {
    fail('MANDATE_EXPIRED', `mandate ${doc.id} expired at ${doc.expiresAt}`);
  }
  return doc;
}

function cloneScope(scope) {
  return {
    files: [...(scope?.files ?? [])],
    newFiles: [...(scope?.newFiles ?? [])],
    owners: [...(scope?.owners ?? [])],
  };
}

/**
 * Issue a mandate. `workItem` must already exist in the caller's mind; this
 * module only writes the mandate document. The work-item binder updates the
 * work item row separately so we don't create a circular import.
 *
 * A new issue after revoke gets a unique id (`MD-<workItemId>-N`) and does
 * not overwrite the revoked historical file.
 */
export function issueMandate(root, input, { write = false, now = new Date() } = {}) {
  const workItemId = input.workItem;
  if (!isWorkItemId(workItemId)) fail('MANDATE', `invalid work item id: ${workItemId}`);

  const history = mandatesFor(root, workItemId);
  const active = history.filter((doc) => !doc.revokedAt);

  let id = input.id;
  if (id && !isMandateId(id)) fail('MANDATE', `invalid mandate id: ${id}`);
  if (!id) id = nextMandateId(history.map((doc) => doc.id), workItemId);

  const existing = getMandate(root, id);

  if (existing && !existing.revokedAt) {
    // Idempotent re-issue of an identical active mandate is allowed.
    const candidate = buildMandate(id, input, existing, now);
    if (!sameFrozen(existing, candidate)) {
      fail('MANDATE', `active mandate ${id} already exists; revoke it before re-issuing`);
    }
    return saveDocument(root, 'mandate', existing, { write });
  }

  if (existing && existing.revokedAt) {
    fail('MANDATE', `mandate id ${id} is a revoked historical record and cannot be overwritten`);
  }

  if (active.length && active[0].id !== id) {
    fail('MANDATE', `active mandate ${active[0].id} already exists; revoke it before re-issuing`);
  }

  const document = buildMandate(id, input, null, now);
  assertValid(document, loadSchema('mandate'), 'mandate');
  if (isExpired(document.expiresAt, now)) {
    fail('MANDATE_EXPIRED', `cannot issue a mandate that is already expired (${document.expiresAt})`);
  }
  return saveDocument(root, 'mandate', document, { write });
}

function buildMandate(id, input, previous, now) {
  return {
    schemaVersion: 1,
    id,
    workItem: input.workItem,
    issuedBy: String(input.issuedBy ?? '').trim(),
    issuedAt: previous?.issuedAt ?? input.issuedAt ?? formatIso(now),
    expiresAt: input.expiresAt,
    constitution_snapshot: input.constitution_snapshot,
    goal: String(input.goal ?? '').trim(),
    ac: Array.isArray(input.ac) ? input.ac.map((a) => ({ id: a.id, text: a.text, coveredBy: [...(a.coveredBy ?? [])] })) : [],
    nonGoals: [...(input.nonGoals ?? [])],
    scope: cloneScope(input.scope),
    toolsWhitelist: [...(input.toolsWhitelist ?? ['shell', 'read', 'edit', 'git'])],
    budget: {
      tokens: Number(input.budget?.tokens ?? 0),
      minutes: Number(input.budget?.minutes ?? 0),
    },
    evidenceRequired: [...(input.evidenceRequired ?? [])],
    revokedAt: null,
    revokeReason: null,
  };
}

function sameFrozen(a, b) {
  for (const key of FROZEN) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  return true;
}

export function revokeMandate(root, id, reason, { write = false, now = new Date() } = {}) {
  if (!REVOKE_REASONS.includes(reason)) {
    fail('MANDATE', `revoke reason must be one of ${REVOKE_REASONS.join(', ')}`);
  }
  const current = getMandate(root, id);
  if (!current) fail('MANDATE', `mandate not found: ${id}`);
  if (current.revokedAt) {
    if (current.revokeReason !== reason) {
      fail('MANDATE_FROZEN', `mandate ${id} already revoked with reason ${current.revokeReason}`);
    }
    return saveDocument(root, 'mandate', current, { write });
  }
  const document = {
    ...current,
    revokedAt: formatIso(now),
    revokeReason: reason,
  };
  assertValid(document, loadSchema('mandate'), 'mandate');
  return saveDocument(root, 'mandate', document, { write });
}

/**
 * Reject any attempt to change frozen fields, including after revoke.
 */
export function assertFrozen(previous, next) {
  for (const key of FROZEN) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      fail('MANDATE_FROZEN', `mandate field ${key} is immutable`);
    }
  }
  if (previous.revokedAt && next.revokedAt && previous.revokedAt !== next.revokedAt) {
    fail('MANDATE_FROZEN', 'revokedAt cannot be rewritten once set');
  }
  if (previous.revokeReason && next.revokeReason && previous.revokeReason !== next.revokeReason) {
    fail('MANDATE_FROZEN', 'revokeReason cannot be rewritten once set');
  }
}
