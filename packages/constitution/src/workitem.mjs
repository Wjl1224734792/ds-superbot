/**
 * Work item CRUD and the legal state machine. Illegal transitions fail loudly.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from './errors.mjs';
import { isThreadId, isWorkItemId, nextWorkItemId } from './ids.mjs';
import { listDocuments, readDocument, saveDocument } from './ledger.mjs';
import { evalPolicy } from './policy.mjs';
import { activeMandateFor, assertUsableMandate } from './mandate.mjs';
import { getReceipt, listReceipts, markReceiptsStale } from './receipt.mjs';
import { loadSchema, assertValid, validate } from './schema.mjs';
import { checkSnapshot, createSnapshot } from './snapshot.mjs';
import { formatIso } from './time.mjs';
import { addItemToThread, getThread } from './thread.mjs';

export const STATES = Object.freeze([
  'Signal', 'Candidate', 'Dropped', 'Explored', 'Proposed', 'AwaitingApproval',
  'Authorized', 'Parked', 'Planned', 'Approved', 'Building', 'Verifying',
  'Delivered', 'Failed',
]);

export const TERMINAL = Object.freeze(['Dropped', 'Parked', 'Delivered', 'Failed']);

/**
 * States that may legally enter Parked.
 * Goal §5 lists AwaitingApproval → Parked (人否决) and Building → Parked
 * (人叫停，同时吊销 Mandate). P5 extends Parked to the other in-flight
 * states so Watchdog (execute) and a human stop can Park without a
 * silent illegal transition: Proposed (console 否决), Authorized,
 * Planned, Approved, and Verifying.
 */
export const PARK_FROM = Object.freeze([
  'Proposed', 'AwaitingApproval', 'Authorized', 'Planned', 'Approved', 'Building', 'Verifying',
]);

const VAGUE_AC = [/体验好/, /功能正常/];

/** from -> to -> optional checker. Missing edge = illegal. */
const TRANSITIONS = {
  Signal: { Candidate: allow },
  Candidate: { Dropped: allow, Explored: allow },
  Explored: { Proposed: requireProposed },
  Proposed: { Authorized: requireAutoAuthorize, AwaitingApproval: allow, Parked: allow },
  AwaitingApproval: { Authorized: requireHumanAuthorize, Parked: allow },
  Authorized: { Planned: requirePlanned, Parked: allow },
  Planned: { Approved: requireApproved, AwaitingApproval: allow, Parked: allow },
  Approved: { Building: requireBuilding, Parked: allow },
  Building: { Verifying: allow, Failed: allow, Parked: allow },
  Verifying: { Delivered: requireDelivered, Building: allow, Failed: allow, Parked: allow },
};

/**
 * Whether a state change is in the legal table (same-state is always legal).
 * Terminal states cannot leave themselves.
 */
export function isLegalTransition(from, to) {
  if (from === to) return true;
  if (TERMINAL.includes(from) && from !== to) return false;
  return Boolean(TRANSITIONS[from]?.[to]);
}

function allow() {}

export function getWorkItem(root, id) {
  if (!isWorkItemId(id)) fail('WORKITEM', `invalid work item id: ${id}`);
  return readDocument(root, 'workitem', id);
}

export function listWorkItems(root) {
  return listDocuments(root, 'workitem');
}

function rejectVagueAc(ac) {
  for (const item of ac ?? []) {
    const text = String(item.text ?? '');
    for (const pat of VAGUE_AC) {
      if (pat.test(text)) fail('WORKITEM', `AC ${item.id} is not decidable: "${text}"`);
    }
  }
}

function assertOrigin(origin) {
  if (!origin || (origin.kind !== 'human' && origin.kind !== 'trigger')) {
    fail('WORKITEM', 'origin.kind must be human or trigger');
  }
  if (origin.kind === 'trigger' && !(origin.evidence && origin.evidence.length)) {
    fail('WORKITEM', 'trigger origin must carry non-empty evidence');
  }
}

function assertAuthority(risk, authority) {
  if ((risk === 'R2' || risk === 'R3') && authority !== 'human-approval') {
    fail('WORKITEM', `risk ${risk} requires authority human-approval`);
  }
}

