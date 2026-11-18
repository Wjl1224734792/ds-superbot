/**
 * Cartographer write-back (P4).
 *
 * After a delivered work item, Cartographer may append Decision /
 * Invariant records to the project knowledge base and must not touch
 * business code. The Capability Compiler only marks the capability as
 * write-back-capable and still only drafts Mandates; it never calls
 * this module and never writes the KB.
 *
 * Default authority is observe: writeBack records would-accept and does
 * not write files (`executed: false`). An actual append happens only
 * when every guard below is met. Never auto-merge. Never start a worker.
 * There is no roles/cartographer.md and no 8th role.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AUTHORITY, recordWouldAccept, resolveAuthority, assertNoAutoMerge } from './observe.mjs';
import { isInside, posixRel } from './separation.mjs';
import { formatIso } from '../../constitution/src/time.mjs';

export const DECISION_PATH = 'docs/project/DECISIONS.md';
export const INVARIANT_PATH = 'docs/project/INVARIANTS.md';

export const KB_ALLOWLIST = Object.freeze([DECISION_PATH, INVARIANT_PATH]);

export const WRITEBACK_STATES = Object.freeze(['Delivered']);

const FORBIDDEN_PREFIXES = Object.freeze([
  'src/',
  'packages/',
  'app/',
  'lib/',
  'scripts/',
  '.superbot/ledger/',
  'tmp/superbot/',
]);

const TEMPLATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../constitution/scripts/templates',
);

const DEFAULT_DECISIONS = `# DECISIONS

> ADR 追加日志：只追加不改写；推翻旧决策时新增一条并标注 supersedes。

| 编号 | 日期 | 背景 | 决策 | 备选方案 | 后果 | 状态 |
|---|---|---|---|---|---|---|

<!-- 新条目追加在表格末尾；编号递增；状态 ∈ {proposed, accepted, superseded}。 -->
`;

const DEFAULT_INVARIANTS = `# INVARIANTS

> 只追加不改写。Cartographer 回写只能追加本文件与 \`docs/project/DECISIONS.md\`，不得改业务代码。

| 编号 | 日期 | 不变量 | 来源工作项 | 状态 |
|---|---|---|---|---|

<!-- 新条目追加在表格末尾；编号递增；状态 ∈ {proposed, accepted, superseded}。 -->
`;

export class CartographerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CartographerError';
    this.code = details.code ?? 'CARTOGRAPHER';
    this.details = details;
  }
}

function failCarto(message, details) {
  throw new CartographerError(message, details);
}

export function normalizeKnowledgeRel(pathValue) {
  if (pathValue == null || pathValue === '') return null;
  if (isAbsolute(pathValue)) return null;
  const norm = String(pathValue).split(sep).join('/').replace(/^\.\//, '');
  if (!norm || norm.includes('..') || norm.startsWith('/') || norm.includes('\0')) return null;
  return norm;
}

export function isAllowedKnowledgePath(pathValue, root) {
  const rel = normalizeKnowledgeRel(pathValue);
  if (!rel || !KB_ALLOWLIST.includes(rel)) return false;
  if (root) {
    const absRoot = resolve(root);
    const abs = resolve(absRoot, rel);
    if (!isInside(absRoot, abs)) return false;
    if (posixRel(absRoot, abs) !== rel) return false;
  }
  return true;
}

function assertAllowedTarget(root, pathValue) {
  const rel = normalizeKnowledgeRel(pathValue);
  if (!rel) {
    failCarto(`knowledge-base path is not allowlisted: ${pathValue}`, { code: 'KB_PATH_REJECTED', path: pathValue });
  }
  if (FORBIDDEN_PREFIXES.some((p) => rel === p.slice(0, -1) || rel.startsWith(p))) {
    failCarto(`knowledge-base path is not allowlisted: ${rel}`, { code: 'KB_PATH_REJECTED', path: rel });
  }
  if (!isAllowedKnowledgePath(rel, root)) {
    failCarto(`knowledge-base path is not allowlisted: ${rel}`, { code: 'KB_PATH_REJECTED', path: rel });
  }
  return rel;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}

function nextId(text, prefix) {
  let max = 0;
  const re = new RegExp(`${prefix}-(\\d+)`, 'g');
  let match;
  while ((match = re.exec(text ?? '')) !== null) {
    max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

function today(date) {
  return (date ? formatIso(date) : formatIso()).slice(0, 10);
}

function readTemplate(name, fallback) {
  const file = join(TEMPLATES_DIR, name);
  if (existsSync(file)) return readFileSync(file, 'utf8').replaceAll('{{PROJECT_NAME}}', 'project').replaceAll('{{DATE}}', today());
  return fallback;
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function appendRow(existing, header, row) {
  const base = (existing == null || existing === '') ? header : existing;
  return `${ensureTrailingNewline(base)}${row}\n`;
}

function decisionRow(entry, existing, workItemId) {
  const id = entry.id || nextId(existing ?? '', 'ADR');
  const date = entry.date || today();
  const status = entry.status || 'accepted';
  return {
    id,
    kind: 'decision',
    path: DECISION_PATH,
    row: `| ${escapeCell(id)} | ${escapeCell(date)} | ${escapeCell(entry.background ?? entry.context ?? '')} | ${escapeCell(entry.decision ?? entry.text ?? '')} | ${escapeCell(entry.alternatives ?? '')} | ${escapeCell(entry.consequences ?? '')} | ${escapeCell(status)} |`,
    workItem: workItemId,
  };
}

function invariantRow(entry, existing, workItemId) {
  const id = entry.id || nextId(existing ?? '', 'INV');
  const date = entry.date || today();
  const status = entry.status || 'accepted';
  return {
    id,
    kind: 'invariant',
    path: INVARIANT_PATH,
    row: `| ${escapeCell(id)} | ${escapeCell(date)} | ${escapeCell(entry.text ?? entry.invariant ?? '')} | ${escapeCell(entry.workItem ?? workItemId ?? '')} | ${escapeCell(status)} |`,
    workItem: workItemId,
  };
}

function readExisting(root, rel) {
  const file = resolve(root, rel);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}

/**
 * Guard for an executed (file-writing) write-back. All must hold:
 * 1. `write === true` (explicit persist flag, same idea as constitution `--write`)
 * 2. `resolveAuthority(authority) === 'execute'` (default is observe)
 * 3. `workItem.state === 'Delivered'`
 * 4. every target path is on KB_ALLOWLIST (`docs/project/DECISIONS.md`,
 *    `docs/project/INVARIANTS.md`) after path normalization
 *
 * Observe (the default) records would-accept and never writes, even if
 * `write: true` is set. Auto-merge is always rejected. The compiler
 * never calls this function.
 */
