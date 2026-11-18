/**
 * Reserved Steward model port. The default adapter is rules-only and
 * never touches the network. Callers may inject `invoke(task, input)`
 * for later model routing; rules still have veto over execution.
 */

export function rulesComplete(task, input = {}) {
  const text = String(input.text ?? input.intent ?? '').trim();
  if (task === 'classify-signal') {
    const hasIntent = text.length > 0;
    return {
      task,
      via: 'rules',
      intent: text,
      usable: hasIntent,
      suggestedRisk: input.risk ?? (hasIntent ? 'R2' : null),
    };
  }
  if (task === 'draft-intent') {
    return {
      task,
      via: 'rules',
      intent: text,
      ac: input.ac ?? [],
    };
  }
  return { task, via: 'rules', input };
}

/**
 * @param {{ invoke?: Function, name?: string }} [options]
 * @returns {{ name: string, kind: 'rules'|'model', complete: Function }}
 */
export function createModelPort(options = {}) {
  const invoke = options.invoke ?? null;
  const name = options.name ?? (invoke ? 'model' : 'rules');
  return {
    name,
    kind: invoke ? 'model' : 'rules',
    /**
     * @param {string} task
     * @param {object} input
     */
    async complete(task, input = {}) {
      const rules = rulesComplete(task, input);
      if (!invoke) return { ok: true, via: 'rules', result: rules };
      const out = await invoke(task, input, rules);
      return { ok: true, via: 'model', result: out, rules };
    },
    completeSync(task, input = {}) {
      if (invoke) {
        const err = new Error('injected model invoke is async; use complete()');
        err.code = 'MODEL_ASYNC';
        throw err;
      }
      return { ok: true, via: 'rules', result: rulesComplete(task, input) };
    },
  };
}

export const RULES_MODEL = createModelPort({ name: 'rules' });
