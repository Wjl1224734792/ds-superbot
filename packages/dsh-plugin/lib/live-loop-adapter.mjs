/**
 * P6 live loop: after a successful `approveDecision`, dispatch the work
 * item through `dispatchWorkItem` + `routeModel` and start a DSH
 * sub-session with the official in-process `subagents.startActivation`.
 *
 * Runtime `dispatchWorkItem` itself still does not start a process or
 * open a network — that contract is unchanged. This adapter never calls
 * the 0.1.0 `superbot_dispatch` tool (work items are 仓/探/作/验, not
 * the seven role ids), never opens HTTP, never auto-merges, and never
 * runs git. Default authority remains observe.
 *
 * `console-model.mjs` stays a pure view helper; wiring lives here.
 */
import { dispatchWorkItem } from '../../runtime/src/loop.mjs';

export const LIVE_PROVIDER = 'spawn';
export const LIVE_PRESET = 'standard';

const RESIDENTS = Object.freeze({
  Steward: { face: 'cang', short: '仓', capability: 'Steward' },
  Cartographer: { face: 'cang', short: '仓', capability: 'Cartographer' },
  Discover: { face: 'tan', short: '探', capability: 'Discover' },
  Scout: { face: 'tan', short: '探', capability: 'Discover' },
  Explorer: { face: 'tan', short: '探', capability: 'Discover' },
  Curator: { face: 'tan', short: '探', capability: 'Discover' },
  Build: { face: 'zuo', short: '作', capability: 'Build' },
  Worker: { face: 'zuo', short: '作', capability: 'Build' },
  Verify: { face: 'yan', short: '验', capability: 'Verify' },
  Verifier: { face: 'yan', short: '验', capability: 'Verify' },
  Critic: { face: 'yan', short: '验', capability: 'Verify' },
  Compiler: { face: 'yan', short: '验', capability: 'Verify' },
});

/**
 * Map a capability / state name onto 仓 / 探 / 作 / 验.
 * @param {unknown} capability
 * @returns {{ face: string, short: string, capability: string }}
 */
export function residentForCapability(capability) {
  const key = String(capability ?? '').trim();
  return RESIDENTS[key] ?? { face: 'cang', short: '仓', capability: key || 'Steward' };
}

/**
 * Board label: resident + capability + work item, so a live-loop child
 * is visually distinct from a seven-role `superbot_dispatch` child.
 * @param {{ resident?: { short?: string, capability?: string }, workItemId?: string }} input
 */
export function liveLoopLabel(input = {}) {
  const resident = input.resident ?? {};
  const who = resident.short && resident.capability
    ? `${resident.short} · ${resident.capability}`
    : String(resident.short ?? resident.capability ?? '仓');
  return `${who} · ${input.workItemId ?? ''}`.trim();
}

function listOf(values) {
  if (!Array.isArray(values) || values.length === 0) return '（无）';
  return values.join('、');
}

function routeLine(route) {
  if (!route) return '继承主代理';
  const provider = route.provider ? String(route.provider) : '';
  const model = route.model ? String(route.model) : '';
  const effort = route.effort ? String(route.effort) : '';
  const named = provider && model
    ? `${provider}/${model}`
    : (model || '继承主代理');
  const effortBit = effort ? ` @ ${effort}` : '';
  const source = route.source ? `（来源 ${route.source}）` : '';
  return `${named}${effortBit}${source}`;
}

/**
 * Self-contained child prompt: work item, mandate, route, isolation.
 * The child does not see the parent conversation.
 * @param {object} input
 * @returns {string}
 */
