import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  FACES, FACE_LABEL, allowSpeak, renderCard, presenceOf, presenceField,
} from '../src/index.mjs';

const STATES = [
  'Signal', 'Candidate', 'Dropped', 'Explored', 'Proposed', 'AwaitingApproval',
  'Authorized', 'Parked', 'Planned', 'Approved', 'Building', 'Verifying',
  'Delivered', 'Failed',
];

const CAPTION = /^(仓|探|作|验).+?(?: · (?:待批 )?WI-\d{4}-\d{3,})?$/;

test('export shape', () => {
  assert.deepEqual(FACES, ['cang', 'tan', 'zuo', 'yan']);
  assert.equal(typeof presenceOf, 'function');
  assert.equal(typeof allowSpeak, 'function');
  assert.equal(typeof renderCard, 'function');
});

test('speak allowlist: only workitem (needs-decision), approval, and terminal result', () => {
  assert.equal(allowSpeak({ kind: 'approval', state: 'AwaitingApproval' }).ok, true);
  assert.equal(allowSpeak({ kind: 'workitem', state: 'AwaitingApproval' }).ok, true);
  assert.equal(allowSpeak({ kind: 'workitem', state: 'Building' }).ok, false);
  assert.equal(allowSpeak({ kind: 'result', state: 'Delivered', hasNewResult: true }).ok, true);
  assert.equal(allowSpeak({ kind: 'result', state: 'Failed' }).ok, true);
  assert.equal(allowSpeak({ kind: 'result', state: 'Building' }).ok, false);
  assert.equal(allowSpeak({ kind: 'heartbeat', state: 'Building' }).ok, false);
  assert.equal(allowSpeak({ kind: 'analyzing' }).ok, false);
});

test('card snapshots follow the locked templates', () => {
  const item = {
    id: 'WI-2026-114',
    state: 'Proposed',
    intent: '把 CI 红灯率降到 0',
    ac: [{ id: 'AC-1', text: '主干最近 20 次 CI 全绿', coveredBy: [] }],
    nonGoals: ['不改发布流程'],
    risk: 'R2',
    reversible: true,
    authority: 'human-approval',
    scope: { files: ['scripts/ci.sh'], newFiles: [], owners: ['backend-dev'] },
    gates: ['validate-plan', 'docs-ready', 'verify', 'review'],
    origin: { evidence: [] },
    receipts: [],
    thread: 'TH-repo-ops-ci',
  };
  const work = renderCard('workitem', item);
  assert.match(work, /^【工作项】WI-2026-114  状态：Proposed$/m);
  assert.match(work, /^意图：把 CI 红灯率降到 0$/m);
  assert.match(work, /风险：R2   可逆：是   授权：human-approval/);
  const approval = renderCard('approval', item);
  assert.equal(
    approval,
    [
      '【审批】WI-2026-114  请批 Mandate',
      '请你确认或改：AC / 非目标 / 风险 / 文件范围',
      '批准后将签发不可变 Mandate，超时与文档漂移会自动吊销',
      '回复：批准 / 改 AC：… / 否决',
    ].join('\n'),
  );
  const result = renderCard('result', { ...item, state: 'Delivered' }, {
    conclusion: 'CI 已连续 20 次全绿',
    acResults: [{ id: 'AC-1', status: '通过', evidence: 'reports/ci.txt' }],
    receipts: [{ gate: 'validate-plan', status: 'pass' }, { gate: 'verify', status: 'pass' }],
    artifact: 'PR#12',
  });
  assert.match(result, /^【结果】WI-2026-114  状态：Delivered$/m);
  assert.match(result, /请你：合并 \/ 打回/);
});

function item(state, id = 'WI-2026-114') {
  return { id, state };
}

