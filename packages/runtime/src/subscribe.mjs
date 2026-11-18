/**
 * Subscription pass-through. Connecting a channel or ingesting an
 * event never grants authority, never expands a Mandate's
 * toolsWhitelist / scope / budget, and never executes work.
 * No HTTP server is started.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as bus from './bus.mjs';
import { formatIso } from './time.mjs';

const DENIED_GRANT_KEYS = Object.freeze(['toolsWhitelist', 'scope', 'budget', 'authority', 'mandate', 'allow']);

export const SUBSCRIPTIONS_REL = '.superbot/ledger/subscriptions';

function channelPath(root, channel) {
  return join(root, SUBSCRIPTIONS_REL, `${safeChannel(channel)}.json`);
}

function safeChannel(channel) {
  const cleaned = String(channel ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!cleaned) throw new Error('subscribe.connect requires a channel name');
  return cleaned.slice(0, 64);
}

function readJson(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Register a pass-through subscription. The returned record always has
 * an empty authority grant, even if the caller tries to pass one.
 *
 * @param {{ root: string, channel: string, source?: string, authority?: any, toolsWhitelist?: any }} input
 */
export function connect(input = {}) {
  const root = input.root;
  if (!root) throw new Error('subscribe.connect requires root');
  const channel = safeChannel(input.channel ?? input.source ?? input.id);
  const record = {
    schemaVersion: 1,
    channel,
    source: input.source ?? channel,
    connectedAt: input.connectedAt ?? formatIso(),
    passThrough: true,
    authorityGranted: [],
    grants: {
      toolsWhitelist: [],
      scope: { files: [], newFiles: [], owners: [] },
      budget: { tokens: 0, minutes: 0 },
    },
  };
  const file = channelPath(root, channel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  const event = bus.append({
    root,
    type: bus.EVENT_TYPES.SUBSCRIBE_CONNECTED,
    source: record.source,
    payload: { channel, authorityGranted: [] },
  });
  return { ...record, eventId: event.id, path: file };
}

export function getSubscription(root, channel) {
  return readJson(channelPath(root, safeChannel(channel)));
}

/**
 * Ingest an inbound event as a decision input only.
 * Any attempted permission grant in the payload is ignored and reported.
 *
 * @param {{ root: string, channel?: string, event?: object, mentioned?: boolean }} input
 */
export function ingest(input = {}) {
  const root = input.root;
  if (!root) throw new Error('subscribe.ingest requires root');
  const raw = input.event ?? input;
  const channel = input.channel ?? raw.channel ?? 'inbox';
  const sub = getSubscription(root, channel) ?? null;
  const attempted = detectGrantAttempt(raw);
  const mentioned = Boolean(input.mentioned ?? raw.mentioned ?? raw.atMentioned);

  const event = bus.append({
    root,
    type: bus.EVENT_TYPES.SUBSCRIBE_INGESTED,
    source: sub?.source ?? channel,
    mentioned,
    workItem: raw.workItem ?? null,
    payload: {
      channel,
      text: raw.text ?? raw.intent ?? raw.body ?? '',
      ref: raw.ref ?? raw.url ?? null,
      mentioned,
      authorityGranted: [],
      ignoredGrants: attempted,
    },
  });

  return {
    accepted: true,
    passThrough: true,
    channel,
    mentioned,
    authorityGranted: [],
    ignoredGrants: attempted,
    event,
    executed: false,
    subscribed: Boolean(sub),
  };
}

function detectGrantAttempt(raw) {
  const ignored = [];
  const payload = raw && typeof raw === 'object' ? { ...raw, ...(raw.payload ?? {}) } : {};
  for (const key of DENIED_GRANT_KEYS) {
    if (payload[key] != null && payload[key] !== '') {
      ignored.push(key);
    }
  }
  if (payload.grant || payload.grants || payload.permissions) ignored.push('permissions');
  return [...new Set(ignored)];
}
