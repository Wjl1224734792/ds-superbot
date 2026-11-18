/**
 * presenceOf is the single mapping from a work-item state + face + speakKind
 * to eye / motion / energy / caption. Panels and card captions must call this
 * function; do not fork another branch table in client.js.
 *
 * Energy may only be low | mid | high. At most one face in the field may be
 * high at the same moment. Conflict priority: alert > await > offer; others
 * drop to mid or low.
 */
import { FACE_LABEL, FACES } from './types.mjs';

const IDLE = { eye: 'idle', motion: 'breathe', energy: 'low' };
const AVERT = { eye: 'avert', motion: 'withdraw', energy: 'low' };
const DOWN = { eye: 'down', motion: 'still', energy: 'low' };

const HIGH_PRIORITY = { alert: 3, await: 2, offer: 1 };

function pose(eye, motion, energy) {
  return { eye, motion, energy };
}

/**
 * Raw per-face pose before the global high-energy cap is applied.
 */
export function rawPresence(state, face, speakKind) {
  const resultMoment = speakKind === 'result' || speakKind === 'result-ready';
  const approvalMoment = speakKind === 'approval' || speakKind === 'needs-decision' || !speakKind;

  switch (state) {
    case 'Candidate':
    case 'Explored':
      if (face === 'tan') return pose('scan', 'search', 'mid');
      return { ...IDLE };
    case 'Proposed':
      if (face === 'cang' && approvalMoment) return pose('await', 'gaze', 'high');
      if (face === 'tan') return { ...AVERT };
      return { ...IDLE };
    case 'AwaitingApproval':
      if (face === 'cang') return pose('await', 'gaze', 'high');
      return { ...AVERT };
    case 'Authorized':
    case 'Planned':
    case 'Approved':
    case 'Signal':
      return { ...IDLE };
    case 'Building':
      if (face === 'zuo') return pose('focus', 'work', 'mid');
      if (face === 'tan') return { ...AVERT };
      return { ...IDLE };
    case 'Verifying':
      if (face === 'yan') return pose('inspect', 'check', 'mid');
      if (face === 'tan' || face === 'zuo') return { ...AVERT };
      return { ...IDLE };
    case 'Delivered':
      if (resultMoment && face === 'cang') return pose('done', 'offer', 'high');
      if (resultMoment && face === 'yan') return pose('done', 'check', 'mid');
      return { ...IDLE };
    case 'Failed':
      if (face === 'cang') return pose('alert', 'startle', 'high');
      return { ...DOWN };
    case 'Parked':
    case 'Dropped':
      return { ...DOWN };
    default:
      return { ...IDLE };
  }
}

export function captionFor(face, state, workItem, poseValue, speakKind) {
  const who = FACE_LABEL[face] ?? face;
  const id = workItem?.id;
  const tail = id ? ` · ${id}` : '';
  const resultMoment = speakKind === 'result' || speakKind === 'result-ready';
  let verb;
  if (poseValue.eye === 'await') verb = '正在看你';
  else if (poseValue.motion === 'offer' || (state === 'Delivered' && resultMoment && face === 'cang')) verb = '已交出结果';
  else if (poseValue.eye === 'alert') verb = '发现失败';
  else if (poseValue.eye === 'focus') verb = '正在施工';
  else if (poseValue.eye === 'inspect') verb = '正在核对';
  else if (poseValue.eye === 'scan') verb = '正在取证';
  else if (poseValue.eye === 'down') verb = '已经停下';
  else if (poseValue.eye === 'avert') verb = '正在待命';
  else if (poseValue.eye === 'done') verb = face === 'cang' ? '已交出结果' : '完成核对';
  else verb = '正在待命';

  // Special tighter captions used in INTERACTION.md examples.
  if (poseValue.eye === 'await' && (state === 'AwaitingApproval' || state === 'Proposed')) {
    verb = '正在看你';
    const cap = id ? `${who}${verb} · 待批 ${id}` : `${who}${verb}`;
    return cap;
  }
  return `${who}${verb}${tail}`;
}

function countHan(text) {
  // Used only as a soft check in tests; INTERACTION caps captions at 20 han.
  return Array.from(text).length;
}

/**
 * Apply the "at most one high" cap. Priority: alert > await > offer.
 * @param {Record<string, { eye: string, motion: string, energy: string }>} field
 */
export function capHighEnergy(field) {
  const highs = FACES.filter((f) => field[f].energy === 'high');
  if (highs.length <= 1) return field;
  highs.sort((a, b) => {
    const pa = HIGH_PRIORITY[field[a].motion] ?? HIGH_PRIORITY[field[a].eye] ?? 0;
    const pb = HIGH_PRIORITY[field[b].motion] ?? HIGH_PRIORITY[field[b].eye] ?? 0;
    return pb - pa;
  });
  const winner = highs[0];
  const next = { ...field };
  for (const face of highs.slice(1)) {
    next[face] = { ...next[face], energy: next[face].energy === 'high' ? 'mid' : next[face].energy };
  }
  // keep winner
  next[winner] = field[winner];
  return next;
}

/**
 * All four faces for a work item, with the high-energy cap applied.
 */
export function presenceField(workItem, speakKind) {
  const state = workItem?.state ?? 'Signal';
  const raw = {};
  for (const face of FACES) raw[face] = rawPresence(state, face, speakKind);
  return capHighEnergy(raw);
}

/**
 * @param {{ workItem: object, face: string, speakKind?: string }} input
 * @returns {{ face: string, eye: string, motion: string, energy: string, caption: string }}
 */
export function presenceOf({ workItem, face, speakKind } = {}) {
  if (!FACES.includes(face)) {
    throw new Error(`unknown face: ${face}`);
  }
  const field = presenceField(workItem, speakKind);
  const poseValue = field[face];
  const caption = captionFor(face, workItem?.state, workItem, poseValue, speakKind);
  return { face, eye: poseValue.eye, motion: poseValue.motion, energy: poseValue.energy, caption };
}

export { countHan };
