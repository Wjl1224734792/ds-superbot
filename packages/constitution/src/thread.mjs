/**
 * Thread CRUD. A thread may hang multiple work items.
 */
import { fail } from './errors.mjs';
import { isThreadId, isWorkItemId, threadId } from './ids.mjs';
import { listDocuments, readDocument, saveDocument } from './ledger.mjs';
import { loadSchema, assertValid } from './schema.mjs';
import { formatIso } from './time.mjs';

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
    channels: Array.isArray(input.channels) ? [...input.channels] : [],
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
