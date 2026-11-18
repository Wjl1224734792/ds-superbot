/**
 * Ledger I/O under <root>/.superbot/ledger/.
 * Reads are always live. Writes only happen when `write` is true (CLI --write).
 * Repeat writes of an identical document are idempotent.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fail } from './errors.mjs';

export const LEDGER_REL = '.superbot/ledger';

export const KIND_DIR = {
  thread: 'threads',
  workitem: 'work-items',
  mandate: 'mandates',
  receipt: 'receipts',
  snapshot: 'snapshots',
};

export function ledgerRoot(root) {
  return join(root, LEDGER_REL);
}

export function kindDir(root, kind) {
  const name = KIND_DIR[kind];
  if (!name) fail('LEDGER', `unknown ledger kind: ${kind}`);
  return join(ledgerRoot(root), name);
}

export function documentPath(root, kind, id) {
  return join(kindDir(root, kind), `${id}.json`);
}

export function readDocument(root, kind, id) {
  const file = documentPath(root, kind, id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    fail('LEDGER', `failed to read ${kind} ${id}: ${err.message}`);
  }
}

export function listDocuments(root, kind) {
  const dir = kindDir(root, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = join(dir, name);
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch (err) {
        fail('LEDGER', `failed to read ${file}: ${err.message}`);
      }
    });
}

/**
 * Persist a document when write=true. When write=false, return the document
 * without touching the filesystem (dry-run).
 * @returns {{ document: object, written: boolean, skipped: boolean, path: string }}
 */
export function saveDocument(root, kind, document, { write = false } = {}) {
  if (!document?.id) fail('LEDGER', `${kind} document is missing id`);
  const path = documentPath(root, kind, document.id);
  const encoded = `${JSON.stringify(document, null, 2)}\n`;
  if (!write) return { document, written: false, skipped: false, path };
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf8');
    if (current === encoded) return { document, written: false, skipped: true, path };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encoded, 'utf8');
  return { document, written: true, skipped: false, path };
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}
