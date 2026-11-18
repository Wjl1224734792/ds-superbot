/**
 * Receipt issue, list, get, and revalidate.
 * Only scripts may issue a receipt. exitCode !== 0 must not be signed as pass.
 * revalidate recomputes hashes (and will not silently trust a hand-edited file).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from './errors.mjs';
import { isReceiptId, isWorkItemId, receiptId } from './ids.mjs';
import { canonicalJson, listDocuments, readDocument, saveDocument } from './ledger.mjs';
import { loadSchema, assertValid } from './schema.mjs';
import { formatIso } from './time.mjs';

export const GATES = Object.freeze([
  'validate-plan',
  'docs-ready',
  'docs-gate',
  'verify',
  'browser-ac',
  'review',
  'naming-guard',
]);

export const GATE_SCRIPTS = Object.freeze({
  'docs-ready': 'scripts/docs-ready.mjs',
  'validate-plan': 'scripts/validate-plan.mjs',
  'docs-gate': 'scripts/docs-gate.mjs',
  'naming-guard': 'scripts/doc/guard-naming.mjs',
  'verify': 'scripts/verify.mjs',
  'browser-ac': 'browser-evidence.json',
  'review': 'docs-review',
});

export function getReceipt(root, id) {
  if (!isReceiptId(id)) fail('RECEIPT', `invalid receipt id: ${id}`);
  return readDocument(root, 'receipt', id);
}

export function listReceipts(root, workItemId) {
  const all = listDocuments(root, 'receipt');
  return workItemId ? all.filter((r) => r.workItem === workItemId) : all;
}

function sha256Text(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function hashArtifacts(root, artifacts = []) {
  const out = {};
  for (const rel of artifacts) {
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      out[rel] = null;
      continue;
    }
    const text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    out[rel] = sha256Text(text);
  }
  return out;
}

export function payloadForHash(receipt) {
  const { hashes, ...rest } = receipt;
  return rest;
}

export function computeHashes(root, receipt) {
  const artifacts = hashArtifacts(root, receipt.artifacts ?? []);
  const payloadHash = sha256Text(canonicalJson(payloadForHash({ ...receipt, hashes: {} })));
  const seal = sha256Text(canonicalJson({ payload: payloadHash, artifacts }));
  return { payload: payloadHash, artifacts, seal };
}

function hex8From(parts) {
  return sha256Text(parts).slice(0, 8);
}

/**
 * Issue a receipt from a gate run. Never signs pass when exitCode !== 0.
 */
export function issueReceipt(root, input, { write = false, now = new Date() } = {}) {
  if (!isWorkItemId(input.workItem)) fail('RECEIPT', `invalid work item id: ${input.workItem}`);
  if (!GATES.includes(input.gate)) fail('RECEIPT', `unknown gate: ${input.gate}`);
  const exitCode = Number(input.exitCode);
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 2) {
    fail('RECEIPT', `invalid exitCode: ${input.exitCode}`);
  }
  let status = input.status;
  if (status == null) {
    status = exitCode === 0 ? 'pass' : 'fail';
  }
  if (status === 'pass' && exitCode !== 0) {
    fail('RECEIPT', 'exitCode !== 0 cannot be signed as pass');
  }
  if (input.gate !== 'browser-ac' && status === 'unverified') {
    fail('RECEIPT', 'unverified is only allowed for browser-ac');
  }

  const issuedAt = formatIso(now);
  const script = input.script ?? GATE_SCRIPTS[input.gate] ?? `scripts/${input.gate}.mjs`;
  const suffix = hex8From(`${input.workItem}|${input.gate}|${issuedAt}|${exitCode}|${status}`);
  const id = input.id ?? receiptId(input.gate, suffix);
  const draft = {
    schemaVersion: 1,
    id,
    workItem: input.workItem,
    gate: input.gate,
    script,
    exitCode,
    status,
    issuedAt,
    constitution_snapshot: input.constitution_snapshot ?? null,
    artifacts: [...(input.artifacts ?? [])],
    hashes: {},
  };
  draft.hashes = computeHashes(root, draft);
  assertValid(draft, loadSchema('receipt'), 'receipt');
  return saveDocument(root, 'receipt', draft, { write });
}

/**
 * Recompute hashes from the file + current artifacts.
 * A hand-edited receipt (fields changed, hashes left alone, or hashes forged
 * without matching the payload) is marked stale. Never silently trust the file.
 *
 * @returns {{ receipt: object, ok: boolean, reasons: string[], written: boolean }}
 */
export function revalidateReceipt(root, id, { write = false } = {}) {
  const current = getReceipt(root, id);
  if (!current) fail('RECEIPT', `receipt not found: ${id}`);

  const reasons = [];
  if (current.status === 'pass' && current.exitCode !== 0) {
    reasons.push('pass-with-nonzero-exit');
  }

  const expected = computeHashes(root, current);
  const stored = current.hashes ?? {};
  if (stored.payload !== expected.payload) reasons.push('payload-hash-mismatch');
  if (stored.seal !== expected.seal) reasons.push('seal-mismatch');

  const storedArts = stored.artifacts ?? {};
  const currentArts = expected.artifacts;
  const keys = new Set([...Object.keys(storedArts), ...Object.keys(currentArts)]);
  for (const key of keys) {
    if (storedArts[key] !== currentArts[key]) reasons.push(`artifact-hash-mismatch:${key}`);
  }

  let next = current;
  if (reasons.length && current.status !== 'stale') {
    // Do not trust the file. Mark stale. Recompute hashes from the *original*
    // recorded payload so the mismatch remains visible, and record the check
    // under hashes.revalidate.
    next = {
      ...current,
      status: 'stale',
      hashes: {
        ...stored,
        revalidate: {
          at: formatIso(),
          expected,
          reasons,
        },
      },
    };
    // status change would break payload hash if we recomputed it; leave stored
    // hashes in place and attach the revalidate report only.
  }

  const saved = reasons.length && write
    ? saveDocument(root, 'receipt', next, { write: true })
    : { document: next, written: false };

  if (reasons.length) {
    return { receipt: saved.document, ok: false, reasons, written: saved.written };
  }
  return { receipt: current, ok: true, reasons: [], written: false };
}

export function markReceiptsStale(root, ids, { write = false, reason = 'snapshot-stale' } = {}) {
  const out = [];
  for (const id of ids) {
    const current = getReceipt(root, id);
    if (!current || current.status === 'stale') {
      if (current) out.push(current);
      continue;
    }
    const next = {
      ...current,
      status: 'stale',
      hashes: { ...current.hashes, staleReason: reason, staleAt: formatIso() },
    };
    out.push(saveDocument(root, 'receipt', next, { write }).document);
  }
  return out;
}
