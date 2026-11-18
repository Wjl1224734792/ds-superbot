/**
 * Constitution Service CLI.
 * Usage: constitution <root> <resource> <action> [flags]
 * Default is dry-run; persist only with --write. --json for machine-readable output.
 */
import { formatIso } from './time.mjs';
import { ConstitutionError } from './errors.mjs';
import { addItemToThread, createThread, getThread } from './thread.mjs';
import { createWorkItem, getWorkItem, listWorkItems, transitionWorkItem } from './workitem.mjs';
import { getMandate, issueMandate, revokeMandate, REVOKE_REASONS } from './mandate.mjs';
import { checkSnapshot, createSnapshot, getSnapshot } from './snapshot.mjs';
import { evalPolicy } from './policy.mjs';
import { getReceipt, listReceipts, revalidateReceipt } from './receipt.mjs';
import { renderCard } from './cards.mjs';
import { runGate } from './gates/adapter.mjs';
import { EXIT_FAIL, EXIT_USAGE } from './gates/exit-codes.mjs';

export const HELP = `constitution — ds-superbot Constitution Service

Usage:
  constitution <root> <resource> <action> [flags]
  constitution --help

Resources and actions:
  workitem   create|get|list|transition
  thread     create|get|add-item
  mandate    issue|revoke|get
  snapshot   create|get|check
  policy     eval
  receipt    list|get|revalidate
  gate       <gate-name> [script-args...]
  card       workitem|approval|result

Global flags:
  --write              Persist changes (default is dry-run)
  --json               Machine-readable JSON on stdout
  --help, -h           Print this help and exit 0

workitem create   --thread TH-… --intent TEXT --risk R0|R1|R2|R3 [--reversible]
                  [--ac AC-1=text] [--non-goal TEXT] [--authority VALUE]
                  [--id WI-YYYY-NNN] [--intent-ambiguous] [--touches a,b]
                  [--origin-kind human|trigger] [--origin-ref REF] [--evidence PATH]
workitem get      --id WI-…
workitem list
workitem transition --id WI-… --to STATE [--plan PATH] [--plan-valid] [--approved-by WHO]

thread create     --id|--slug SLUG --title TEXT [--channel REF]
thread get        --id TH-…
thread add-item   --id TH-… --work-item WI-…

mandate issue     --work-item WI-… --issued-by WHO --expires-at ISO
                  --snapshot CS-… [--goal TEXT] [--tools shell,read] [--tokens N] [--minutes N]
mandate revoke    --id MD-… --reason human-stop|expired|snapshot-stale
mandate get       --id MD-…

snapshot create
snapshot get      --id CS-…
snapshot check    --id CS-…

policy eval       --work-item WI-…

receipt list      [--work-item WI-…]
receipt get       --id RC-…
receipt revalidate --id RC-…

gate <gate-name>  [args forwarded to the original script]
                  [--work-item WI-…]  also issue a Receipt (requires --write to persist)

card workitem|approval|result --id WI-…

Exit codes: 0 ok / 1 failed judgment or rule / 2 usage or I/O error.
Repeat invocations are idempotent. Judgment logic of gate scripts is not rewritten.
`;

export function parseArgv(argv) {
  const out = { flags: {}, rest: [], help: false, json: false, write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--write') out.write = true;
    else if (arg === '--reversible') out.flags.reversible = true;
    else if (arg === '--intent-ambiguous') out.flags.intentAmbiguous = true;
    else if (arg === '--plan-valid') out.flags.planValid = true;
    else if (arg.startsWith('--')) {
      const key = camel(arg.slice(2));
      const val = argv[i + 1];
      if (val == null || val.startsWith('--')) {
        out.flags[key] = true;
      } else {
        out.flags[key] = val;
        i += 1;
      }
    } else {
      out.rest.push(arg);
    }
  }
  return out;
}

function camel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function collectMulti(argv, flag) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      values.push(argv[i + 1]);
    }
  }
  return values;
}

