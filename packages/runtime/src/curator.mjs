/**
 * Curator: rank candidates and return only Top-K.
 *
 * Score (higher is better) =
 *   W_VALUE * value +
 *   W_REVERSIBLE * (reversible ? 1 : 0) +
 *   W_EVIDENCE * evidenceCount -
 *   W_ATTENTION * attentionCost
 *
 * Weights are constants, documented here and in docs/DEVELOPMENT.md.
 * value, evidenceCount, attentionCost are explicit fields on each candidate
 * (P0 does not infer them with a model).
 */
export const WEIGHTS = Object.freeze({
  value: 4,
  reversible: 2,
  evidence: 1,
  attention: 3,
});

function score(candidate) {
  const value = Number(candidate.value ?? 0);
  const reversible = candidate.reversible ? 1 : 0;
  const evidenceCount = Number(candidate.evidenceCount ?? candidate.evidence?.length ?? 0);
  const attentionCost = Number(candidate.attentionCost ?? 1);
  return (
    WEIGHTS.value * value +
    WEIGHTS.reversible * reversible +
    WEIGHTS.evidence * evidenceCount -
    WEIGHTS.attention * attentionCost
  );
}

/**
 * @param {object[]} candidates
 * @param {{ k?: number }} [options]
 * @returns {{ top: object[], archived: object[] }}
 */
export function rank(candidates = [], { k = 3 } = {}) {
  const decorated = candidates.map((c, i) => ({
    candidate: c,
    index: i,
    score: score(c),
  }));
  decorated.sort((a, b) => b.score - a.score || a.index - b.index);
  const top = decorated.slice(0, Math.max(0, k)).map((row) => ({ ...row.candidate, score: row.score }));
  const archived = decorated.slice(Math.max(0, k)).map((row) => ({ ...row.candidate, score: row.score }));
  return { top, archived };
}
