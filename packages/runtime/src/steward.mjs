/**
 * Steward: assign, compile intent, speak allowlisting, and intake.
 * Steward does not execute work, does not judge gates, and does not
 * auto-merge. Default authority is observe: propose candidates and
 * record would-accept, even when nobody @-mentioned the bot.
 *
 * Decision logic uses lightweight rules. createModelPort() is the
 * reserved model interface; the default port never calls a network.
 */
import { create as createAssignment } from './assignment.mjs';
import * as bus from './bus.mjs';
import { fastPath, slowPath } from './filter.mjs';
import { createModelPort, RULES_MODEL, rulesComplete } from './model.mjs';
import { compileMandate } from './compiler.mjs';
import { assertNoAutoMerge, recordWouldAccept, settleAuthority } from './observe.mjs';

import { formatIso } from './time.mjs';
import {
  createThread, createWorkItem, getThread,
  getWorkItem, transitionWorkItem,
} from '../../constitution/src/index.mjs';

const SPEAK_EVENTS = new Set(['needs-decision', 'result-ready', 'failed']);

export { createModelPort, RULES_MODEL, rulesComplete, compileMandate };

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
 * Structured intent compilation via the Capability Compiler.
 * On success `via` is `compiler`; on failure it falls back to the
 * matching `roles/*.md` templates with `via: 'fallback'`. A reserved
 * model port may refine the draft; it cannot issue a mandate or mark
 * gates as passed. The default port never calls a network.
 * @returns {{ planNeeds: object, mandateDraft: object, via: string, reason: string|null, assembly: object, issued: false }}
 */
export function compileIntent(workItem, snapshot, model, options) {
  if (!workItem) throw new Error('compileIntent requires a work item');
  let modelPort = model;
  let opts = options ?? {};
  if (model && typeof model === 'object' && typeof model.completeSync !== 'function' && typeof model.complete !== 'function') {
    opts = model;
    modelPort = opts.model ?? null;
  }
  return compileMandate(workItem, snapshot, { ...opts, model: modelPort });
}

/** @deprecated use compileIntent */
export function compile(workItem, snapshot, model) {
  return compileIntent(workItem, snapshot, model);
}

/**
 * Prepare an isolated assignment. In observe mode (the default) this
 * only records would-accept and never starts a process or merges.
 */
export function assign(input = {}) {
  if (!input.workItem?.id) throw new Error('steward.assign requires a work item');
  assertNoAutoMerge(input.action);
  const settled = settleAuthority(input.authority, {
    root: input.root,
    action: 'assign',
    risk: input.workItem?.risk ?? input.risk,
    reversible: input.workItem?.reversible ?? input.reversible,
    touches: input.workItem?.touches ?? input.touches,
    requireHuman: input.requireHuman,
    itemAuthority: input.workItem?.authority,
    workItem: input.workItem,
  });
  const authority = settled.authority;
  const assignment = createAssignment({
    workItem: input.workItem,
    mandate: input.mandate,
    runId: input.runId,
  });
  const record = {
    assignment,
    executed: false,
    started: false,
    authority,
    wouldAccept: authority === 'observe' || authority === 'auto',
    workItem: input.workItem.id,
    auto: settled.auto,
  };
  if (input.root) {
    record.wouldAcceptEvent = recordWouldAccept(input.root, {
      action: 'assign',
      workItem: input.workItem.id,
      risk: input.workItem?.risk ?? input.risk ?? null,
      reason: authority === 'auto'
        ? 'steward.assign entered auto grayscale but does not start a worker or merge'
        : 'steward.assign in observe mode does not start a worker',
      authority: authority === 'auto' ? 'observe' : authority,
      would: { assign: true, execute: false, merge: false },
      source: 'steward',
      details: { workDir: assignment.workDir, toolsWhitelist: assignment.toolsWhitelist },
    });
  }
  return record;
}

function slugFrom(signal) {
  const raw = String(signal.threadSlug ?? signal.channel ?? signal.source ?? 'inbox')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return raw || 'inbox';
}

function ensureThread(root, slug, signal) {
  const id = `TH-${slug}`;
  if (getThread(root, id)) return id;
  createThread(root, {
    slug,
    title: String(signal.title ?? signal.intent ?? signal.text ?? slug).slice(0, 200),
    channels: signal.channels ?? (signal.ref ? [signal.ref] : []),
  }, { write: true });
  return id;
}

