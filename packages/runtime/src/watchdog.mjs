/**
 * External control loop for progress, idle (空转), and cost (费用).
 * In the default observe mode it records would-accept actions
 * (revoke / park / halt) but does not mutate work items or mandates
 * and never auto-merges. No HTTP, no background network.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { listWorkItems, listMandates, isExpired } from '../../constitution/src/index.mjs';
import * as bus from './bus.mjs';
import { DEFAULT_AUTHORITY, recordWouldAccept, resolveAuthority } from './observe.mjs';
import { formatIso, parseIso } from './time.mjs';

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

/**
 * Start (or resume) a watchdog loop for a repository root.
 * @param {{ root: string, id?: string, idleAfterMinutes?: number, authority?: string, budgets?: object }} options
 */
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
    authority: resolveAuthority(options.authority ?? existing?.authority ?? DEFAULT_AUTHORITY),
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
  const authority = resolveAuthority(input.authority ?? loop.authority);
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

  for (const item of items) {
    const mandate = activeByItem.get(item.id) ?? null;
    const last = item.updatedAt ?? item.createdAt;
    const idleMinutes = last ? minutesBetween(last, at) : 0;
    const inFlight = ACTIVE_STATES.has(item.state);
    const row = {
      workItem: item.id,
      state: item.state,
      lastUpdate: last,
      idleMinutes,
      inFlight,
    };
    progress.push(row);

    if (inFlight && idleMinutes >= idleAfter) {
      const idleRow = { ...row, reason: 'idle-timeout' };
      idle.push(idleRow);
      if (authority === 'observe') {
        wouldAccept.push(recordWouldAccept(root, {
          action: 'park',
          workItem: item.id,
          reason: `idle for ${idleMinutes.toFixed(1)} minutes (threshold ${idleAfter})`,
          authority,
          would: { park: true, execute: false, merge: false },
          source: 'watchdog',
          details: idleRow,
        }));
      }
    }

    if (mandate && isExpired(mandate.expiresAt, now)) {
      if (authority === 'observe') {
        wouldAccept.push(recordWouldAccept(root, {
          action: 'revoke',
          workItem: item.id,
          reason: `mandate ${mandate.id} expired at ${mandate.expiresAt}`,
          authority,
          would: { revoke: true, execute: false, merge: false },
          source: 'watchdog',
          details: { mandate: mandate.id },
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
          reason: 'over budget',
          authority,
          would: { halt: true, execute: false, merge: false },
          source: 'watchdog',
          details: costRow,
        }));
      }
    }
  }

  const snapshot = { id, at, progress, idle, cost, wouldAccept, authority, executed: false };
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
