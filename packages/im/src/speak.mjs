/**
 * Pure function: is this outbound message one of the three allowed kinds?
 * Allowed:
 *   - workitem, only when it accompanies a needs-decision moment
 *   - approval
 *   - result, only when state is Delivered or Failed
 * Anything else is rejected. Process / heartbeat / "analyzing" must not speak.
 */
import { SPEAK_KINDS } from './types.mjs';

const DECISION_STATES = new Set(['AwaitingApproval', 'Proposed']);
const RESULT_STATES = new Set(['Delivered', 'Failed']);

/**
 * @param {{ kind: string, state?: string, hasNewResult?: boolean }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function allowSpeak(input = {}) {
  const kind = input.kind;
  const state = input.state;
  if (!SPEAK_KINDS.includes(kind)) {
    return { ok: false, reason: `kind-not-allowed:${kind ?? 'missing'}` };
  }
  if (kind === 'approval') {
    if (state && !DECISION_STATES.has(state) && state !== 'AwaitingApproval') {
      return { ok: false, reason: `approval-not-in-decision-state:${state}` };
    }
    return { ok: true, reason: 'needs-decision' };
  }
  if (kind === 'workitem') {
    const needsDecision = state ? DECISION_STATES.has(state) : Boolean(input.hasNewResult === false && input.needsDecision);
    if (!needsDecision && !input.needsDecision) {
      return { ok: false, reason: 'workitem-requires-needs-decision' };
    }
    return { ok: true, reason: 'needs-decision' };
  }
  if (kind === 'result') {
    if (state && !RESULT_STATES.has(state) && !input.hasNewResult) {
      return { ok: false, reason: `result-not-terminal:${state}` };
    }
    if (!state && !input.hasNewResult) {
      return { ok: false, reason: 'result-requires-delivered-or-failed' };
    }
    return { ok: true, reason: state === 'Failed' ? 'failed' : 'result-ready' };
  }
  return { ok: false, reason: 'rejected' };
}

export function assertSpeak(input) {
  const result = allowSpeak(input);
  if (!result.ok) {
    const err = new Error(`speak rejected: ${result.reason}`);
    err.code = 'SPEAK_REJECTED';
    throw err;
  }
  return result;
}