function printResult(result, { json }) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (typeof result === 'string') {
    process.stdout.write(result.endsWith('\n') ? result : `${result}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

function parseAcFlags(argv) {
  return collectMulti(argv, '--ac').map((raw, i) => {
    const idx = raw.indexOf('=');
    if (idx < 0) return { id: `AC-${i + 1}`, text: raw, coveredBy: [] };
    return { id: raw.slice(0, idx).trim(), text: raw.slice(idx + 1).trim(), coveredBy: [] };
  });
}

/**
 * CLI entry. Returns an exit code. Does not always process.exit so tests can call it.
 */
export async function run(argv, runtime = process) {
  const parsed = parseArgv(argv);
  const [root, resource, action, ...cmdRest] = parsed.rest;
  // Global --help, except `gate <name> --help` which is forwarded to the script.
  const gateHelp = resource === 'gate' && Boolean(action) && parsed.help;
  if ((parsed.help && !gateHelp) || argv.length === 0) {
    runtime.stdout.write(HELP);
    return 0;
  }
  if (!root || !resource) {
    runtime.stderr.write('missing <root> or <resource> (--help for usage)\n');
    return EXIT_USAGE;
  }

  const opts = { write: parsed.write, json: parsed.json };
  const f = parsed.flags;

  try {
    let result;
    if (resource === 'workitem') result = cmdWorkItem(root, action, f, opts, argv);
    else if (resource === 'thread') result = cmdThread(root, action, f, opts);
    else if (resource === 'mandate') result = cmdMandate(root, action, f, opts);
    else if (resource === 'snapshot') result = cmdSnapshot(root, action, f, opts);
    else if (resource === 'policy') result = cmdPolicy(root, action, f);
    else if (resource === 'receipt') result = cmdReceipt(root, action, f, opts);
    else if (resource === 'gate') result = cmdGate(root, action, cmdRest, f, opts, argv);
    else if (resource === 'card') result = cmdCard(root, action, f);
    else {
      runtime.stderr.write(`unknown resource: ${resource} (--help for usage)\n`);
      return EXIT_USAGE;
    }
    if (result && typeof result === 'object' && result.__exitCode != null) {
      const code = result.__exitCode;
      delete result.__exitCode;
      if (result.stdout && !opts.json) runtime.stdout.write(result.stdout);
      if (result.stderr) runtime.stderr.write(result.stderr);
      if (opts.json) printResult(result, opts);
      else if (result.receipt || result.document) printResult(result.receipt ?? result.document ?? result, opts);
      return code;
    }
    printResult(result, opts);
    return 0;
  } catch (err) {
    const code = err instanceof ConstitutionError
      ? (err.code === 'TRANSITION' || err.code === 'MANDATE_EXPIRED' || err.code === 'SNAPSHOT_STALE' || err.code === 'MANDATE_FROZEN' ? EXIT_FAIL : EXIT_USAGE)
      : EXIT_USAGE;
    const payload = err instanceof ConstitutionError
      ? { ok: false, code: err.code, error: err.message, details: err.details }
      : { ok: false, code: 'ERROR', error: err.message };
    if (opts.json) runtime.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else runtime.stderr.write(`${payload.code}: ${payload.error}\n`);
    return code;
  }
}

function cmdWorkItem(root, action, f, opts, argv) {
  if (action === 'create') {
    const originKind = f.originKind ?? 'human';
    const evidence = collectMulti(argv, '--evidence');
    return createWorkItem(root, {
      id: f.id,
      thread: f.thread,
      intent: f.intent,
      risk: f.risk,
      reversible: Boolean(f.reversible),
      authority: f.authority,
      ac: parseAcFlags(argv),
      nonGoals: collectMulti(argv, '--non-goal'),
      intentAmbiguous: Boolean(f.intentAmbiguous),
      touches: f.touches ? String(f.touches).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      origin: { kind: originKind, ref: f.originRef ?? 'cli', evidence },
      gates: f.gates ? String(f.gates).split(',').map((s) => s.trim()) : undefined,
    }, opts);
  }
  if (action === 'get') return must(getWorkItem(root, f.id), `work item not found: ${f.id}`);
  if (action === 'list') return listWorkItems(root);
  if (action === 'transition') {
    return transitionWorkItem(root, f.id, f.to, {
      write: opts.write,
      plan: f.plan,
      planValid: Boolean(f.planValid),
      approvedBy: f.approvedBy,
    });
  }
  failUsage(`unknown workitem action: ${action}`);
}

function cmdThread(root, action, f, opts) {
  if (action === 'create') {
    return createThread(root, {
      id: f.id,
      slug: f.slug ?? f.id,
      title: f.title,
      channels: f.channel ? [f.channel].flat() : (f.channels ? String(f.channels).split(',') : []),
    }, opts);
  }
  if (action === 'get') return must(getThread(root, f.id), `thread not found: ${f.id}`);
  if (action === 'add-item' || action === 'addItem') {
    return addItemToThread(root, f.id, f.workItem, opts);
  }
  failUsage(`unknown thread action: ${action}`);
}

function cmdMandate(root, action, f, opts) {
  if (action === 'issue') {
    const item = f.workItem ? getWorkItem(root, f.workItem) : null;
    return issueMandate(root, {
      workItem: f.workItem,
      issuedBy: f.issuedBy,
      expiresAt: f.expiresAt,
      constitution_snapshot: f.snapshot ?? f.constitutionSnapshot ?? item?.constitution_snapshot,
      goal: f.goal ?? item?.intent,
      ac: item?.ac ?? [],
      nonGoals: item?.nonGoals ?? [],
      scope: item?.scope ?? { files: [], newFiles: [], owners: [] },
      toolsWhitelist: f.tools ? String(f.tools).split(',') : undefined,
      budget: { tokens: Number(f.tokens ?? 0), minutes: Number(f.minutes ?? 0) },
      evidenceRequired: item?.gates ?? [],
    }, opts);
  }
  if (action === 'revoke') {
    if (!REVOKE_REASONS.includes(f.reason)) failUsage(`revoke --reason must be ${REVOKE_REASONS.join('|')}`);
    return revokeMandate(root, f.id, f.reason, opts);
  }
  if (action === 'get') return must(getMandate(root, f.id), `mandate not found: ${f.id}`);
  failUsage(`unknown mandate action: ${action}`);
}

function cmdSnapshot(root, action, f, opts) {
  if (action === 'create') return createSnapshot(root, opts);
  if (action === 'get') return must(getSnapshot(root, f.id), `snapshot not found: ${f.id}`);
  if (action === 'check') return checkSnapshot(root, f.id);
  failUsage(`unknown snapshot action: ${action}`);
}

function cmdPolicy(root, action, f) {
  if (action !== 'eval') failUsage(`unknown policy action: ${action}`);
  const item = must(getWorkItem(root, f.workItem), `work item not found: ${f.workItem}`);
  const ev = evalPolicy(root, item);
  return {
    workItem: item.id,
    rule: ev.id,
    requireHuman: ev.requireHuman,
    allow: ev.allow,
    gates: ev.gates,
    speak: ev.speak,
    merge: ev.merge,
    file: ev.file,
  };
}

function cmdReceipt(root, action, f, opts) {
  if (action === 'list') return listReceipts(root, f.workItem);
  if (action === 'get') return must(getReceipt(root, f.id), `receipt not found: ${f.id}`);
  if (action === 'revalidate') return revalidateReceipt(root, f.id, opts);
  failUsage(`unknown receipt action: ${action}`);
}

function cmdGate(root, gate, cmdRest, f, opts, argv) {
  if (!gate) failUsage('gate requires a gate name');
  // Forward script args: everything after the gate name, minus our flags.
  const forwarded = [];
  const raw = argv.slice(argv.indexOf(gate) + 1);
  for (let i = 0; i < raw.length; i += 1) {
    const a = raw[i];
    if (a === '--write' || a === '--json') continue;
    if (a === '--work-item' || a === '--artifacts') {
      i += 1;
      continue;
    }
    forwarded.push(a);
  }
  const artifacts = f.artifacts ? String(f.artifacts).split(',') : undefined;
  const ran = runGate(root, gate, forwarded, { workItem: f.workItem, write: opts.write, artifacts });
  return { ...ran, __exitCode: ran.exitCode };
}

function cmdCard(root, kind, f) {
  if (!['workitem', 'approval', 'result'].includes(kind)) failUsage(`unknown card kind: ${kind}`);
  const item = must(getWorkItem(root, f.id), `work item not found: ${f.id}`);
  let receipts = [];
  if (kind === 'result') {
    receipts = listReceipts(root, item.id).map((r) => ({ gate: r.gate, status: r.status }));
  }
  return renderCard(kind, item, { receipts, conclusion: f.conclusion, artifact: f.artifact });
}

function must(value, message) {
  if (value == null) {
    const err = new ConstitutionErrorUsage(message);
    throw err;
  }
  return value;
}

class ConstitutionErrorUsage extends ConstitutionError {
  constructor(message) {
    super('USAGE', message);
  }
}

// local alias so must() can construct — ConstitutionError already imported
function failUsage(message) {
  throw new ConstitutionErrorUsage(message);
}

// re-export for tests
export { formatIso };
