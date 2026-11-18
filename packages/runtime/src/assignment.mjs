/**
 * Assignment data structure: isolated directory, tool whitelist, budget.
 * P0 does not start a process. Compute workDir stays under tmp/superbot/<run>/.
 * Execution helpers must not write ledger documents directly.
 */
import { assertComputePath, COMPUTE_REL, separate } from './separation.mjs';

let runSeq = 0;

export const EXECUTION_LEDGER_WRITE_CODE = 'STORAGE_COMPUTE_SEPARATION';

/**
 * @param {{ workItem: object, mandate?: object, runId?: string, root?: string }} input
 * @returns {{ id: string, workItem: string, mandate: string|null, workDir: string, toolsWhitelist: string[], budget: object, isolation: object }}
 */
export function create({ workItem, mandate, runId, root } = {}) {
  if (!workItem?.id) throw new Error('assignment.create requires a work item');
  const id = runId ?? `run-${workItem.id}-${(++runSeq).toString(36)}`;
  if (String(id).includes('..') || /[\\/]/.test(String(id))) {
    throw new Error(`assignment.create: unsafe run id: ${id}`);
  }
  const workDir = `${COMPUTE_REL}/${id}/`;
  if (root) {
    separate(root, { runId: id });
    assertComputePath(root, workDir);
  }
  return {
    id,
    workItem: workItem.id,
    mandate: mandate?.id ?? workItem.mandate ?? null,
    workDir,
    toolsWhitelist: [...(mandate?.toolsWhitelist ?? ['shell', 'read', 'edit', 'git'])],
    budget: {
      tokens: mandate?.budget?.tokens ?? 0,
      minutes: mandate?.budget?.minutes ?? 0,
    },
    isolation: {
      cwd: workDir,
      allowPaths: mandate?.scope?.files ?? workItem.scope?.files ?? [],
      allowNewFiles: mandate?.scope?.newFiles ?? workItem.scope?.newFiles ?? [],
    },
  };
}

/**
 * Execution helpers must refuse to write ledger documents directly.
 * Ledger I/O goes through constitution ledger APIs only.
 */
export function writeLedgerDocument() {
  const err = new Error(
    'execution helpers must not write ledger documents directly; use constitution ledger APIs',
  );
  err.code = EXECUTION_LEDGER_WRITE_CODE;
  throw err;
}

export { writeLedgerDocument as refuseLedgerWrite };
