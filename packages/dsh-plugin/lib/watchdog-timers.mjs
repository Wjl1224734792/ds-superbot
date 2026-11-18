/**
 * Host-side Watchdog timer registry. Kept free of constitution / runtime
 * imports so the plugin entry can clear timers on dispose without pulling
 * those packages into an isolated plugin-only checkout.
 */
/** @type {Map<string, { timer: unknown, scheduler: object, root: string, id: string, intervalMs: number }>} */
const ARMED = new Map();

export function loopKey(root, id = 'default') {
  return `${root}::${id}`;
}

export function getArmedLoops() {
  return ARMED;
}

export function listArmedLoops() {
  return [...ARMED.values()];
}

export function isTimerArmed(root, id = 'default') {
  return ARMED.has(loopKey(root, id));
}

export function setArmedLoop(root, id, entry) {
  ARMED.set(loopKey(root, id), entry);
}

export function getArmedLoop(root, id = 'default') {
  return ARMED.get(loopKey(root, id));
}

export function clearArmedTimer(root, id = 'default') {
  const key = loopKey(root, id);
  const entry = ARMED.get(key);
  if (entry?.timer != null && typeof entry.scheduler?.clearInterval === 'function') {
    try {
      entry.scheduler.clearInterval(entry.timer);
    } catch {
      // best-effort
    }
  }
  const had = ARMED.delete(key);
  return { had, entry };
}

/** Clear every armed interval. Does not touch ledger documents. */
export function disarmAllWatchdogTimers() {
  const keys = [...ARMED.keys()];
  let cleared = 0;
  for (const key of keys) {
    const entry = ARMED.get(key);
    if (entry?.timer != null && typeof entry.scheduler?.clearInterval === 'function') {
      try {
        entry.scheduler.clearInterval(entry.timer);
      } catch {
        // best-effort
      }
    }
    ARMED.delete(key);
    cleared += 1;
  }
  return { count: cleared };
}
