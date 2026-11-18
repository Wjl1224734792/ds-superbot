/**
 * Pure helpers for the P2 left console, stage field, and quiet chat policy.
 * Call presenceOf for eyes / motion / energy / caption. Do not fork a mapping.
 */
import { FACES, presenceOf, capHighEnergy } from './presence-standalone.mjs';

/** Auto-merge stays off in every P2 surface. */
export const AUTO_MERGE_DISABLED = true;

export const DEFAULT_AUTHORITY = 'observe';

export const DECISION_STATES = Object.freeze(['AwaitingApproval', 'Proposed']);
export const MERGE_STATES = Object.freeze(['Delivered']);
export const FAILED_STATES = Object.freeze(['Failed']);
export const QUIET_STATES = Object.freeze(['Building', 'Verifying']);

const ROLE_FACE = Object.freeze({
  pm: 'cang',
  architect: 'cang',
  'backend-dev': 'zuo',
  'frontend-dev': 'zuo',
  'qa-engineer': 'yan',
  'browser-tester': 'yan',
  reviewer: 'yan',
});

const EYE_PRIORITY = Object.freeze({
  alert: 50,
  await: 40,
  done: 30,
  focus: 20,
  inspect: 20,
  scan: 15,
  idle: 5,
  avert: 4,
  down: 3,
});

/**
 * @param {object} item
 * @returns {boolean}
 */
export function isDecisionItem(item) {
  if (!item) return false;
  if (DECISION_STATES.includes(item.state)) return true;
  if (FAILED_STATES.includes(item.state)) return true;
  if (item.pendingMerge === true) return true;
  if (MERGE_STATES.includes(item.state) && item.pendingMerge !== false) return true;
  return false;
}

function decisionRank(item) {
  if (item.state === 'AwaitingApproval' || item.state === 'Proposed') return 0;
  if (MERGE_STATES.includes(item.state) || item.pendingMerge) return 1;
  if (FAILED_STATES.includes(item.state)) return 2;
  return 3;
}

function idKey(item) {
  return String(item && item.id ? item.id : '');
}

/**
 * Split and order work items for the left console.
 * 「待你决定」 comes first: awaiting approval, pending merge, failed-to-handle.
 * @param {object[]} items
 * @returns {{ decisions: object[], history: object[] }}
 */
export function sortConsoleSections(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const decisions = list.filter(isDecisionItem).slice().sort((a, b) => {
    const rank = decisionRank(a) - decisionRank(b);
    return rank !== 0 ? rank : idKey(a).localeCompare(idKey(b));
  });
  const history = list.slice().sort((a, b) => idKey(a).localeCompare(idKey(b)));
  return { decisions, history };
}

/**
 * Health + authority block. Compact when healthy. Never invent Watchdog / subscribe data.
 * @param {object} [input]
 */
export function healthSummary(input = {}) {
  const authority = input.authority || DEFAULT_AUTHORITY;
  const paused = Boolean(input.paused);
  const healthy = input.healthy !== false && !paused;
  return {
    authority,
    autoMerge: false,
    autoMergeDisabled: AUTO_MERGE_DISABLED,
    compact: healthy && !paused,
    paused,
    healthy,
    watchdog: input.watchdogEnabled ? 'on' : '未启用',
    subscribe: input.subscribeEnabled ? 'on' : '未启用',
  };
}

/**
 * Speak policy for the native chat: process states stay quiet.
 * @param {object} workItem
 * @returns {{ ok: boolean, reason: string, kind: string | null }}
 */
export function chatSpeechFor(workItem) {
  const state = workItem && workItem.state;
  if (QUIET_STATES.includes(state)) {
    return { ok: false, reason: 'quiet-process', kind: null };
  }
  if (DECISION_STATES.includes(state)) {
    return { ok: true, reason: 'needs-decision', kind: 'approval' };
  }
  if (state === 'Delivered') {
    return { ok: true, reason: 'result-ready', kind: 'result' };
  }
  if (state === 'Failed') {
    return { ok: true, reason: 'failed', kind: 'result' };
  }
  return { ok: false, reason: 'quiet', kind: null };
}

/**
 * External IM still-frame: freeze motion, keep the presenceOf eye and caption.
 * @param {{ face: string, eye: string, motion: string, energy: string, caption: string }} presence
 */
export function stillFrameOf(presence) {
  if (!presence) return null;
  return {
    face: presence.face,
    eye: presence.eye,
    motion: 'still',
    energy: presence.energy,
    caption: presence.caption,
  };
}

