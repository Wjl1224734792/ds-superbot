/**
 * Policy-as-code: parse .superbot/policy/default.yaml and match the first rule.
 * Matching is deterministic. Do not ask a model to "understand" the YAML.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './errors.mjs';
import { loadSchema, assertValid } from './schema.mjs';

const PACKAGED_DEFAULT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../templates/policy.default.yaml',
);

export const POLICY_REL = '.superbot/policy/default.yaml';

const RISK_RANK = { R0: 0, R1: 1, R2: 2, R3: 3 };

const TOUCHES_RE = /^touches\(([^)]+)\)$/;

/**
 * Locate the policy file, falling back to the packaged default.
 * @param {string} root
 */
export function policyPath(root) {
  const local = join(root, POLICY_REL);
  return existsSync(local) ? local : PACKAGED_DEFAULT;
}

export function loadPolicy(root) {
  const file = policyPath(root);
  const raw = readFileSync(file, 'utf8');
  const doc = parsePolicyYaml(raw);
  assertValid(doc, loadSchema('policy'), 'policy');
  return { file, policy: doc, packaged: file === PACKAGED_DEFAULT };
}

/**
 * Evaluate the first matching rule for a work item.
 * @returns {{ rule: object, requireHuman: boolean, allow: string[], gates: string[], speak: string[], merge: string|null, file: string }}
 */
export function evalPolicy(root, workItem) {
  const { file, policy } = loadPolicy(root);
  for (const rule of policy.rules) {
    if (matchWhen(rule.when, workItem)) {
      return {
        id: rule.id,
        rule,
        requireHuman: Boolean(rule.requireHuman),
        allow: [...(rule.allow ?? [])],
        gates: [...(rule.gates ?? [])],
        speak: [...(rule.speak ?? [])],
        merge: rule.merge ?? null,
        file,
      };
    }
  }
  fail('POLICY', `no policy rule matched work item ${workItem?.id ?? '?'}`, { when: workItem });
}

export function policyRev(root) {
  const { policy, file } = loadPolicy(root);
  const base = file.endsWith('default.yaml') ? 'default.yaml' : file.split(/[/\\]/).pop();
  return `${base}#${policy.rules.map((r) => r.id).join('+')}`;
}

export function matchWhen(expr, workItem) {
  return evalOr(String(expr).trim(), workItem);
}

function evalOr(expr, workItem) {
  return splitTop(expr, '||').some((part) => evalAnd(part.trim(), workItem));
}

function evalAnd(expr, workItem) {
  return splitTop(expr, '&&').every((part) => evalAtom(part.trim(), workItem));
}

function evalAtom(atom, workItem) {
  if (atom.startsWith('!')) {
    const inner = atom.slice(1).trim();
    if (!inner) fail('POLICY', `unsupported policy expression: ${atom}`);
    return !evalAtom(inner, workItem);
  }
  const riskCmp = atom.match(/^risk\s*(<=|>=|==|<|>)\s*(R[0-3])$/);
  if (riskCmp) {
    const left = RISK_RANK[workItem.risk];
    const right = RISK_RANK[riskCmp[2]];
    if (left == null) fail('POLICY', `work item missing risk for expression ${atom}`);
    switch (riskCmp[1]) {
      case '<=': return left <= right;
      case '>=': return left >= right;
      case '==': return left === right;
      case '<': return left < right;
      case '>': return left > right;
      default: return false;
    }
  }
  const rev = atom.match(/^reversible\s*==\s*(true|false)$/);
  if (rev) return Boolean(workItem.reversible) === (rev[1] === 'true');

  if (atom === 'intent.ambiguous') return Boolean(workItem.intentAmbiguous);

  const touches = atom.match(TOUCHES_RE);
  if (touches) {
    const needles = touches[1].split('|').map((s) => s.trim()).filter(Boolean);
    const have = Array.isArray(workItem.touches) ? workItem.touches : [];
    return needles.some((n) => have.includes(n));
  }

  fail('POLICY', `unsupported policy expression: ${atom}`);
}

function splitTop(expr, sep) {
  const out = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth === 0 && expr.slice(i, i + sep.length) === sep) {
      out.push(buf);
      buf = '';
      i += sep.length - 1;
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

/**
 * Minimal YAML subset parser for the default policy file shape.
 * Handles comments, 2-space indent, `- id:` lists, inline `[a, b]` arrays,
 * booleans, and quoted / bare strings.
 */
export function parsePolicyYaml(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, ''))
    .map((line, i) => ({ i: i + 1, raw: line, indent: line.match(/^ */)[0].length, text: line.trim() }))
    .filter((l) => l.text.length > 0);

  const root = {};
  const stack = [{ indent: -1, value: root }];

  const assign = (container, key, value) => {
    if (Array.isArray(container)) {
      const last = container[container.length - 1];
      if (!last || typeof last !== 'object') fail('POLICY', 'invalid YAML list item');
      last[key] = value;
    } else {
      container[key] = value;
    }
    return value;
  };

  for (const line of lines) {
    while (stack.length > 1 && line.indent <= stack[stack.length - 1].indent) stack.pop();
    const container = stack[stack.length - 1].value;

    if (line.text.startsWith('- ')) {
      const rest = line.text.slice(2);
      if (!Array.isArray(container)) fail('POLICY', `YAML list item at unexpected place (line ${line.i})`);
      if (rest.includes(':')) {
        const { key, value } = parseKeyValue(rest, line.i);
        const obj = { [key]: value };
        container.push(obj);
        stack.push({ indent: line.indent, value: obj });
      } else {
        container.push(parseScalar(rest));
      }
      continue;
    }

    const { key, value, pending } = parseKeyValue(line.text, line.i);
    assign(container, key, value);
    if (pending) stack.push({ indent: line.indent, value });
  }

  return root;
}

function parseKeyValue(text, line) {
  const idx = text.indexOf(':');
  if (idx < 0) fail('POLICY', `YAML missing ':' at line ${line}`);
  const key = text.slice(0, idx).trim();
  const rest = text.slice(idx + 1).trim();
  if (rest === '' || rest === '|' || rest === '>') {
    const listKeysEarly = new Set(['rules', 'allow', 'gates', 'speak', 'bindings']);
    return { key, value: listKeysEarly.has(key) ? [] : {}, pending: true };
  }
  if (rest === '[]') return { key, value: [], pending: false };
  // A bare key followed by a nested list/object uses an empty value placeholder.
  // Callers replace {} with [] when the first child is a list item — we detect
  // list keys by convention for "rules", "allow", "gates", "speak".
  const listKeys = new Set(['rules', 'allow', 'gates', 'speak', 'bindings']);
  if (rest === '' && listKeys.has(key)) return { key, value: [], pending: true };
  return { key, value: parseScalar(rest), pending: false };
}

function parseScalar(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => parseScalar(s.trim()));
  }
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}
