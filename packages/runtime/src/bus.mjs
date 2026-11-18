/**
 * File-backed event bus. Append-only JSONL under
 * `<root>/.superbot/ledger/events.jsonl`. No HTTP, no network.
 *
 * Event ids use `EV-<12 hex>` and are log identifiers, not constitution
 * object ids (those stay WI / TH / MD / RC / CS).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { formatIso } from './time.mjs';
import { confineLedgerFile } from '../../constitution/src/ledger.mjs';

export const EVENTS_REL = '.superbot/ledger/events.jsonl';
export const EVENT_ID = /^EV-[0-9a-f]{12}$/;

export const EVENT_TYPES = Object.freeze({
  SIGNAL: 'signal',
  WOULD_ACCEPT: 'would-accept',
  CANDIDATE: 'candidate.proposed',
  SUBSCRIBE_CONNECTED: 'subscribe.connected',
  SUBSCRIBE_INGESTED: 'subscribe.ingested',
  WATCHDOG_PROGRESS: 'watchdog.progress',
  WATCHDOG_IDLE: 'watchdog.idle',
  WATCHDOG_COST: 'watchdog.cost',
  WATCHDOG_TICK: 'watchdog.tick',
});

/** root -> Set<handler> */
const listeners = new Map();

export function eventsPath(root) {
  if (!root) throw new Error('bus requires a repository root');
  return confineLedgerFile(root, join(root, EVENTS_REL));
}

export function isEventId(id) {
  return EVENT_ID.test(id);
}

function newEventId() {
  return `EV-${randomBytes(6).toString('hex')}`;
}

function fingerprint(record) {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 12);
}

function normalizeAppend(input, maybeEvent) {
  if (typeof input === 'string') {
    return { root: input, event: maybeEvent ?? {} };
  }
  if (input && input.root && input.event && typeof input.event === 'object' && !input.type) {
    return { root: input.root, event: input.event };
  }
  if (input && input.root) {
    const { root, ...event } = input;
    return { root, event };
  }
  throw new Error('bus.append requires { root, ...event }');
}

function normalizeQuery(input, maybeQuery) {
  if (typeof input === 'string') {
    return { root: input, ...(maybeQuery ?? {}) };
  }
  if (!input?.root) throw new Error('bus.read requires { root }');
  return input;
}

function normalizeSubscribe(input, maybeOptions) {
  if (typeof input === 'function') {
    const options = maybeOptions ?? {};
    if (!options.root) throw new Error('bus.subscribe requires root');
    return { root: options.root, handler: input };
  }
  if (input && typeof input.handler === 'function' && input.root) {
    return { root: input.root, handler: input.handler };
  }
  throw new Error('bus.subscribe requires a handler and root');
}

function keyFor(root) {
  return resolve(root);
}

/**
 * Append one event to the ledger and notify in-process subscribers.
 * @param {string|{ root: string, [k: string]: any }} input
 * @param {object} [event]
 */
export function append(input, event) {
  const { root, event: raw } = normalizeAppend(input, event);
  const at = raw.at ?? formatIso();
  const record = {
    schemaVersion: 1,
    id: raw.id && isEventId(raw.id) ? raw.id : newEventId(),
    type: String(raw.type ?? 'signal'),
    at,
    source: raw.source ?? 'runtime',
    workItem: raw.workItem ?? null,
    mentioned: raw.mentioned ?? null,
    payload: raw.payload ?? {},
  };
  if (!isEventId(record.id)) {
    record.id = `EV-${fingerprint(record)}`;
  }
  const file = eventsPath(root);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  const set = listeners.get(keyFor(root));
  if (set) {
    for (const handler of set) handler(record);
  }
  return record;
}

/**
 * Read events from the ledger, optionally filtered.
 * @param {{ root: string, type?: string, workItem?: string, since?: string, until?: string, limit?: number }} query
 */
export function read(query, maybeQuery) {
  const q = normalizeQuery(query, maybeQuery);
  const file = eventsPath(q.root);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      throw new Error(`bus.read: malformed event line in ${file}`);
    }
    if (q.type && ev.type !== q.type) continue;
    if (q.workItem && ev.workItem !== q.workItem) continue;
    if (q.source && ev.source !== q.source) continue;
    if (q.since && ev.at < q.since) continue;
    if (q.until && ev.at > q.until) continue;
    out.push(ev);
  }
  if (q.limit != null) return out.slice(-Math.max(0, Number(q.limit)));
  return out;
}

/**
 * In-process subscription. Past events are not replayed unless
 * `{ replay: true }` is set. Returns an unsubscribe function.
 */
export function subscribe(input, options) {
  const { root, handler } = normalizeSubscribe(input, options);
  const replay = Boolean((options && options.replay) || (input && input.replay));
  if (replay) {
    for (const ev of read({ root })) handler(ev);
  }
  const key = keyFor(root);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(handler);
  return function unsubscribe() {
    const current = listeners.get(key);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) listeners.delete(key);
  };
}

/** Test helper: drop in-process listeners for a root (or all). */
export function resetListeners(root) {
  if (root) listeners.delete(keyFor(root));
  else listeners.clear();
}
