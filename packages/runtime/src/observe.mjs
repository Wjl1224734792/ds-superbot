/**
 * Default authority is observe: record would-accept, do not execute,
 * and never auto-merge. P1 does not open an auto merge path.
 */
import * as bus from './bus.mjs';

export const DEFAULT_AUTHORITY = 'observe';

export const AUTHORITY_LEVELS = Object.freeze(['observe', 'execute']);

export function resolveAuthority(value) {
  const raw = value ?? DEFAULT_AUTHORITY;
  if (raw === 'auto' || raw === 'auto-merge') {
    const err = new Error('auto-merge is disabled; default authority is observe');
    err.code = 'AUTO_MERGE_DISABLED';
    throw err;
  }
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
    .map((ev) => ({ id: ev.id, at: ev.at, ...ev.payload }));
}