export function buildLivePrompt(input = {}) {
  const item = input.workItem && typeof input.workItem === 'object' ? input.workItem : {};
  const workItemId = input.workItemId ?? item.id ?? '';
  const mandate = input.mandate ?? {};
  const route = input.route ?? {};
  const assignment = input.assignment ?? {};
  const isolation = input.isolation ?? assignment.isolation ?? {};
  const resident = input.resident ?? residentForCapability(route.capability);
  const goal = mandate.goal ?? item.intent ?? item.title ?? item.goal ?? '';
  const scope = mandate.scope ?? item.scope ?? {};
  const tools = mandate.toolsWhitelist ?? assignment.toolsWhitelist ?? [];
  const budget = mandate.budget ?? assignment.budget ?? {};
  const workDir = assignment.workDir ?? isolation.cwd ?? '';
  const lines = [
    '# 工作项派单（人已批准）',
    '',
    `你是「${resident.short}」（${resident.capability} / ${resident.face}）。这是一份自包含派单，请只在 Mandate 范围内完成该工作项。`,
    '',
    `- 工作项：${workItemId}`,
    `- 目标：${goal || '（见工作项）'}`,
    `- 能力态：${resident.capability}`,
    `- Mandate：${mandate.id ?? '（已签发）'}`,
    `- Mandate 范围 files：${listOf(scope.files)}`,
    `- Mandate 范围 newFiles：${listOf(scope.newFiles)}`,
    `- 工具白名单：${listOf(tools)}`,
    `- 预算：tokens=${budget.tokens ?? 0}，minutes=${budget.minutes ?? 0}`,
    `- 路由：${routeLine(route)}`,
    `- 隔离工作目录：${workDir || '（继承主代理）'}`,
    `- 允许路径：${listOf(isolation.allowPaths)}`,
    `- 允许新建：${listOf(isolation.allowNewFiles)}`,
    '',
    '不要超出 tools / scope / budget。不要自动合并，不要执行 git merge 或 git push。完成后给出证据与回执建议。',
  ];
  return lines.join('\n');
}

/**
 * Turn a `routeModel` result into provider/model/effort, accepting either
 * a split pair or a `provider/name` model string.
 * @param {object|null|undefined} route
 * @returns {{ provider: string, model: string, effort: string }|null}
 */
export function parseRouteForAgentOptions(route) {
  if (!route || typeof route !== 'object') return null;
  let provider = typeof route.provider === 'string' ? route.provider.trim() : '';
  let model = typeof route.model === 'string' ? route.model.trim() : '';
  if (!provider && model.includes('/')) {
    const slash = model.indexOf('/');
    if (slash > 0 && slash < model.length - 1) {
      provider = model.slice(0, slash);
      model = model.slice(slash + 1);
    }
  }
  if (!provider || !model) return null;
  const effort = typeof route.effort === 'string' ? route.effort.trim() : '';
  return { provider, model, effort };
}