export function createWorkItem(root, input, { write = false } = {}) {
  const now = formatIso();
  const existingIds = listWorkItems(root).map((w) => w.id);
  const id = input.id ?? nextWorkItemId(existingIds);
  if (getWorkItem(root, id)) fail('WORKITEM', `work item already exists: ${id}`);
  if (!isThreadId(input.thread)) fail('WORKITEM', `invalid thread id: ${input.thread}`);
  if (write && !getThread(root, input.thread)) {
    fail('WORKITEM', `thread not found: ${input.thread}`);
  }

  const risk = input.risk ?? 'R2';
  const authority = input.authority ?? ((risk === 'R2' || risk === 'R3') ? 'human-approval' : 'policy:auto-low');
  assertOrigin(input.origin ?? { kind: 'human', ref: 'manual', evidence: [] });
  rejectVagueAc(input.ac);
  assertAuthority(risk, authority);

  const document = {
    schemaVersion: 1,
    id,
    thread: input.thread,
    origin: {
      kind: input.origin?.kind ?? 'human',
      ref: input.origin?.ref ?? 'manual',
      evidence: [...(input.origin?.evidence ?? [])],
    },
    intent: String(input.intent ?? '').trim(),
    ac: Array.isArray(input.ac) ? input.ac.map((a) => ({
      id: a.id,
      text: a.text,
      coveredBy: [...(a.coveredBy ?? [])],
    })) : [],
    nonGoals: [...(input.nonGoals ?? [])],
    scope: {
      files: [...(input.scope?.files ?? [])],
      newFiles: [...(input.scope?.newFiles ?? [])],
      owners: [...(input.scope?.owners ?? [])],
    },
    risk,
    reversible: Boolean(input.reversible),
    authority,
    gates: [...(input.gates ?? ['validate-plan', 'verify'])],
    state: input.state ?? 'Signal',
    constitution_snapshot: input.constitution_snapshot ?? null,
    mandate: input.mandate ?? null,
    plan: input.plan ?? null,
    receipts: [...(input.receipts ?? [])],
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
  if (input.intentAmbiguous != null) document.intentAmbiguous = Boolean(input.intentAmbiguous);
  if (Array.isArray(input.touches)) document.touches = [...input.touches];

  assertValid(document, loadSchema('workitem'), 'workitem');
  const saved = saveDocument(root, 'workitem', document, { write });
  if (write) addItemToThread(root, document.thread, document.id, { write: true });
  return saved;
}

export function saveWorkItem(root, document, { write = false } = {}) {
  document = { ...document, updatedAt: formatIso() };
  assertValid(document, loadSchema('workitem'), 'workitem');
  return saveDocument(root, 'workitem', document, { write });
}

function requireProposed(root, item) {
  if (!item.ac?.length) fail('TRANSITION', 'Explored → Proposed requires at least one AC');
  rejectVagueAc(item.ac);
}

function bindSnapshot(root, item, options) {
  const created = createSnapshot(root, { write: options.write });
  item.constitution_snapshot = created.document.id;
  return created.document.id;
}

function requireAutoAuthorize(root, item, options) {
  const policy = evalPolicy(root, item);
  const riskRank = { R0: 0, R1: 1, R2: 2, R3: 3 }[item.risk] ?? 99;
  if (policy.requireHuman || riskRank >= 2 || !item.reversible) {
    fail(
      'TRANSITION',
      `R2/R3 or Policy requireHuman cannot enter Authorized without human approval (rule=${policy.id})`,
      { policy: policy.id, requireHuman: policy.requireHuman, risk: item.risk },
    );
  }
  item.authority = `policy:${policy.id}`;
  bindSnapshot(root, item, options);
}

function requireHumanAuthorize(root, item, options) {
  if (!options.approvedBy) {
    fail('TRANSITION', 'AwaitingApproval → Authorized requires a human approvedBy');
  }
  item.authority = 'human-approval';
  bindSnapshot(root, item, options);
}

function requirePlanned(root, item) {
  const planPath = item.plan;
  if (!planPath) fail('TRANSITION', 'Authorized → Planned requires a plan path');
  const abs = join(root, planPath);
  if (!existsSync(abs)) fail('TRANSITION', `plan file not found: ${planPath}`);
  let plan;
  try {
    plan = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    fail('TRANSITION', `plan is not valid JSON: ${err.message}`);
  }
  const checked = validate(plan, loadSchema('plan'));
  if (!checked.ok) fail('TRANSITION', `plan failed schema: ${checked.errors.join('; ')}`);
  const taskIds = new Set((plan.tasks ?? []).map((t) => t.id));
  for (const ac of item.ac ?? []) {
    if (!ac.coveredBy?.length) fail('TRANSITION', `AC ${ac.id} must have coveredBy after Planned`);
    for (const task of ac.coveredBy) {
      if (!taskIds.has(task)) fail('TRANSITION', `AC ${ac.id} coveredBy unknown task ${task}`);
    }
  }
}

function requireApproved(root, item) {
  if (!item.plan) fail('TRANSITION', 'Planned → Approved requires a plan');
  const riskRank = { R0: 0, R1: 1, R2: 2, R3: 3 }[item.risk] ?? 99;
  if (riskRank >= 2) {
    const mandate = activeMandateFor(root, item.id);
    if (!mandate) fail('TRANSITION', 'R2/R3 Planned → Approved requires an active human-approved Mandate');
    if (mandate && item.authority !== 'human-approval') {
      fail('TRANSITION', 'R2/R3 Planned → Approved requires authority human-approval');
    }
    item.mandate = mandate.id;
  }
  // validate-plan exit 0 is enforced by the caller passing { planValid: true }
  // or by running the gate. If a plan file exists we also schema-checked on
  // entering Planned; here we require an explicit or prior pass receipt.
  if (item._planValid === true) return;
  const receipts = listReceipts(root, item.id);
  const latest = receipts.filter((r) => r.gate === 'validate-plan').at(-1);
  if (latest && latest.status === 'pass' && latest.exitCode === 0) return;
  fail('TRANSITION', 'Planned → Approved requires validate-plan exit 0');
}

function requireBuilding(root, item, options = {}) {
  assertUsableMandate(root, item.id, options.now ?? new Date());
  const mandate = activeMandateFor(root, item.id);
  item.mandate = mandate.id;
}

function requireDelivered(root, item) {
  if (item.constitution_snapshot) {
    const check = checkSnapshot(root, item.constitution_snapshot);
    if (!check.ok) {
      if (item.receipts?.length) {
        markReceiptsStale(root, item.receipts, { write: true, reason: 'snapshot-stale' });
      }
      fail('SNAPSHOT_STALE', `snapshot ${item.constitution_snapshot} is stale`, check);
    }
  }
  const needed = item.gates ?? [];
  const receipts = listReceipts(root, item.id);
  for (const gate of needed) {
    const latest = receipts.filter((r) => r.gate === gate).at(-1);
    if (!latest || latest.status !== 'pass') {
      fail('TRANSITION', `Verifying → Delivered requires gate ${gate} to be pass`);
    }
  }
}

export function transitionWorkItem(root, id, to, options = {}) {
  const write = Boolean(options.write);
  const current = getWorkItem(root, id);
  if (!current) fail('WORKITEM', `work item not found: ${id}`);
  if (TERMINAL.includes(current.state) && current.state !== to) {
    fail('TRANSITION', `work item ${id} is in terminal state ${current.state}`);
  }
  if (current.state === to) {
    return saveDocument(root, 'workitem', current, { write });
  }
  const table = TRANSITIONS[current.state];
  const checker = table?.[to];
  if (!checker) {
    fail('TRANSITION', `illegal state transition ${current.state} → ${to}`);
  }

  const next = { ...current };
  if (options.plan) next.plan = options.plan;
  if (options.planValid != null) next._planValid = options.planValid;
  if (Array.isArray(options.ac)) next.ac = options.ac;
  if (options.mandate) next.mandate = options.mandate;

  // Refresh stale receipts when a snapshot is already bound.
  if (next.constitution_snapshot) {
    const check = checkSnapshot(root, next.constitution_snapshot);
    if (!check.ok && next.receipts?.length) {
      markReceiptsStale(root, next.receipts, { write, reason: 'snapshot-stale' });
    }
  }

  checker(root, next, options);
  delete next._planValid;
  next.state = to;
  next.updatedAt = formatIso();
  assertValid(next, loadSchema('workitem'), 'workitem');
  return saveDocument(root, 'workitem', next, { write });
}
