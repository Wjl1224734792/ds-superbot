import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as runtime from '../src/index.mjs';
import { tmpRoot } from './lib/helpers.mjs';

function deliveredItem(overrides = {}) {
  return {
    id: 'WI-2026-701',
    state: 'Delivered',
    intent: '把 CI 修绿',
    risk: 'R1',
    reversible: true,
    ...overrides,
  };
}

test('observe writeBack records would-accept and does not write knowledge-base files', (t) => {
  const root = tmpRoot(t);
  mkdirSync(join(root, 'docs/project'), { recursive: true });
  writeFileSync(join(root, 'docs/project/DECISIONS.md'), '# DECISIONS\n\n| 编号 | 日期 | 背景 | 决策 | 备选方案 | 后果 | 状态 |\n|---|---|---|---|---|---|---|\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/app.js'), 'export const n = 1;\n');
  const before = readFileSync(join(root, 'docs/project/DECISIONS.md'), 'utf8');
  const srcBefore = readFileSync(join(root, 'src/app.js'), 'utf8');

  const observed = runtime.writeBack({
    root,
    workItem: deliveredItem(),
    decisions: [{ background: 'CI 常红', decision: '先修 flaky test' }],
    invariants: [{ text: 'Receipt 只能由脚本签发' }],
  });
  assert.equal(observed.executed, false);
  assert.equal(observed.authority, 'observe');
  assert.equal(runtime.DEFAULT_AUTHORITY, 'observe');
  assert.ok(observed.wouldAccept);
  assert.equal(observed.wouldAccept.executed, false);
  assert.equal(observed.wouldAccept.would.merge, false);
  assert.equal(observed.wouldAccept.action, 'cartographer.writeBack');
  assert.equal(readFileSync(join(root, 'docs/project/DECISIONS.md'), 'utf8'), before);
  assert.equal(existsSync(join(root, 'docs/project/INVARIANTS.md')), false);
  assert.equal(readFileSync(join(root, 'src/app.js'), 'utf8'), srcBefore);

  // even with write: true, observe must not persist
  const still = runtime.writeBack({
    root,
    workItem: deliveredItem(),
    decisions: [{ background: 'x', decision: 'y' }],
    authority: 'observe',
    write: true,
  });
  assert.equal(still.executed, false);
  assert.equal(readFileSync(join(root, 'docs/project/DECISIONS.md'), 'utf8'), before);
});

test('allowed write after a Delivered work item appends only knowledge-base files', (t) => {
  const root = tmpRoot(t);
  mkdirSync(join(root, 'docs/project'), { recursive: true });
  writeFileSync(
    join(root, 'docs/project/DECISIONS.md'),
    '# DECISIONS\n\n| 编号 | 日期 | 背景 | 决策 | 备选方案 | 后果 | 状态 |\n|---|---|---|---|---|---|---|\n| ADR-001 | 2026-01-01 | 基线 | 采用 T1 | 无 | 记忆可追溯 | accepted |\n',
  );
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/app.js'), 'export const n = 1;\n');
  mkdirSync(join(root, 'packages/app'), { recursive: true });
  writeFileSync(join(root, 'packages/app/index.js'), 'export default {}\n');
  const srcBefore = readFileSync(join(root, 'src/app.js'), 'utf8');
  const pkgBefore = readFileSync(join(root, 'packages/app/index.js'), 'utf8');

  const result = runtime.writeBack({
    root,
    workItem: deliveredItem(),
    decisions: [{ background: 'CI 常红', decision: '先隔离 flaky test', alternatives: '整表重跑', consequences: '日志可追溯' }],
    invariants: [{ text: 'Receipt 只能由脚本签发' }],
    authority: 'execute',
    write: true,
  });
  assert.equal(result.executed, true);
  assert.ok(result.written.some((w) => w.path === 'docs/project/DECISIONS.md' && w.id === 'ADR-002'));
  assert.ok(result.written.some((w) => w.path === 'docs/project/INVARIANTS.md' && w.id === 'INV-001'));
  const decisions = readFileSync(join(root, 'docs/project/DECISIONS.md'), 'utf8');
  const invariants = readFileSync(join(root, 'docs/project/INVARIANTS.md'), 'utf8');
  assert.match(decisions, /ADR-001/);
  assert.match(decisions, /ADR-002/);
  assert.match(decisions, /先隔离 flaky test/);
  assert.match(invariants, /INV-001/);
  assert.match(invariants, /Receipt 只能由脚本签发/);
  assert.equal(readFileSync(join(root, 'src/app.js'), 'utf8'), srcBefore);
  assert.equal(readFileSync(join(root, 'packages/app/index.js'), 'utf8'), pkgBefore);
  assert.equal(existsSync(join(root, '.superbot/ledger/work-items')), false);
});

