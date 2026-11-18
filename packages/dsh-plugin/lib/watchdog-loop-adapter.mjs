/**
 * P7 Watchdog loop: after a successful human `approveDecision`, start
 * the loop document with authority `observe` and arm a host-side timer
 * that calls `watchdog.tick({ root })`. Tick once immediately, then on
 * an interval (default 30s). P6 already treats `canExecute` items as
 * execute during tick; this adapter does not change that.
 *
 * Missing scheduler must not roll back an already-issued Mandate — it
 * reports clearly that the loop could not be armed. Reject does not
 * start an execute loop. `console-model.mjs` stays a pure view helper.
 * No HTTP, no background network.
 */
import { listWorkItems } from '../../constitution/src/index.mjs';
import { canExecute, DEFAULT_AUTHORITY } from '../../runtime/src/loop.mjs';
import * as watchdog from '../../runtime/src/watchdog.mjs';
import {
  clearArmedTimer,
  disarmAllWatchdogTimers,
  getArmedLoop,
  isTimerArmed,
  listArmedLoops,
  setArmedLoop,
} from './watchdog-timers.mjs';

export const DEFAULT_WATCHDOG_INTERVAL_MS = 30_000;
export const WATCHDOG_INTERVAL_ENV = 'SUPERBOT_WATCHDOG_INTERVAL_MS';

export function resolveWatchdogInterval(options = {}) {
  const requested = Number(options.intervalMs);
  if (Number.isFinite(requested) && requested > 0) return requested;
  const envRaw = options.env?.[WATCHDOG_INTERVAL_ENV] ?? process.env[WATCHDOG_INTERVAL_ENV];
  const env = Number(envRaw);
  if (Number.isFinite(env) && env > 0) return env;
  return DEFAULT_WATCHDOG_INTERVAL_MS;
}

/**
 * Resolve a scheduler. Tests inject `{ setInterval, clearInterval }` so
 * ticks can be driven without waiting. A missing `setInterval` returns null.
 */
export function resolveScheduler(options = {}) {
  if (options.scheduler === null || options.setInterval === null) return null;
  if (options.scheduler && typeof options.scheduler.setInterval === 'function') {
    return {
      setInterval: options.scheduler.setInterval.bind(options.scheduler),
      clearInterval: typeof options.scheduler.clearInterval === 'function'
        ? options.scheduler.clearInterval.bind(options.scheduler)
        : () => {},
    };
  }
  const setI = options.setInterval ?? globalThis.setInterval;
  const clearI = options.clearInterval ?? globalThis.clearInterval;
  if (typeof setI !== 'function') return null;
  return {
    setInterval: setI,
    clearInterval: typeof clearI === 'function' ? clearI : () => {},
  };
}

export function isWatchdogLoopArmed(root, id = 'default') {
  return isTimerArmed(root, id);
}

export function hasExecutableWorkItems(root, options = {}) {
  if (!root) return false;
  try {
    return listWorkItems(root).some((item) => canExecute(root, item, { now: options.now }).allowed);
  } catch {
    return false;
  }
}


/**
 * Start the loop document (authority observe), tick once immediately,
 * then arm the interval. Reuses an existing timer for the same root/id.
 *
 * @param {string} root
 * @param {{
 *   id?: string,
 *   now?: Date,
 *   intervalMs?: number,
 *   scheduler?: { setInterval: Function, clearInterval?: Function },
 *   setInterval?: Function,
 *   clearInterval?: Function,
 *   idleAfterMinutes?: number,
 *   nowFn?: () => Date,
 *   env?: object,
 * }} [options]
 */
