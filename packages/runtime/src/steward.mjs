/**
 * Steward: assign, compile intent, and speak allowlisting.
 * Steward does not execute work and does not judge gates.
 * compileIntent in P0 returns a structured draft and never calls a model.
 */
import { notImplemented } from './errors.mjs';

const SPEAK_EVENTS = new Set(['needs-decision', 'result-ready', 'failed']);

/**
 * @param {{ type?: string, kind?: string, state?: string, speakKind?: string }} event
 * @returns {boolean}
 */
export function speakAllowed(event = {}) {
  const type = event.type ?? event.kind ?? event.speakKind;
  if (SPEAK_EVENTS.has(type)) return true;
  if (event.state === 'AwaitingApproval' && (type === 'approval' || type === 'workitem')) return true;
  if ((event.state === 'Delivered' || event.state === 'Failed') && type === 'result') return true;
  return false;
}

/**
 * Structured intent compilation (no model call).
 * @returns {{ planNeeds: object, mandateDraft: object }}
 */
export function compileIntent(workItem, snapshot) {
  if (!workItem) throw new Error('compileIntent requires a work item');
  const ac = workItem.ac ?? [];
  const missingCover = ac.filter((a) => !(a.coveredBy && a.coveredBy.length)).map((a) => a.id);
  const planNeeds = {
    impact: Boolean(workItem.intent),
    acceptanceCriteria: ac,
    missingCoveredBy: missingCover,
    scope: workItem.scope ?? { files: [], newFiles: [], owners: [] },
    gates: workItem.gates ?? [],
    snapshotId: snapshot?.id ?? workItem.constitution_snapshot ?? null,
  };
  const mandateDraft = {
    workItem: workItem.id,
    goal: workItem.intent,
    ac,
    nonGoals: workItem.nonGoals ?? [],
    scope: workItem.scope ?? { files: [], newFiles: [], owners: [] },
    toolsWhitelist: ['shell', 'read', 'edit', 'git'],
    budget: { tokens: 200000, minutes: 45 },
    evidenceRequired: workItem.gates ?? [],
    constitution_snapshot: snapshot?.id ?? workItem.constitution_snapshot ?? null,
  };
  return { planNeeds, mandateDraft };
}

/** @deprecated use compileIntent */
export function compile(workItem, snapshot) {
  return compileIntent(workItem, snapshot);
}

/**
 * P1: assign work to an isolated worker. Signature is stable.
 */
export function assign(_assignment) {
  notImplemented('steward.assign');
}