test('a path outside the knowledge-base allowlist is rejected and business files stay unchanged', (t) => {
  const root = tmpRoot(t);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/app.js'), 'export const n = 1;\n');
  mkdirSync(join(root, 'packages/constitution/scripts'), { recursive: true });
  writeFileSync(join(root, 'packages/constitution/scripts/docs-ready.mjs'), 'export default 1\n');
  const srcBefore = readFileSync(join(root, 'src/app.js'), 'utf8');
  const gateBefore = readFileSync(join(root, 'packages/constitution/scripts/docs-ready.mjs'), 'utf8');

  assert.equal(runtime.isAllowedKnowledgePath?.('src/app.js') ?? runtime.cartographer.isAllowedKnowledgePath('src/app.js'), false);
  assert.throws(
    () => runtime.writeBack({
      root,
      workItem: deliveredItem(),
      authority: 'execute',
      write: true,
      targets: ['src/app.js'],
    }),
    /not allowlisted/,
  );
  assert.throws(
    () => runtime.writeBack({
      root,
      workItem: deliveredItem(),
      authority: 'execute',
      write: true,
      targets: ['packages/constitution/scripts/docs-ready.mjs'],
    }),
    /not allowlisted/,
  );
  assert.throws(
    () => runtime.writeBack({
      root,
      workItem: deliveredItem(),
      authority: 'execute',
      write: true,
      targets: ['.superbot/ledger/work-items/WI-2026-701.json'],
    }),
    /not allowlisted/,
  );
  assert.throws(
    () => runtime.writeBack({
      root,
      workItem: deliveredItem(),
      authority: 'execute',
      write: true,
      targets: ['docs/project/../src/app.js'],
    }),
    /not allowlisted/,
  );
  assert.equal(readFileSync(join(root, 'src/app.js'), 'utf8'), srcBefore);
  assert.equal(readFileSync(join(root, 'packages/constitution/scripts/docs-ready.mjs'), 'utf8'), gateBefore);
});

test('writeBack refuses auto-merge, will not run before Delivered, and the compiler still does not write', (t) => {
  const root = tmpRoot(t);
  assert.throws(
    () => runtime.writeBack({ root, workItem: deliveredItem(), action: 'auto-merge' }),
    (err) => err.code === 'AUTO_MERGE_DISABLED',
  );
  const early = runtime.writeBack({
    root,
    workItem: deliveredItem({ state: 'Building' }),
    decisions: [{ background: 'x', decision: 'y' }],
    authority: 'execute',
    write: true,
  });
  assert.equal(early.executed, false);
  assert.match(early.reason, /Delivered/);
  assert.equal(existsSync(join(root, 'docs/project/DECISIONS.md')), false);

  const compiled = runtime.compileMandate({
    id: 'WI-2026-101',
    intent: '把主干最近 20 次 CI 修到全绿',
    ac: [{ id: 'AC-1', text: '主干最近 20 次 CI 全绿', coveredBy: ['T1'] }],
    nonGoals: [],
    scope: { files: ['scripts/ci.sh'], newFiles: [], owners: ['backend-dev'] },
    gates: ['validate-plan', 'verify'],
    risk: 'R1',
    reversible: true,
  }, { id: 'CS-aaaaaaaaaaaa' });
  const carto = compiled.assembly.capabilities.find((c) => c.state === 'Cartographer');
  assert.equal(carto.writeBack, false);
  assert.equal(carto.writeBackCapable, true);
  assert.equal(existsSync(join(root, 'docs/project/DECISIONS.md')), false);
});