async function resolveAgentOptions(ctx, route, signal) {
  const parsed = parseRouteForAgentOptions(route);
  if (!parsed) return { agentOptions: undefined, warning: null };
  const llm = ctx?.get?.('llm') ?? ctx?.llm;
  if (llm === undefined || typeof llm.resolveModelInfo !== 'function') {
    return { agentOptions: undefined, warning: 'llm unavailable; inheriting parent model' };
  }
  try {
    const info = await llm.resolveModelInfo(parsed.provider, parsed.model, signal);
    if (parsed.effort) {
      const supported = Array.isArray(info?.reasoning?.efforts)
        ? info.reasoning.efforts.map((effort) => String(effort.id))
        : [];
      if (!supported.includes(parsed.effort)) {
        return {
          agentOptions: undefined,
          warning: `effort "${parsed.effort}" unsupported; inheriting parent model`,
        };
      }
      return {
        agentOptions: {
          provider: parsed.provider,
          model: parsed.model,
          reasoningEffort: parsed.effort,
        },
        warning: null,
      };
    }
    return {
      agentOptions: { provider: parsed.provider, model: parsed.model },
      warning: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { agentOptions: undefined, warning: `model resolve failed (${message}); inheriting parent model` };
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Dispatch an already-approved work item and try to start a DSH child.
 * The Mandate must already have been issued; a missing agent / subagents
 * / spawn provider does not throw the approval away.
 *
 * @param {string} root
 * @param {object} approval result of `approveDecision` / `handleConsoleDecide`
 * @param {{
 *   ctx?: object,
 *   subagents?: object,
 *   parent?: object,
 *   invocation?: object,
 *   signal?: AbortSignal,
 *   config?: object,
 *   routes?: object,
 *   runId?: string,
 *   cwd?: string,
 *   capability?: string,
 *   role?: string,
 *   risk?: string,
 * }} [options]
 */
export async function startApprovedWorkItem(root, approval = {}, options = {}) {
  const workItem = approval.workItem && typeof approval.workItem === 'object'
    ? approval.workItem
    : options.workItem;
  const mandate = approval.mandate ?? options.mandate ?? null;
  const workItemId = workItem?.id ?? approval.workItemId ?? options.workItemId;
  const dispatched = dispatchWorkItem(root, {
    workItem,
    workItemId,
    mandate,
    config: options.config ?? {},
    routes: options.routes,
    runId: options.runId,
    capability: options.capability,
    role: options.role,
    risk: options.risk,
  });
  const resident = residentForCapability(dispatched.capability);
  const label = liveLoopLabel({ resident, workItemId: dispatched.workItem });
  const itemForPrompt = workItem && typeof workItem === 'object' ? workItem : { id: dispatched.workItem };
  const promptText = buildLivePrompt({
    workItem: itemForPrompt,
    workItemId: dispatched.workItem,
    mandate,
    route: dispatched.route,
    assignment: dispatched.assignment,
    isolation: dispatched.isolation,
    resident,
  });

  const base = {
    dispatch: dispatched,
    route: dispatched.route,
    assignment: dispatched.assignment,
    isolation: dispatched.isolation,
    label,
    resident,
    mandate,
    workItem: dispatched.workItem,
    started: false,
    childId: null,
    network: false,
    autoMerge: false,
    process: null,
    reason: null,
    warning: null,
  };

  const parent = options.parent ?? options.invocation?.agent;
  if (parent === undefined || parent === null) {
    return {
      ...base,
      reason: '没有父代理，Mandate 已签发，子会话未启动',
    };
  }

  const ctx = options.ctx;
  const subagents = options.subagents ?? ctx?.get?.('subagents') ?? ctx?.subagents;
  if (subagents === undefined || typeof subagents.startActivation !== 'function') {
    return {
      ...base,
      reason: 'subagents 服务不可用，Mandate 已签发，子会话未启动',
    };
  }
  const provider = typeof subagents.getProvider === 'function'
    ? subagents.getProvider(LIVE_PROVIDER)
    : undefined;
  if (provider === undefined) {
    return {
      ...base,
      reason: `未注册 "${LIVE_PROVIDER}" 子代理后端，Mandate 已签发，子会话未启动`,
    };
  }

  const { agentOptions, warning } = await resolveAgentOptions(ctx, dispatched.route, options.signal);
  const cwd = typeof options.cwd === 'string' && options.cwd !== ''
    ? options.cwd
    : undefined;

  try {
    const activation = await subagents.startActivation({
      provider: LIVE_PROVIDER,
      label,
      prompt: [{ type: 'text', text: promptText }],
      parent,
      agentPreset: LIVE_PRESET,
      ...(cwd === undefined ? {} : { cwd }),
      ...(agentOptions === undefined ? {} : { agentOptions }),
      signal: options.signal,
      delivery: 'parent',
    });
    const childId = String(activation?.childId ?? '');
    return {
      ...base,
      started: true,
      childId,
      warning,
      reason: null,
    };
  } catch (error) {
    return {
      ...base,
      started: false,
      childId: null,
      warning,
      reason: `startActivation 失败：${errorMessage(error)}。Mandate 已签发，子会话未启动`,
    };
  }
}