test('presenceOf covers every work-item state × four faces', () => {
  for (const state of STATES) {
    const speakKind = state === 'Delivered' || state === 'Failed' ? 'result'
      : (state === 'AwaitingApproval' || state === 'Proposed' ? 'approval' : undefined);
    const highs = [];
    for (const face of FACES) {
      const p = presenceOf({ workItem: item(state), face, speakKind });
      assert.equal(p.face, face, `${state}/${face}`);
      assert.ok(['idle', 'scan', 'await', 'focus', 'inspect', 'done', 'alert', 'down', 'avert'].includes(p.eye), `${state}/${face} eye ${p.eye}`);
      assert.ok(['breathe', 'gaze', 'search', 'work', 'check', 'offer', 'withdraw', 'startle', 'still'].includes(p.motion), `${state}/${face} motion ${p.motion}`);
      assert.ok(['low', 'mid', 'high'].includes(p.energy), `${state}/${face} energy`);
      assert.match(p.caption, CAPTION, `${state}/${face} caption: ${p.caption}`);
      assert.ok([...p.caption].length <= 24, `caption too long: ${p.caption}`);
      if (p.energy === 'high') highs.push(face);
    }
    assert.ok(highs.length <= 1, `${state} has ${highs.length} high faces: ${highs}`);
  }
});

test('presence mapping matches INTERACTION.md for key states', () => {
  const explored = presenceOf({ workItem: item('Explored'), face: 'tan' });
  assert.deepEqual({ eye: explored.eye, motion: explored.motion, energy: explored.energy }, { eye: 'scan', motion: 'search', energy: 'mid' });

  const waiting = presenceOf({ workItem: item('AwaitingApproval'), face: 'cang' });
  assert.equal(waiting.eye, 'await');
  assert.equal(waiting.motion, 'gaze');
  assert.equal(waiting.energy, 'high');
  assert.equal(waiting.caption, '仓正在看你 · 待批 WI-2026-114');

  const building = presenceOf({ workItem: item('Building'), face: 'zuo' });
  assert.deepEqual({ eye: building.eye, motion: building.motion, energy: building.energy }, { eye: 'focus', motion: 'work', energy: 'mid' });
  assert.equal(building.caption, '作正在施工 · WI-2026-114');

  const verifying = presenceOf({ workItem: item('Verifying'), face: 'yan' });
  assert.deepEqual({ eye: verifying.eye, motion: verifying.motion, energy: verifying.energy }, { eye: 'inspect', motion: 'check', energy: 'mid' });
  assert.equal(verifying.caption, '验正在核对 · WI-2026-114');

  const delivered = presenceOf({ workItem: item('Delivered'), face: 'cang', speakKind: 'result' });
  assert.equal(delivered.eye, 'done');
  assert.equal(delivered.motion, 'offer');
  assert.equal(delivered.energy, 'high');
  assert.equal(delivered.caption, '仓已交出结果 · WI-2026-114');

  const failed = presenceOf({ workItem: item('Failed'), face: 'cang' });
  assert.equal(failed.eye, 'alert');
  assert.equal(failed.motion, 'startle');
  assert.equal(failed.energy, 'high');

  const parked = presenceOf({ workItem: item('Parked'), face: 'tan' });
  assert.deepEqual({ eye: parked.eye, motion: parked.motion, energy: parked.energy }, { eye: 'down', motion: 'still', energy: 'low' });
});

test('a presence field never has more than one high-energy face', () => {
  for (const state of STATES) {
    for (const speakKind of [undefined, 'approval', 'result']) {
      const field = presenceField(item(state), speakKind);
      const highs = FACES.filter((f) => field[f].energy === 'high');
      assert.ok(highs.length <= 1, `${state}/${speakKind}: ${highs}`);
    }
  }
});

test('placeholder resident SVGs exist, are distinguishable, and are marked 占位', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../dsh-plugin/assets/residents');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(readme, /占位/);
  const bodies = {};
  for (const face of FACES) {
    const file = join(root, face, 'face.svg');
    assert.ok(existsSync(file), file);
    const svg = readFileSync(file, 'utf8');
    assert.match(svg, /<svg[\s>]/);
    assert.match(svg, /占位/);
    bodies[face] = svg;
  }
  const unique = new Set(Object.values(bodies));
  assert.equal(unique.size, 4, 'the four placeholder faces must not be identical');
});