export function canExecuteWriteBack({ write, authority, workItem } = {}) {
  const resolved = resolveAuthority(authority);
  return Boolean(write)
    && resolved === 'execute'
    && WRITEBACK_STATES.includes(workItem?.state);
}

function plannedEntries(root, { decisions = [], invariants = [], workItem } = {}) {
  const workItemId = workItem?.id ?? null;
  const planned = [];
  if (Array.isArray(decisions)) {
    let existing = readExisting(root, DECISION_PATH);
    for (const entry of decisions) {
      const row = decisionRow(entry, existing, workItemId);
      assertAllowedTarget(root, row.path);
      planned.push(row);
      existing = appendRow(existing, '', row.row);
    }
  }
  if (Array.isArray(invariants)) {
    let existing = readExisting(root, INVARIANT_PATH);
    for (const entry of invariants) {
      const row = invariantRow(entry, existing, workItemId);
      assertAllowedTarget(root, row.path);
      planned.push(row);
      existing = appendRow(existing, '', row.row);
    }
  }
  return planned;
}

function applyAppends(root, planned) {
  const written = [];
  const byPath = new Map();
  for (const item of planned) {
    if (!byPath.has(item.path)) {
      const current = readExisting(root, item.path);
      const header = item.path === DECISION_PATH
        ? readTemplate('DECISIONS.md', DEFAULT_DECISIONS)
        : readTemplate('INVARIANTS.md', DEFAULT_INVARIANTS);
      byPath.set(item.path, { text: current, header, rows: [] });
    }
    byPath.get(item.path).rows.push(item);
  }
  for (const [rel, bundle] of byPath) {
    assertAllowedTarget(root, rel);
    const absRoot = resolve(root);
    const abs = resolve(absRoot, rel);
    if (!isInside(absRoot, abs) || posixRel(absRoot, abs) !== rel) {
      failCarto(`knowledge-base path escapes allowlist: ${rel}`, { code: 'KB_PATH_REJECTED', path: rel });
    }
    let text = bundle.text;
    const header = bundle.header;
    for (const item of bundle.rows) {
      text = appendRow(text, header, item.row);
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, 'utf8');
    for (const item of bundle.rows) written.push({ path: rel, kind: item.kind, id: item.id });
  }
  return written;
}

/**
 * Write back Decision / Invariant records to the knowledge base.
 *
 * @param {{
 *   root: string,
 *   workItem?: object,
 *   decisions?: object[],
 *   invariants?: object[],
 *   targets?: string[],
 *   authority?: string,
 *   write?: boolean,
 *   action?: string
 * }} input
 */
export function writeBack(input = {}) {
  const {
    root,
    workItem = {},
    decisions = [],
    invariants = [],
    targets = [],
    authority,
    write = false,
    action = 'cartographer.writeBack',
  } = input;

  assertNoAutoMerge(action);
  if (authority === 'auto-merge') resolveAuthority(authority);

  if (!root) failCarto('writeBack requires a repository root', { code: 'CARTOGRAPHER' });

  for (const target of targets) assertAllowedTarget(root, target);

  const planned = plannedEntries(root, { decisions, invariants, workItem });
  const resolved = resolveAuthority(authority);
  const executable = canExecuteWriteBack({ write, authority, workItem });

  if (!executable) {
    const reason = resolved === 'observe' || !authority
      ? 'default authority is observe; writeBack records would-accept and does not write files'
      : (!write
        ? 'write is disabled; pass write: true to persist after a Delivered work item'
        : `writeBack only executes after a Delivered work item (got ${workItem?.state ?? 'missing state'})`);
    const wouldAccept = recordWouldAccept(root, {
      action,
      workItem: workItem?.id ?? null,
      authority: resolved,
      reason,
      risk: workItem?.risk ?? null,
      would: { propose: false, assign: false, execute: false, merge: false, writeBack: true },
      details: {
        paths: planned.map((p) => p.path),
        decisions: planned.filter((p) => p.kind === 'decision').map((p) => p.id),
        invariants: planned.filter((p) => p.kind === 'invariant').map((p) => p.id),
      },
    }, { write: true });
    return {
      executed: false,
      authority: resolved,
      wouldAccept,
      planned: planned.map((p) => ({ path: p.path, kind: p.kind, id: p.id })),
      written: [],
      workItem: workItem?.id ?? null,
      reason,
    };
  }

  const written = applyAppends(root, planned);
  return {
    executed: true,
    authority: resolved,
    wouldAccept: null,
    planned: planned.map((p) => ({ path: p.path, kind: p.kind, id: p.id })),
    written,
    workItem: workItem?.id ?? null,
    reason: null,
  };
}

export { writeBack as writeBackKnowledge };
