/**
 * Two-level filter. L1 fastPath is a pure rule sieve
 * (source whitelist / keywords / sender). L2 slowPath is a lightweight
 * policy-shaped rule pass with a reserved model hook.
 */
import { RULES_MODEL } from './model.mjs';

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

const RISK_RANK = { R0: 0, R1: 1, R2: 2, R3: 3 };

function hasDecidableAc(signal) {
  const ac = signal.ac ?? [];
  return ac.some((item) => String(item?.text ?? '').trim().length > 0);
}

/**
 * L2 semantic slow path against written policy, implemented as
 * lightweight rules. A reserved model port may refine classification
 * but cannot turn a rule rejection into an accept, grant authority,
 * or execute work.
 *
 * @param {object} signal
 * @param {object} [policy]  parsed policy `{ rules }` or eval result
 * @param {object} [model]   reserved model port from createModelPort()
 * @returns {{ accept: boolean, reason: string, via: string, risk: string, requireHuman: boolean, policy: string|null }}
 */
export function slowPath(signal = {}, policy, model) {
  const text = String(signal.text ?? signal.intent ?? '').trim();
  if (!text) {
    return {
      accept: false,
      reason: 'l2-empty-intent',
      via: 'rules',
      risk: signal.risk ?? 'R2',
      requireHuman: true,
      policy: null,
    };
  }

  const risk = signal.risk && riskKnown(signal.risk) ? signal.risk : 'R2';
  const reversible = signal.reversible ?? true;
  const touches = Array.isArray(signal.touches) ? signal.touches : [];
  const ambiguous = Boolean(signal.intentAmbiguous) || !hasDecidableAc(signal);
  const workLike = { risk, reversible, touches, intentAmbiguous: ambiguous };

  let matched = matchPolicy(policy, workLike);
  const requireHuman = matched
    ? Boolean(matched.requireHuman)
    : (RISK_RANK[risk] >= 2 || ambiguous || touchesSensitive(touches) || !reversible);

  const result = {
    accept: true,
    reason: matched ? `l2-policy:${matched.id}` : 'l2-pass',
    via: 'rules',
    risk,
    reversible,
    requireHuman,
    policy: matched?.id ?? null,
    merge: matched?.merge ?? null,
  };

  const port = model ?? RULES_MODEL;
  if (port && typeof port.completeSync === 'function' && port.kind === 'rules') {
    const classified = port.completeSync('classify-signal', { ...signal, text, risk });
    if (classified?.result?.usable === false) {
      return { ...result, accept: false, reason: 'l2-model-unusable', via: 'rules' };
    }
  }
  return result;
}

function riskKnown(risk) {
  return Object.prototype.hasOwnProperty.call(RISK_RANK, risk);
}

function touchesSensitive(touches) {
  const set = new Set(touches);
  return ['prod', 'billing', 'delete', 'secrets'].some((t) => set.has(t));
}

function matchPolicy(policy, workLike) {
  if (!policy) return null;
  const rules = policy.rules ?? (policy.rule ? [policy.rule] : null);
  if (!Array.isArray(rules)) {
    if (policy.id && (policy.requireHuman != null || policy.allow)) return policy;
    return null;
  }
  for (const rule of rules) {
    if (matchSimpleWhen(rule.when, workLike)) {
      return {
        id: rule.id,
        requireHuman: Boolean(rule.requireHuman),
        allow: [...(rule.allow ?? [])],
        merge: rule.merge ?? null,
      };
    }
  }
  return null;
}

/**
 * A conservative subset of the constitution policy language, used when
 * a raw policy document is passed without the constitution matcher.
 * Prefer passing an evalPolicy() result when a repo root is available.
 */
function matchSimpleWhen(expr, item) {
  if (!expr) return true;
  const parts = String(expr).split('||').map((s) => s.trim());
  return parts.some((orPart) => orPart.split('&&').map((s) => s.trim()).every((atom) => evalSimpleAtom(atom, item)));
}

function evalSimpleAtom(atom, item) {
  let negated = false;
  let body = atom;
  if (body.startsWith('!')) {
    negated = true;
    body = body.slice(1).trim();
  }
  let hit = false;
  const riskCmp = body.match(/^risk\s*(<=|>=|==|<|>)\s*(R[0-3])$/);
  if (riskCmp) {
    const left = RISK_RANK[item.risk] ?? 99;
    const right = RISK_RANK[riskCmp[2]];
    const op = riskCmp[1];
    hit = op === '<=' ? left <= right
      : op === '>=' ? left >= right
        : op === '==' ? left === right
          : op === '<' ? left < right
            : left > right;
  } else if (body === 'reversible == true' || body === 'reversible==true') {
    hit = item.reversible === true;
  } else if (body === 'intent.ambiguous') {
    hit = Boolean(item.intentAmbiguous);
  } else if (body.startsWith('touches(') && body.endsWith(')')) {
    const wanted = body.slice('touches('.length, -1).split('|').map((s) => s.trim());
    const have = new Set(item.touches ?? []);
    hit = wanted.some((t) => have.has(t));
  }
  return negated ? !hit : hit;
}
