/**
 * Assignment data structure: isolated directory, tool whitelist, budget.
 * P0 does not start a process.
 */
let runSeq = 0;

/**
 * @param {{ workItem: object, mandate?: object, runId?: string }} input
 * @returns {{ id: string, workItem: string, mandate: string|null, workDir: string, toolsWhitelist: string[], budget: object, isolation: object }}
 */
export function create({ workItem, mandate, runId } = {}) {
  if (!workItem?.id) throw new Error('assignment.create requires a work item');
  const id = runId ?? `run-${workItem.id}-${(++runSeq).toString(36)}`;
  return {
    id,
    workItem: workItem.id,
    mandate: mandate?.id ?? workItem.mandate ?? null,
    workDir: `tmp/superbot/${id}/`,
    toolsWhitelist: [...(mandate?.toolsWhitelist ?? ['shell', 'read', 'edit', 'git'])],
    budget: {
      tokens: mandate?.budget?.tokens ?? 0,
      minutes: mandate?.budget?.minutes ?? 0,
    },
    isolation: {
      cwd: `tmp/superbot/${id}/`,
      allowPaths: mandate?.scope?.files ?? workItem.scope?.files ?? [],
      allowNewFiles: mandate?.scope?.newFiles ?? workItem.scope?.newFiles ?? [],
    },
  };
}
