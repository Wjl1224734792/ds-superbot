/**
 * External control loop for progress, idle (空转), cost (费用), and
 * document drift. In the default observe mode (and hands-off `auto`)
 * it records would-accept actions (revoke / park / halt) but does not
 * mutate work items or mandates and never auto-merges.
 *
 * When a tick is explicitly run with `authority: 'execute'`, timeout /
 * idle / document drift may actually `revokeMandate` and transition the
 * work item to `Parked` (legal P5 edges only). P6 also treats a work
 * item as execute during tick when `canExecute(root, item)` is allowed
 * (an active human-issued Mandate), even if the loop default stays
 * `observe`. `itemAuthorities` / `workItemAuthority` may override a
 * single item. Unapproved items stay observe. Halt / over-budget stay
 * record-only even in execute. A missing snapshot is not treated as
 * drift. No HTTP, no background network, no git merge.
 * `loop.mjs` must not import this module.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  checkSnapshot,
  isExpired,
  isLegalTransition,
  listMandates,
  listWorkItems,
  revokeMandate,
  TERMINAL,
  transitionWorkItem,
} from '../../constitution/src/index.mjs';
import * as bus from './bus.mjs';
import { DEFAULT_AUTHORITY, recordWouldAccept, settleAuthority, isHandsOffAuthority } from './observe.mjs';
import { formatIso, parseIso } from './time.mjs';
import { canExecute } from './loop.mjs';

export const WATCHDOG_REL = '.superbot/ledger/watchdog';

const ACTIVE_STATES = new Set(['Authorized', 'Planned', 'Approved', 'Building', 'Verifying']);

function loopPath(root, id) {
  return join(root, WATCHDOG_REL, `${id}.json`);
}

function readLoop(root, id) {
  const file = loopPath(root, id);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeLoop(root, doc) {
  const file = loopPath(root, doc.id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return file;
}

function minutesBetween(from, to) {
  return (parseIso(to).getTime() - parseIso(from).getTime()) / 60000;
}

function boundSnapshotId(item, mandate) {
  return item?.constitution_snapshot || mandate?.constitution_snapshot || null;
}

/**
 * Reuse constitution snapshot hash staleness. If no snapshot is bound,
 * return null — do not invent a drift failure.
 */
export function detectDocumentDrift(root, item, mandate) {
  const id = boundSnapshotId(item, mandate);
  if (!id) return null;
  try {
    const check = checkSnapshot(root, id);
    if (check.ok) return null;
    return { snapshot: id, reason: 'snapshot-stale', check };
  } catch (err) {
    // A bound id that cannot be loaded is stale, not a reason to invent a new hash.
    return { snapshot: id, reason: 'snapshot-stale', check: { ok: false, error: err.message } };
  }
}

function pickRevokeReason({ drift, expired, idle }) {
  if (drift) return 'snapshot-stale';
  if (expired) return 'expired';
  if (idle) return 'timeout';
  return null;
}

function revokeAndPark(root, item, mandate, reason, now) {
  const actions = [];
  let revoked = null;
  let parked = null;
  if (mandate && !mandate.revokedAt) {
    revoked = revokeMandate(root, mandate.id, reason, { write: true, now }).document;
    actions.push({ type: 'revoke', workItem: item.id, mandate: mandate.id, reason });
    bus.append({
      root,
      type: bus.EVENT_TYPES.WATCHDOG_REVOKE,
      source: 'watchdog',
      workItem: item.id,
      payload: { mandate: mandate.id, reason },
    });
  }
  if (!TERMINAL.includes(item.state) && isLegalTransition(item.state, 'Parked')) {
    const from = item.state;
    parked = transitionWorkItem(root, item.id, 'Parked', { write: true, now }).document;
    actions.push({ type: 'park', workItem: item.id, from, reason });
    bus.append({
      root,
      type: bus.EVENT_TYPES.WATCHDOG_PARK,
      source: 'watchdog',
      workItem: item.id,
      payload: { from, reason },
    });
  }
  return { revoked, parked, actions };
}

/**
 * Start (or resume) a watchdog loop for a repository root.
 * @param {{ root: string, id?: string, idleAfterMinutes?: number, authority?: string, budgets?: object }} options
 */

