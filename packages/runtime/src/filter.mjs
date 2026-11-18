/**
 * Two-level filter. P0 implements L1 fastPath as pure rules
 * (source whitelist / keywords / sender). L2 is a P1 placeholder.
 */
import { notImplemented } from './errors.mjs';

/** Default L1 rules. Callers may pass overrides. */
export const DEFAULT_RULES = Object.freeze({
  sources: ['human', 'group', 'github', 'ci', 'cli'],
  blockedSources: ['spam', 'unknown-bot'],
  sendersAllow: null,
  sendersDeny: ['bot-noise'],
  requireKeyword: false,
  keywords: ['bug', 'fix', 'ci', 'fail', 'outage', 'incident', 'todo', 'work', '任务', '故障', '红灯'],
  dropKeywords: ['lol', 'ok', 'thanks', '谢谢', '哈哈'],
});

/**
 * L1 programmatic sieve.
 * @param {{ source?: string, kind?: string, sender?: string, text?: string }} signal
 * @param {typeof DEFAULT_RULES} [rules]
 * @returns {{ accept: boolean, reason: string }}
 */
export function fastPath(signal = {}, rules = DEFAULT_RULES) {
  const source = signal.source ?? signal.kind ?? 'human';
  const sender = signal.sender ?? '';
  const text = String(signal.text ?? signal.intent ?? '').toLowerCase();

  if ((rules.blockedSources ?? []).includes(source)) {
    return { accept: false, reason: `blocked-source:${source}` };
  }
  if ((rules.sources ?? []).length && !rules.sources.includes(source)) {
    return { accept: false, reason: `source-not-whitelisted:${source}` };
  }
  if (sender && (rules.sendersDeny ?? []).includes(sender)) {
    return { accept: false, reason: `denied-sender:${sender}` };
  }
  if (sender && Array.isArray(rules.sendersAllow) && !rules.sendersAllow.includes(sender)) {
    return { accept: false, reason: `sender-not-whitelisted:${sender}` };
  }
  if ((rules.dropKeywords ?? []).some((k) => text === k || text === k.toLowerCase())) {
    return { accept: false, reason: `drop-keyword` };
  }
  if (rules.requireKeyword) {
    const hit = (rules.keywords ?? []).some((k) => text.includes(String(k).toLowerCase()));
    if (!hit) return { accept: false, reason: 'keyword-miss' };
  }
  return { accept: true, reason: 'l1-pass' };
}

/** P1: L2 semantic slow path against written policy. */
export function slowPath(_signal, _policy) {
  notImplemented('filter.slowPath');
}
