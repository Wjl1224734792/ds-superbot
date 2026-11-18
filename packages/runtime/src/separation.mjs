/**
 * Storage / compute split (P4 存算分离加固).
 *
 * Storage lives only under `.superbot/ledger/` (threads, work-items,
 * mandates, receipts, snapshots, plus the file-backed event log).
 * Compute / assignment workDir stays under `tmp/superbot/<run>/`.
 *
 * This module does not open HTTP, a BFF, or an independent-port console.
 * Ledger writes must go through constitution ledger APIs.
 */
import { join, relative, resolve, sep, isAbsolute } from 'node:path';
import {
  LEDGER_REL,
  COMPUTE_REL,
  assertLedgerPath,
  assertLedgerRoot,
  isComputePath,
  isInside,
  posixRel,
} from '../../constitution/src/ledger.mjs';

export { LEDGER_REL, COMPUTE_REL, isComputePath, isInside, posixRel, assertLedgerPath, assertLedgerRoot };

export const STORAGE_REL = LEDGER_REL;

export class SeparationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SeparationError';
    this.code = 'STORAGE_COMPUTE_SEPARATION';
    this.details = details;
  }
}

function failSeparate(message, details) {
  throw new SeparationError(message, details);
}

/**
 * Assert that `candidate` is a storage (ledger) path under
 * `<root>/.superbot/ledger/`. When `candidate` is omitted, the ledger
 * root itself is checked. A compute path cannot be used as a ledger root.
 * @returns {string} absolute confined path
 */
export function assertStoragePath(root, candidate) {
  const absRoot = assertLedgerRoot(root);
  const target = candidate == null || candidate === ''
    ? join(absRoot, STORAGE_REL)
    : candidate;
  if (isComputePath(target) && !String(target).split(sep).join('/').includes(STORAGE_REL)) {
    failSeparate(`compute path cannot be used as a ledger root: ${target}`);
  }
  return assertLedgerPath(absRoot, target);
}

/**
 * Assert that `candidate` is a compute path under `<root>/tmp/superbot/`.
 * When `candidate` is omitted, the compute root itself is checked.
 * A compute path cannot point at the ledger.
 * @returns {string} absolute confined path
 */
export function assertComputePath(root, candidate) {
  if (!root) failSeparate('assertComputePath requires a repository root');
  const absRoot = resolve(root);
  if (isComputePath(absRoot)) {
    failSeparate(`repository root must not be a compute path: ${absRoot}`);
  }
  const target = candidate == null || candidate === ''
    ? resolve(absRoot, COMPUTE_REL)
    : resolve(absRoot, candidate);
  if (!isInside(absRoot, target)) {
    failSeparate(`compute path escapes repository root: ${candidate}`);
  }
  const rel = posixRel(absRoot, target);
  if (rel !== COMPUTE_REL && !rel.startsWith(`${COMPUTE_REL}/`)) {
    failSeparate(`compute path must stay under ${COMPUTE_REL}/: ${rel}`);
  }
  if (rel === STORAGE_REL || rel.startsWith(`${STORAGE_REL}/`) || rel.startsWith('.superbot/')) {
    failSeparate('compute path cannot point at the ledger');
  }
  return target;
}

/**
 * Describe the storage / compute split for a repository root.
 * @param {string} root
 * @param {{ runId?: string }} [options]
 * @returns {{
 *   root: string,
 *   storageRoot: string,
 *   storageRel: string,
 *   computeRoot: string,
 *   computeRel: string,
 *   workDir: string,
 *   eventsPath: string
 * }}
 */
export function separate(root, { runId } = {}) {
  const absRoot = assertLedgerRoot(root);
  const storageRoot = assertStoragePath(absRoot);
  const computeRoot = assertComputePath(absRoot);
  const id = runId ?? 'run';
  if (String(id).includes('..') || /[\\/]/.test(String(id))) {
    failSeparate(`unsafe run id: ${id}`);
  }
  const workDirRel = `${COMPUTE_REL}/${id}/`;
  const workDir = assertComputePath(absRoot, workDirRel);
  return {
    root: absRoot,
    storageRoot,
    storageRel: STORAGE_REL,
    computeRoot,
    computeRel: COMPUTE_REL,
    workDir: workDirRel,
    workDirAbs: workDir,
    eventsPath: join(storageRoot, 'events.jsonl'),
  };
}

export function relativeUnderRoot(root, target) {
  const absRoot = resolve(root);
  const abs = resolve(absRoot, target);
  const rel = relative(absRoot, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    failSeparate(`path escapes repository root: ${target}`);
  }
  return rel.split(sep).join('/');
}