function explicitItemAuthority(input, itemId) {
  if (input.itemAuthorities && Object.prototype.hasOwnProperty.call(input.itemAuthorities, itemId)) {
    return { explicit: true, value: input.itemAuthorities[itemId] };
  }
  if (input.workItemAuthority && Object.prototype.hasOwnProperty.call(input.workItemAuthority, itemId)) {
    return { explicit: true, value: input.workItemAuthority[itemId] };
  }
  return { explicit: false, value: undefined };
}

function itemHasExecuteGrant(root, item, now) {
  if (!root || !item) return false;
  try {
    return canExecute(root, item, { now }).allowed === true;
  } catch {
    return false;
  }
}

export function start(options = {}) {
  const root = options.root;
  if (!root) throw new Error('watchdog.start requires root');
  const id = options.id ?? 'default';
  const existing = readLoop(root, id);
  const now = options.now ?? new Date();
  const doc = {
    schemaVersion: 1,
    id,
    root,
    status: 'running',
    startedAt: existing?.startedAt ?? formatIso(now),
    stoppedAt: null,
    lastTickAt: existing?.lastTickAt ?? null,
    ticks: existing?.ticks ?? 0,
    idleAfterMinutes: options.idleAfterMinutes ?? existing?.idleAfterMinutes ?? 15,
    authority: settleAuthority(options.authority ?? existing?.authority ?? DEFAULT_AUTHORITY, {
      root,
      action: 'watchdog',
    }).authority,
    budgets: options.budgets ?? existing?.budgets ?? null,
  };
  writeLoop(root, doc);
  return doc;
}

/**
 * Inspect work items, mandates, and optional usage snapshots.
 * Records progress / idle / cost events. In observe mode, overdue
 * revoke or park actions are would-accept only.
 *
 * @param {{ root?: string, id?: string, usage?: object, now?: Date, authority?: string }|string} state
 */
