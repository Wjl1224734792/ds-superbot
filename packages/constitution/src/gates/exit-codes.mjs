/**
 * Gate script exit codes, unchanged from the 0.1.0 scripts:
 *   0 = judgment passed
 *   1 = judgment failed
 *   2 = usage or I/O error
 */
export const EXIT_PASS = 0;
export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;

export function statusFromExit(exitCode, { gate } = {}) {
  if (exitCode === EXIT_PASS) return 'pass';
  if (exitCode === EXIT_FAIL) return 'fail';
  if (exitCode === EXIT_USAGE) return 'fail';
  if (gate === 'browser-ac') return 'unverified';
  return 'fail';
}