export function armWatchdogLoop(root, options = {}) {
  if (!root) {
    return {
      started: false,
      armed: false,
      mandatePreserved: true,
      reason: '缺少仓库根，Mandate 已签发，Watchdog 循环未能武装',
      loop: null,
      firstTick: null,
      intervalMs: resolveWatchdogInterval(options),
      authority: DEFAULT_AUTHORITY,
    };
  }
  const id = options.id ?? 'default';
  const intervalMs = resolveWatchdogInterval(options);

  const doc = watchdog.start({
    root,
    id,
    authority: 'observe',
    now: options.now,
    idleAfterMinutes: options.idleAfterMinutes,
  });

  let firstTick = null;
  let tickError = null;
  try {
    firstTick = watchdog.tick({
      root,
      id,
      now: options.now,
      authority: options.tickAuthority,
    });
  } catch (error) {
    tickError = error instanceof Error ? error.message : String(error);
  }

  const existing = getArmedLoop(root, id);
  if (existing?.timer != null) {
    return {
      started: true,
      armed: true,
      reused: true,
      mandatePreserved: true,
      reason: null,
      loop: doc,
      firstTick,
      tickError,
      intervalMs: existing.intervalMs,
      authority: doc.authority ?? 'observe',
    };
  }

  const scheduler = resolveScheduler(options);
  if (!scheduler) {
    return {
      started: true,
      armed: false,
      reused: false,
      mandatePreserved: true,
      reason: '调度器不可用，Mandate 已签发，Watchdog 循环未能武装',
      loop: doc,
      firstTick,
      tickError,
      intervalMs,
      authority: doc.authority ?? 'observe',
    };
  }

  const timer = scheduler.setInterval(() => {
    try {
      const now = typeof options.nowFn === 'function' ? options.nowFn() : undefined;
      watchdog.tick({ root, id, ...(now ? { now } : {}) });
    } catch {
      // keep the interval alive; a single tick failure is not a stop
    }
  }, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();

  setArmedLoop(root, id, { timer, scheduler, root, id, intervalMs });
  return {
    started: true,
    armed: true,
    reused: false,
    mandatePreserved: true,
    reason: null,
    loop: doc,
    firstTick,
    tickError,
    intervalMs,
    timer,
    authority: doc.authority ?? 'observe',
  };
}

export function disarmWatchdogLoop(root, options = {}) {
  const id = options.id ?? 'default';
  const { had } = clearArmedTimer(root, id);
  let loop = null;
  let stopped = false;
  if (root) {
    try {
      const existing = watchdog.getLoop(root, id);
      if (existing && existing.status !== 'stopped') {
        loop = watchdog.stop({ root, id, now: options.now });
        stopped = true;
      } else {
        loop = existing;
      }
    } catch {
      loop = null;
    }
  }
  return { stopped, cleared: had, loop };
}

/**
 * After a reject, stop the loop if no remaining human-approved item
 * still has an execute grant.
 */
export function disarmIfNoExecutable(root, options = {}) {
  if (hasExecutableWorkItems(root, options)) {
    return {
      stopped: false,
      cleared: false,
      loop: root ? watchdog.getLoop(root, options.id ?? 'default') : null,
      reason: 'other-executable-items-remain',
    };
  }
  return { ...disarmWatchdogLoop(root, options), reason: 'no-executable-items' };
}

export function disarmAllWatchdogLoops() {
  const snapshot = listArmedLoops();
  const { count } = disarmAllWatchdogTimers();
  for (const entry of snapshot) {
    if (!entry?.root) continue;
    try {
      const existing = watchdog.getLoop(entry.root, entry.id);
      if (existing && existing.status !== 'stopped') {
        watchdog.stop({ root: entry.root, id: entry.id });
      }
    } catch {
      // best-effort
    }
  }
  return { count };
}

export function formatWatchdogArmResult(watch) {
  if (!watch) return '';
  if (watch.armed) {
    const seconds = Math.round((watch.intervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS) / 1000);
    return ` Watchdog 循环已按 observe 武装，已立即 tick，间隔 ${seconds}s。`;
  }
  const reason = watch.reason ? ` ${watch.reason}` : ' Watchdog 循环未能武装。';
  return reason.startsWith(' ') ? reason : ` ${reason}`;
}

export { DEFAULT_AUTHORITY };