/**
 * Intake a signal: L1 + L2, then (if accepted) create a Candidate
 * work item. Nobody has to @-mention the bot for a candidate to be
 * proposed. Nothing is executed. Default authority is observe, so a
 * would-accept record is always written for the proposal.
 *
 * @param {object} signal
 * @param {{ root: string, authority?: string, rules?: object, policy?: object, model?: object }} [ctx]
 */
export function consider(signal = {}, ctx = {}) {
  const root = ctx.root ?? signal.root;
  if (!root) throw new Error('steward.consider requires root');
  const settled = settleAuthority(ctx.authority ?? signal.authority, {
    root,
    action: 'propose-candidate',
    risk: signal.risk,
    reversible: signal.reversible,
    touches: signal.touches,
    requireHuman: signal.requireHuman,
    itemAuthority: signal.itemAuthority,
    workItem: signal.workItem,
  });
  const authority = settled.authority;
  const mentioned = Boolean(signal.mentioned ?? signal.atMentioned);
  const model = ctx.model ?? RULES_MODEL;

  const ev = bus.append({
    root,
    type: bus.EVENT_TYPES.SIGNAL,
    source: signal.source ?? signal.kind ?? 'unknown',
    mentioned,
    payload: {
      text: signal.text ?? signal.intent ?? '',
      sender: signal.sender ?? null,
      ref: signal.ref ?? null,
      mentioned,
    },
    at: signal.at ?? formatIso(),
  });

  const l1 = fastPath(signal, ctx.rules);
  if (!l1.accept) {
    return {
      accepted: false,
      stage: 'l1',
      reason: l1.reason,
      workItem: null,
      executed: false,
      mentioned,
      event: ev,
      authority,
    };
  }

  const l2 = slowPath(signal, ctx.policy, model);
  if (!l2.accept) {
    return {
      accepted: false,
      stage: 'l2',
      reason: l2.reason,
      workItem: null,
      executed: false,
      mentioned,
      event: ev,
      authority,
    };
  }

  const slug = slugFrom(signal);
  const thread = ensureThread(root, slug, signal);
  const risk = signal.risk && ['R0', 'R1', 'R2', 'R3'].includes(signal.risk) ? signal.risk : (l2.risk ?? 'R2');
  const reversible = signal.reversible ?? l2.reversible ?? true;
  const originKind = mentioned && (signal.origin?.kind === 'human' || signal.source === 'human' || signal.source === 'group' || !signal.source)
    ? 'human'
    : 'trigger';
  const created = createWorkItem(root, {
    thread,
    intent: String(signal.intent ?? signal.text).trim(),
    risk,
    reversible,
    authority: (risk === 'R2' || risk === 'R3' || l2.requireHuman) ? 'human-approval' : (signal.itemAuthority ?? 'policy:auto-low'),
    ac: signal.ac ?? [],
    nonGoals: signal.nonGoals ?? [],
    scope: signal.scope ?? { files: [], newFiles: [], owners: [] },
    gates: signal.gates,
    origin: {
      kind: originKind,
      ref: signal.origin?.ref ?? signal.ref ?? `${signal.source ?? 'signal'}:${ev.id}`,
      evidence: originKind === 'trigger'
        ? (signal.origin?.evidence?.length ? signal.origin.evidence : [ev.id])
        : [...(signal.origin?.evidence ?? [])],
    },
    state: 'Signal',
    touches: signal.touches,
    intentAmbiguous: signal.intentAmbiguous,
  }, { write: true }).document;

  const moved = transitionWorkItem(root, created.id, 'Candidate', { write: true }).document;

  const would = recordWouldAccept(root, {
    action: 'propose-candidate',
    workItem: moved.id,
    risk,
    reason: mentioned ? 'signal-with-mention' : 'signal-without-mention',
    mentioned,
    authority: authority === 'auto' ? 'observe' : authority,
    policy: l2.policy,
    would: { propose: true, execute: false, merge: false, assign: false },
    source: 'steward',
    details: { l1, l2, eventId: ev.id },
  });

  bus.append({
    root,
    type: bus.EVENT_TYPES.CANDIDATE,
    source: 'steward',
    workItem: moved.id,
    mentioned,
    payload: { eventId: ev.id, reason: would.reason, state: moved.state },
  });

  return {
    accepted: true,
    stage: 'candidate',
    reason: l2.reason,
    workItem: getWorkItem(root, moved.id),
    executed: false,
    mentioned,
    event: ev,
    wouldAccept: would,
    authority,
    l1,
    l2,
  };
}
