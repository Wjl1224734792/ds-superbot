/**
 * Dynamic governance intensity: governance = f(risk, reversible).
 *
 * The matched Policy rule decides gates / allow / requireHuman / speak /
 * merge. Process step count is derived from that rule, so intensity can
 * be reduced by changing the policy document, not by deleting gate
 * implementations in code.
 *
 * Snapshot hash-staleness remains in effect once a constitution_snapshot
 * is bound, even if `docs-ready` is absent from the step list (the
 * work-item transition / checkSnapshot path is unchanged). Auto-merge
 * stays disabled; `merge: human-only` is recorded and enforced.
 */
import { fail } from './errors.mjs';
import { evalPolicy, evalPolicyDocument } from './policy.mjs';

function isPolicyInput(value) {
  if (typeof value === 'string') return true;
  if (value && Array.isArray(value.rules)) return true;
  if (value && value.policy && Array.isArray(value.policy.rules)) return true;
  return false;
}

/**
 * Plan the process steps for a work item from Policy.
 *
 * @param {object} workItem
 * @param {object|string|null} [policyOrOptions] policy document, YAML string,
 *   or `{ root, policy? }`
 * @param {{ root?: string, policy?: object|string }} [maybeOptions]
 * @returns {{
 *   ruleId: string,
 *   rule: object,
 *   gates: string[],
 *   allow: string[],
 *   requireHuman: boolean,
 *   speak: string[],
 *   merge: string|null,
 *   steps: number,
 *   stepCount: number,
 *   snapshotStaleStillApplies: true,
 *   file: string|null
 * }}
 */
export function planSteps(workItem, policyOrOptions, maybeOptions = {}) {
  if (!workItem) fail('GOVERNANCE', 'planSteps requires a work item');
  const options = !isPolicyInput(policyOrOptions) && policyOrOptions && typeof policyOrOptions === 'object'
    ? { ...policyOrOptions, ...maybeOptions }
    : { ...maybeOptions };
  const policy = isPolicyInput(policyOrOptions) ? policyOrOptions : (options.policy ?? null);
  const evaluation = policy
    ? evalPolicyDocument(policy, workItem)
    : evalPolicy(options.root, workItem);
  if (evaluation.merge === 'auto' || evaluation.merge === 'auto-merge') {
    fail('GOVERNANCE', 'auto-merge is disabled; merge remains human-only');
  }
  const gates = [...(evaluation.gates ?? [])];
  const steps = evaluation.steps ?? gates.length;
  return {
    ruleId: evaluation.id,
    rule: evaluation.rule,
    gates,
    allow: [...(evaluation.allow ?? [])],
    requireHuman: Boolean(evaluation.requireHuman),
    speak: [...(evaluation.speak ?? [])],
    merge: evaluation.merge ?? null,
    steps,
    stepCount: steps,
    snapshotStaleStillApplies: true,
    file: evaluation.file ?? null,
  };
}

/** Alias of planSteps. Intensity is decided by Policy, not role charters. */
export function intensity(workItem, policyOrOptions, maybeOptions) {
  return planSteps(workItem, policyOrOptions, maybeOptions);
}
