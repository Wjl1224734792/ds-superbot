/**
 * Thin adapter: spawn an existing gate script, preserve its exit code, and
 * optionally issue a Receipt when --work-item is provided.
 * Judgment logic stays in the original scripts. Do not rewrite it here.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from '../errors.mjs';
import { issueReceipt, GATE_SCRIPTS, GATES } from '../receipt.mjs';
import { getWorkItem, saveWorkItem } from '../workitem.mjs';
import { EXIT_USAGE, statusFromExit } from './exit-codes.mjs';

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../scripts');

export const GATE_FILES = Object.freeze({
  'docs-ready': join(SCRIPTS_DIR, 'docs-ready.mjs'),
  'validate-plan': join(SCRIPTS_DIR, 'validate-plan.mjs'),
  'docs-gate': join(SCRIPTS_DIR, 'docs-gate.mjs'),
  'naming-guard': join(SCRIPTS_DIR, 'doc/guard-naming.mjs'),
  'verify': join(SCRIPTS_DIR, 'verify.mjs'),
});

export function resolveGateScript(gate) {
  const file = GATE_FILES[gate];
  if (!file) fail('GATE', `gate ${gate} has no executable script in P0 (mapped as ${GATE_SCRIPTS[gate] ?? 'unknown'})`);
  return file;
}

/**
 * @param {string} root
 * @param {string} gate
 * @param {string[]} args arguments forwarded to the original script (not including the script path)
 * @param {{ workItem?: string, write?: boolean, artifacts?: string[] }} [options]
 */
export function runGate(root, gate, args, options = {}) {
  if (!GATES.includes(gate)) fail('GATE', `unknown gate: ${gate}`);
  if (gate === 'browser-ac' || gate === 'review') {
    fail('GATE', `gate ${gate} is evidence-backed and has no P0 script adapter`);
  }
  const script = resolveGateScript(gate);
  const forwarded = [root, ...args.filter((a) => a !== root)];
  const result = spawnSync(process.execPath, [script, ...forwarded], {
    encoding: 'utf8',
  });
  const exitCode = result.status ?? EXIT_USAGE;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  let receipt = null;
  if (options.workItem && exitCode !== EXIT_USAGE) {
    const item = getWorkItem(root, options.workItem);
    if (!item) fail('GATE', `work item not found: ${options.workItem}`);
    const issued = issueReceipt(root, {
      workItem: options.workItem,
      gate,
      script: GATE_SCRIPTS[gate],
      exitCode,
      status: statusFromExit(exitCode, { gate }),
      constitution_snapshot: item.constitution_snapshot,
      artifacts: options.artifacts ?? defaultArtifacts(gate),
    }, { write: options.write });
    receipt = issued.document;
    if (options.write && !item.receipts.includes(receipt.id)) {
      saveWorkItem(root, { ...item, receipts: [...item.receipts, receipt.id] }, { write: true });
    }
  }
  return { exitCode, stdout: result.stdout ?? '', stderr: result.stderr ?? '', output, receipt, script };
}

function defaultArtifacts(gate) {
  if (gate === 'docs-ready') return ['.superbot/docs-state.json'];
  return [];
}
