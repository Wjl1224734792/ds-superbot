/**
 * Ledger I/O under <root>/.superbot/ledger/.
 * Reads are always live. Writes only happen when `write` is true (CLI --write).
 * Repeat writes of an identical document are idempotent.
 *
 * Path confinement (P4 存算分离): every ledger path is resolved and must
 * stay under <root>/.superbot/ledger/, which itself must stay under the
 * repository root. A compute workDir (tmp/superbot/<run>/) cannot be used
 * as a ledger root, and the ledger API will not write into tmp/superbot
 * or business source (src/, packages/, …).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fail } from './errors.mjs';

export const LEDGER_REL = '.superbot/ledger';
export const COMPUTE_REL = 'tmp/superbot';

const BUSINESS_PREFIXES = Object.freeze([
  'src/',
  'packages/',
  'app/',
  'lib/',
  'scripts/',
]);

export const KIND_DIR = {
  thread: 'threads',
  workitem: 'work-items',
  mandate: 'mandates',
  receipt: 'receipts',
  snapshot: 'snapshots',
};

export function posixRel(from, to) {
  return relative(from, to).split(sep).join('/');
}

export function isInside(parent, child) {
  const rel = posixRel(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith('/'));
}

/**
 * True when `path` has a `tmp/superbot` directory segment
 * (assignment workDir lives under tmp/superbot/<run>/).
 */
export function isComputePath(pathValue) {
  if (pathValue == null || pathValue === '') return false;
  const raw = String(pathValue).split(sep).join('/');
  const segs = raw.split('/').filter(Boolean);
  for (let i = 0; i < segs.length - 1; i += 1) {
    if (segs[i] === 'tmp' && segs[i + 1] === 'superbot') return true;
  }
  // Also accept a relative path that *is* tmp/superbot or starts with it
  // even when it has not been resolved yet (no drive / root prefix).
  if (raw === COMPUTE_REL || raw.startsWith(`${COMPUTE_REL}/`) || raw.startsWith(`/${COMPUTE_REL}/`)) {
    return true;
  }
  return false;
}

export function resolveRoot(root) {
  if (!root) fail('LEDGER', 'repository root is required');
  return resolve(root);
}

export function assertSafeLedgerId(id) {
  if (id == null || String(id).trim() === '') fail('LEDGER', 'ledger document is missing id');
  const value = String(id);
  if (value.includes('\0') || value.includes('..') || /[\\/]/.test(value)) {
    fail('LEDGER', `unsafe ledger id: ${id}`);
  }
  return value;
}

/**
 * Refuse to treat a compute workDir (or anything under tmp/superbot) as
 * the repository / ledger root.
 */
export function assertLedgerRoot(root) {
  const abs = resolveRoot(root);
  if (isComputePath(abs)) {
    fail('LEDGER', `compute path cannot be used as a ledger root: ${abs}`);
  }
  return abs;
}

function isBusinessSourceRel(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (norm === 'src' || norm === 'packages' || norm === 'app' || norm === 'lib' || norm === 'scripts') {
    return true;
  }
  return BUSINESS_PREFIXES.some((prefix) => norm === prefix.slice(0, -1) || norm.startsWith(prefix));
}

/**
 * Resolve `targetPath` and assert it stays under <root>/.superbot/ledger/.
 * The target need not exist yet.
 * @returns {string} absolute confined path
 */
export function assertLedgerPath(root, targetPath) {
  const absRoot = assertLedgerRoot(root);
  if (targetPath == null || targetPath === '') {
    fail('LEDGER', 'ledger path is required');
  }
  const abs = resolve(absRoot, targetPath);
  if (!isInside(absRoot, abs)) {
    fail('LEDGER', `path escapes repository root: ${targetPath}`);
  }
  const rel = posixRel(absRoot, abs);
  if (rel === COMPUTE_REL || rel.startsWith(`${COMPUTE_REL}/`)) {
    fail('LEDGER', `ledger API will not write into ${COMPUTE_REL}`);
  }
  if (isBusinessSourceRel(rel)) {
    fail('LEDGER', `ledger API will not write into business source: ${rel}`);
  }
  const ledger = resolve(absRoot, LEDGER_REL);
  if (!isInside(ledger, abs)) {
    fail('LEDGER', `ledger writes must stay under ${LEDGER_REL}: ${rel || targetPath}`);
  }
  return abs;
}

/** Alias used by the file-backed event bus to confine events.jsonl. */
export function confineLedgerFile(root, targetPath) {
  return assertLedgerPath(root, targetPath);
}

export function ledgerRoot(root) {
  const absRoot = assertLedgerRoot(root);
  return assertLedgerPath(absRoot, resolve(absRoot, LEDGER_REL));
}

export function kindDir(root, kind) {
  const name = KIND_DIR[kind];
  if (!name) fail('LEDGER', `unknown ledger kind: ${kind}`);
  return assertLedgerPath(root, resolve(ledgerRoot(root), name));
}

export function documentPath(root, kind, id) {
  assertSafeLedgerId(id);
  return assertLedgerPath(root, resolve(kindDir(root, kind), `${id}.json`));
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
      const file = assertLedgerPath(root, join(dir, name));
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
