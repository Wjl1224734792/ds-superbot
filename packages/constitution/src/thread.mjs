/**
 * Thread CRUD. A thread may hang multiple work items and span multiple
 * channels (group://, github://, …) without forking a second thread object.
 */
import { fail } from './errors.mjs';
import { isThreadId, isWorkItemId, threadId } from './ids.mjs';
import { listDocuments, readDocument, saveDocument } from './ledger.mjs';
import { loadSchema, assertValid } from './schema.mjs';
import { formatIso } from './time.mjs';

/** scheme://… — e.g. group://repo-ops, github://owner/repo */
export const CHANNEL_URI = /^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i;

export function assertChannelUri(channel) {
  const value = String(channel ?? '').trim();
  if (!CHANNEL_URI.test(value) || value.includes('..')) {
    fail('THREAD', `invalid channel URI: ${channel}`);
  }
  return value;
}

function uniqueChannels(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const uri = assertChannelUri(raw);
    if (!out.includes(uri)) out.push(uri);
  }
  return out;
}

export function getThread(root, id) {
  if (!isThreadId(id)) fail('THREAD', `invalid thread id: ${id}`);
  return readDocument(root, 'thread', id);
}

export function listThreads(root) {
  return listDocuments(root, 'thread');
}

export function createThread(root, input, { write = false } = {}) {
  const now = formatIso();
  const id = isThreadId(input.id) ? input.id : threadId(input.slug ?? input.id);
  const existing = getThread(root, id);
  const document = {
    schemaVersion: 1,
    id,
    title: String(input.title ?? '').trim(),
    channels: uniqueChannels(input.channels),
    workItems: Array.isArray(input.workItems) ? [...input.workItems] : [],
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: existing ? existing.updatedAt : now,
  };
  assertValid(document, loadSchema('thread'), 'thread');
  if (existing) {
    // Idempotent create: same payload is ok; conflicting fields are not.
    if (existing.title !== document.title) {
      fail('THREAD', `thread ${id} already exists with a different title`);
    }
    return saveDocument(root, 'thread', existing, { write });
  }
  return saveDocument(root, 'thread', document, { write });
}

export function addItemToThread(root, threadIdValue, workItemId, { write = false } = {}) {
  if (!isWorkItemId(workItemId)) fail('THREAD', `invalid work item id: ${workItemId}`);
  const current = getThread(root, threadIdValue);
  if (!current) fail('THREAD', `thread not found: ${threadIdValue}`);
  if (current.workItems.includes(workItemId)) {
    return saveDocument(root, 'thread', current, { write });
  }
  const document = {
    ...current,
    workItems: [...current.workItems, workItemId],
    updatedAt: formatIso(),
  };
  assertValid(document, loadSchema('thread'), 'thread');
  return saveDocument(root, 'thread', document, { write });
}

/**
 * Add a channel URI to an existing thread. Idempotent: a channel that is
 * already bound is a no-op and does not fork a second thread.
 */
export function bindChannel(root, threadIdValue, channel, { write = false } = {}) {
  const uri = assertChannelUri(channel);
  const current = getThread(root, threadIdValue);
  if (!current) fail('THREAD', `thread not found: ${threadIdValue}`);
  if (current.channels.includes(uri)) {
    return saveDocument(root, 'thread', current, { write });
  }
  const document = {
    ...current,
    channels: [...current.channels, uri],
    updatedAt: formatIso(),
  };
  assertValid(document, loadSchema('thread'), 'thread');
  return saveDocument(root, 'thread', document, { write });
}

/**
 * All threads that already bind `channel`. Does not create anything.
 * Subscribe still grants no authority; this is a data-model lookup only.
 */
export function findThreadsByChannel(root, channel) {
  const uri = assertChannelUri(channel);
  return listThreads(root).filter((thread) => thread.channels.includes(uri));
}

/**
 * Reuse a thread if any listed channel is already bound; union the
 * remaining channels onto that same object. Never forks a second thread
 * when channels already live on one. If the listed channels are split
 * across two existing threads, fail rather than merge thread objects.
 *
 * @param {{ root: string, channels?: string[], slug?: string, title?: string, id?: string, write?: boolean }} input
 * @returns {{ document: object, written: boolean, skipped: boolean, path: string, reused: boolean }}
 */
export function resolveThread(input = {}) {
  const root = input.root;
  if (!root) fail('THREAD', 'resolveThread requires a repository root');
  const write = Boolean(input.write);
  const channels = uniqueChannels(input.channels);
  const hits = [];
  for (const uri of channels) {
    for (const thread of findThreadsByChannel(root, uri)) {
      if (!hits.some((h) => h.id === thread.id)) hits.push(thread);
    }
  }
  if (hits.length > 1) {
    fail(
      'THREAD',
      `channels are already bound to multiple threads (${hits.map((h) => h.id).join(', ')}); will not fork or merge thread objects`,
    );
  }
  if (hits.length === 1) {
    let current = hits[0];
    let last = { document: current, written: false, skipped: true, path: null, reused: true };
    for (const uri of channels) {
      if (!current.channels.includes(uri)) {
        last = bindChannel(root, current.id, uri, { write });
        current = last.document;
      }
    }
    return { ...last, document: current, reused: true };
  }
  if (!input.slug && !input.id && !input.title) {
    fail('THREAD', 'cannot resolve: no matching channel and no slug/title to create');
  }
  const created = createThread(root, {
    id: input.id,
    slug: input.slug ?? input.id,
    title: input.title,
    channels,
  }, { write });
  return { ...created, reused: false };
}
