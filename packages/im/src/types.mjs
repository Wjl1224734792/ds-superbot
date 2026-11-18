/** Shared constants for the IM protocol package. */

export const FACES = Object.freeze(['cang', 'tan', 'zuo', 'yan']);

export const FACE_LABEL = Object.freeze({
  cang: '仓',
  tan: '探',
  zuo: '作',
  yan: '验',
});

export const EYES = Object.freeze(['idle', 'scan', 'await', 'focus', 'inspect', 'done', 'alert', 'down', 'avert']);
export const MOTIONS = Object.freeze(['breathe', 'gaze', 'search', 'work', 'check', 'offer', 'withdraw', 'startle', 'still']);
export const ENERGIES = Object.freeze(['low', 'mid', 'high']);
export const SPEAK_KINDS = Object.freeze(['workitem', 'approval', 'result']);
export const SPEAK_REASONS = Object.freeze(['needs-decision', 'result-ready', 'failed']);