export function tick(state = {}) {
  const input = typeof state === 'string' ? { id: state } : state;
  const root = input.root ?? input.loop?.root;
  if (!root) throw new Error('watchdog.tick requires root');
  const id = input.id ?? input.loop?.id ?? 'default';
  let loop = readLoop(root, id);
  if (!loop || loop.status !== 'running') {
    loop = start({ root, id, authority: input.authority, idleAfterMinutes: input.idleAfterMinutes, now: input.now });
  }
  const now = input.now ?? new Date();
  const at = formatIso(now);
  const authority = settleAuthority(input.authority ?? loop.authority, {
    root,
    action: 'watchdog',
  }).authority;
  const idleAfter = Number(input.idleAfterMinutes ?? loop.idleAfterMinutes ?? 15);
  const usage = input.usage ?? {};

  const items = listWorkItems(root);
  const mandates = listMandates(root);
  const activeByItem = new Map();
  for (const m of mandates) {
    if (!m.revokedAt) activeByItem.set(m.workItem, m);
  }

  const progress = [];
  const idle = [];
  const cost = [];
  const wouldAccept = [];
  const actions = [];
  const drift = [];

  for (const item of items) {
    const mandate = activeByItem.get(item.id) ?? null;
    const last = item.updatedAt ?? item.createdAt;
    const idleMinutes = last ? minutesBetween(last, at) : 0;
    const inFlight = ACTIVE_STATES.has(item.state);
    const override = explicitItemAuthority(input, item.id);
    const requestedForItem = override.explicit
      ? override.value
      : (itemHasExecuteGrant(root, item, now) ? 'execute' : authority);
    const itemAuthority = settleAuthority(requestedForItem, {
      root,
      action: 'watchdog',
    }).authority;
    const handsOff = isHandsOffAuthority(itemAuthority);
    const row = {
      workItem: item.id,
      state: item.state,
      lastUpdate: last,
      idleMinutes,
      inFlight,
    };
    progress.push(row);

    const isIdle = inFlight && idleMinutes >= idleAfter;
    if (isIdle) {
      const idleRow = { ...row, reason: 'idle-timeout' };
      idle.push(idleRow);
      if (handsOff) {
        wouldAccept.push(recordWouldAccept(root, {
          action: 'park',
          workItem: item.id,
          risk: item.risk ?? null,
          reason: `idle for ${idleMinutes.toFixed(1)} minutes (threshold ${idleAfter})`,
          authority: itemAuthority,
          would: { park: true, execute: false, merge: false },
          source: 'watchdog',
          details: idleRow,
        }));
      }
    }

    const expired = Boolean(mandate && isExpired(mandate.expiresAt, now));
    if (expired && handsOff) {
      wouldAccept.push(recordWouldAccept(root, {
        action: 'revoke',
        workItem: item.id,
        risk: item.risk ?? null,
        reason: `mandate ${mandate.id} expired at ${mandate.expiresAt}`,
        authority: itemAuthority,
        would: { revoke: true, execute: false, merge: false },
        source: 'watchdog',
        details: { mandate: mandate.id },
      }));
    }

    const driftHit = detectDocumentDrift(root, item, mandate);
    if (driftHit) {
      drift.push({ workItem: item.id, ...driftHit });
      if (handsOff) {
        wouldAccept.push(recordWouldAccept(root, {
          action: 'revoke',
          workItem: item.id,
          risk: item.risk ?? null,
          reason: `constitution snapshot ${driftHit.snapshot} is stale`,
          authority: itemAuthority,
          would: { revoke: true, park: true, execute: false, merge: false },
          source: 'watchdog',
          details: driftHit,
        }));
      }
    }

    const used = usage[item.id] ?? usage[mandate?.id] ?? null;
    if (used && mandate?.budget) {
      const tokens = Number(used.tokens ?? 0);
      const minutes = Number(used.minutes ?? 0);
      const tokenBudget = Number(mandate.budget.tokens ?? 0);
      const minuteBudget = Number(mandate.budget.minutes ?? 0);
      const over = (tokenBudget > 0 && tokens >= tokenBudget) || (minuteBudget > 0 && minutes >= minuteBudget);
      const costRow = {
        workItem: item.id,
        mandate: mandate.id,
        tokens,
        minutes,
        tokenBudget,
        minuteBudget,
        overBudget: over,
      };
      cost.push(costRow);
      if (over) {
        wouldAccept.push(recordWouldAccept(root, {
          action: 'halt',
          workItem: item.id,
          risk: item.risk ?? null,
          reason: 'over budget',
          authority: itemAuthority,
          would: { halt: true, execute: false, merge: false },
          source: 'watchdog',
          details: costRow,
        }));
      }
    }

    if (!handsOff && itemAuthority === 'execute') {
      const reason = pickRevokeReason({ drift: driftHit, expired, idle: isIdle });
      if (reason) {
        const acted = revokeAndPark(root, item, mandate, reason, now);
        actions.push(...acted.actions);
        if (acted.revoked) activeByItem.delete(item.id);
      }
    }
  }

  const executed = actions.length > 0;
  const snapshot = { id, at, progress, idle, cost, wouldAccept, drift, actions, authority, executed };
  bus.append({ root, type: bus.EVENT_TYPES.WATCHDOG_TICK, source: 'watchdog', payload: { id, progress: progress.length, idle: idle.length, cost: cost.length } });
  for (const row of progress) {
    if (row.inFlight) {
      bus.append({ root, type: bus.EVENT_TYPES.WATCHDOG_PROGRESS, source: 'watchdog', workItem: row.workItem, payload: row });
    }
  }
  for (const row of idle) {
    bus.append({ root, type: bus.EVENT_TYPES.WATCHDOG_IDLE, source: 'watchdog', workItem: row.workItem, payload: row });
  }
  for (const row of cost) {
    bus.append({ root, type: bus.EVENT_TYPES.WATCHDOG_COST, source: 'watchdog', workItem: row.workItem, payload: row });
  }

  loop.lastTickAt = at;
  loop.ticks = (loop.ticks ?? 0) + 1;
  loop.authority = authority;
  writeLoop(root, loop);
  return { ...snapshot, loop };
}

export function stop(idOrOptions, maybeOptions) {
  const options = typeof idOrOptions === 'string'
    ? { ...(maybeOptions ?? {}), id: idOrOptions }
    : (idOrOptions ?? {});
  const root = options.root;
  if (!root) throw new Error('watchdog.stop requires root');
  const id = options.id ?? 'default';
  const loop = readLoop(root, id);
  if (!loop) throw new Error(`watchdog loop not found: ${id}`);
  loop.status = 'stopped';
  loop.stoppedAt = formatIso(options.now ?? new Date());
  writeLoop(root, loop);
  return loop;
}

export function getLoop(root, id = 'default') {
  return readLoop(root, id);
}