export function speakKindFor(workItem) {
  const speech = chatSpeechFor(workItem);
  if (speech.kind === 'approval') return 'approval';
  if (speech.kind === 'result') return 'result';
  return undefined;
}

export function faceForRole(roleId) {
  return ROLE_FACE[roleId] || 'cang';
}

/**
 * Derive a work-item state from a 0.1.0 agent row. Used only when the ledger
 * has not supplied work items yet.
 */
export function workItemStateFromAgent(row) {
  if (!row) return 'Signal';
  if (row.waiting) return 'AwaitingApproval';
  if (row.failed || row.state === 'failed' || row.state === 'error') return 'Failed';
  if (row.running) {
    const face = faceForRole(row.role);
    if (face === 'yan') return 'Verifying';
    return 'Building';
  }
  if (row.state === 'done' || row.done) return 'Delivered';
  if (row.state === 'pending') return 'Planned';
  if (row.state === 'idle') return 'Signal';
  return 'Signal';
}

/**
 * @param {object[]} rows agent rows from the 0.1.0 panel
 * @param {object} [options]
 * @returns {object[]}
 */
export function workItemsFromAgents(rows, options = {}) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  return list.map((row) => ({
    id: row.workItemId || row.taskId || row.id,
    state: row.workItemState || workItemStateFromAgent(row),
    title: row.task || row.title || row.label || '',
    face: faceForRole(row.role),
    role: row.role,
    model: row.model || null,
    mandate: row.mandate || null,
    gates: row.gates || [],
    receipt: row.receipt || null,
    duration: row.elapsedMs || row.duration || null,
    authority: options.authority || DEFAULT_AUTHORITY,
    origin: 'agent-row',
  }));
}

/**
 * Prefer explicit work items (ledger / test fixture). Fall back to agent rows.
 * Never invent Watchdog numbers.
 * @param {{ workItems?: object[], rows?: object[], facts?: object, authority?: string }} input
 */
export function resolveWorkItems(input = {}) {
  if (Array.isArray(input.workItems) && input.workItems.length > 0) return input.workItems;
  const fromFacts = input.facts && (input.facts.workItems || input.facts.ledger);
  if (Array.isArray(fromFacts) && fromFacts.length > 0) return fromFacts;
  return workItemsFromAgents(input.rows || [], { authority: input.authority });
}

function scorePresence(presence) {
  const energyScore = presence.energy === 'high' ? 100 : presence.energy === 'mid' ? 50 : 0;
  return energyScore + (EYE_PRIORITY[presence.eye] || 0);
}

/**
 * Pick the strongest presenceOf result for one face across many work items.
 * @param {object[]} items
 * @param {string} face
 */
export function selectPresenceForFace(items, face) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length === 0) {
    return presenceOf({ workItem: { state: 'Signal' }, face });
  }
  let best = null;
  for (const workItem of list) {
    const presence = presenceOf({ workItem, face, speakKind: speakKindFor(workItem) });
    const score = scorePresence(presence);
    if (!best || score > best.score) best = { score, presence, workItem };
  }
  return best.presence;
}

/**
 * Four-face stage field for a set of work items, with the high-energy cap applied.
 * @param {object[]} items
 * @returns {Array<{ face: string, eye: string, motion: string, energy: string, caption: string, workItemId?: string }>}
 */
export function stageField(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const raw = {};
  const full = {};
  for (const face of FACES) {
    const presence = selectPresenceForFace(list, face);
    full[face] = presence;
    raw[face] = { eye: presence.eye, motion: presence.motion, energy: presence.energy };
  }
  const capped = capHighEnergy(raw);
  return FACES.map((face) => ({
    ...full[face],
    energy: capped[face].energy,
  }));
}

/**
 * The one-line caption shown on the stage and in the input dock: the highest
 * energy face, preferring 仓 when tied.
 */
export function stageCaption(items) {
  const field = stageField(items);
  const ranked = field.slice().sort((a, b) => {
    const diff = scorePresence(b) - scorePresence(a);
    if (diff !== 0) return diff;
    return FACES.indexOf(a.face) - FACES.indexOf(b.face);
  });
  const lead = ranked[0];
  if (!lead) return '';
  if (listIsIdle(field) && (!items || items.length === 0)) return '';
  return lead.caption;
}

function listIsIdle(field) {
  return field.every((item) => item.eye === 'idle' && item.energy === 'low');
}

export { FACES, ROLE_FACE };
