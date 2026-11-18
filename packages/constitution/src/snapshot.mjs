/**
 * Constitution snapshots. File set and hashing MUST reuse docs-state.mjs
 * (listDocs + hashExclude + CRLF-normalized sha256). Do not invent a second
 * definition of "which documents count as canon".
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from './errors.mjs';
import { isSnapshotId, snapshotId } from './ids.mjs';
import { listDocuments, readDocument, saveDocument } from './ledger.mjs';
import { policyRev } from './policy.mjs';
import { loadSchema, assertValid } from './schema.mjs';
import { formatIso } from './time.mjs';
import {
  DEFAULT_HASH_EXCLUDE,
  listDocs,
} from '../scripts/lib/docs-state.mjs';

function readDocTier(root) {
  const file = join(root, 'superbot.config.json');
  if (!existsSync(file)) return 0;
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    const tier = Number(cfg.docTier ?? 0);
    return Number.isInteger(tier) && tier >= 0 && tier <= 3 ? tier : 0;
  } catch {
    return 0;
  }
}

function excluded(rel, hashExclude = DEFAULT_HASH_EXCLUDE) {
  return hashExclude.some((rule) => (rule.endsWith('/') ? rel.startsWith(rule) : rel === rule));
}

/**
 * Per-file bindings using the same file set and CRLF normalization as
 * computeDocsHash, plus a combined fingerprint for the snapshot id.
 */
export function collectBindings(root, hashExclude = DEFAULT_HASH_EXCLUDE) {
  const bindings = [];
  const combined = createHash('sha256');
  for (const rel of listDocs(root)) {
    if (excluded(rel, hashExclude)) continue;
    let content;
    try {
      content = readFileSync(join(root, rel));
    } catch {
      continue;
    }
    const normalized = content.toString('utf8').replace(/\r\n/g, '\n');
    const sha256 = createHash('sha256').update(normalized, 'utf8').digest('hex');
    bindings.push({ path: rel, sha256 });
    combined.update(rel);
    combined.update('\0');
    combined.update(normalized);
    combined.update('\0');
  }
  return { bindings, fingerprint: combined.digest('hex') };
}

export function getSnapshot(root, id) {
  if (!isSnapshotId(id)) fail('SNAPSHOT', `invalid snapshot id: ${id}`);
  return readDocument(root, 'snapshot', id);
}

export function listSnapshots(root) {
  return listDocuments(root, 'snapshot');
}

export function createSnapshot(root, { write = false, hashExclude = DEFAULT_HASH_EXCLUDE } = {}) {
  const { bindings, fingerprint } = collectBindings(root, hashExclude);
  const id = snapshotId(fingerprint.slice(0, 12));
  const existing = getSnapshot(root, id);
  const document = existing ?? {
    schemaVersion: 1,
    id,
    capturedAt: formatIso(),
    docTier: readDocTier(root),
    policyRev: policyRev(root),
    bindings,
  };
  assertValid(document, loadSchema('snapshot'), 'snapshot');
  return saveDocument(root, 'snapshot', document, { write });
}

/**
 * Recompute current bindings and compare with a stored snapshot.
 * @returns {{ ok: boolean, id: string, stale: string[], missing: string[], added: string[] }}
 */
export function checkSnapshot(root, id, { hashExclude = DEFAULT_HASH_EXCLUDE } = {}) {
  const snapshot = getSnapshot(root, id);
  if (!snapshot) fail('SNAPSHOT', `snapshot not found: ${id}`);
  const { bindings } = collectBindings(root, hashExclude);
  const current = new Map(bindings.map((b) => [b.path, b.sha256]));
  const previous = new Map(snapshot.bindings.map((b) => [b.path, b.sha256]));
  const stale = [];
  const missing = [];
  const added = [];
  for (const [path, sha] of previous) {
    if (!current.has(path)) missing.push(path);
    else if (current.get(path) !== sha) stale.push(path);
  }
  for (const path of current.keys()) {
    if (!previous.has(path)) added.push(path);
  }
  return { ok: stale.length === 0 && missing.length === 0 && added.length === 0, id, stale, missing, added };
}
