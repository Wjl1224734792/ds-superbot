/**
 * Apply CSS classes and an accessible name from an already-computed presenceOf
 * result. This helper must not inspect work-item state or invent a second
 * eye/motion table — the caller passes the presenceOf output in.
 */

export const EYE_IDS = Object.freeze(['idle', 'scan', 'await', 'focus', 'inspect', 'done', 'alert', 'down', 'avert']);
export const MOTION_IDS = Object.freeze(['breathe', 'gaze', 'search', 'work', 'check', 'offer', 'withdraw', 'startle', 'still']);
export const ENERGY_IDS = Object.freeze(['low', 'mid', 'high']);

/**
 * @param {{ face: string, eye: string, motion: string, energy: string, caption?: string }} presence
 * @param {{ reducedMotion?: boolean }} [options]
 * @returns {string}
 */
export function presenceClassNames(presence, options = {}) {
  if (!presence || typeof presence !== 'object') return 'stwd-resident';
  const reduced = Boolean(options.reducedMotion);
  const face = presence.face || 'cang';
  const eye = EYE_IDS.includes(presence.eye) ? presence.eye : 'idle';
  const motion = reduced ? 'still' : (MOTION_IDS.includes(presence.motion) ? presence.motion : 'breathe');
  const energy = ENERGY_IDS.includes(presence.energy) ? presence.energy : 'low';
  const classes = [
    'stwd-resident',
    `stwd-resident--${face}`,
    `stwd-eye-${eye}`,
    `stwd-motion-${motion}`,
    `stwd-energy-${energy}`,
  ];
  if (reduced) classes.push('stwd-reduced');
  return classes.join(' ');
}

/**
 * Turn a presence caption ("仓正在看你 · 待批 WI-114") into an aria-label
 * ("仓，正在看你，待批 WI-114").
 * @param {string} caption
 * @returns {string}
 */
export function ariaLabelFromCaption(caption) {
  const text = String(caption || '').trim();
  const match = text.match(/^(仓|探|作|验)(.+?)(?: · (.+))?$/);
  if (!match) return text;
  return match[3] ? `${match[1]}，${match[2]}，${match[3]}` : `${match[1]}，${match[2]}`;
}

/**
 * @param {{ caption?: string, face?: string }} presence
 * @returns {string}
 */
export function ariaLabelFor(presence) {
  if (presence && presence.caption) return ariaLabelFromCaption(presence.caption);
  return String((presence && presence.face) || '');
}
