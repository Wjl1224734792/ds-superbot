/**
 * Limited auto-low live path (plugin side).
 *
 * When `evalPolicy` matches `auto-low`, automatically call
 * `dispatchAutoLow` (`dispatchWorkItem` + `routeModel` + isolation) and,
 * if a parent / subagents context exists, start a DSH sub-session.
 * Does not call `approveDecision` and does not issue a Mandate as a
 * machine. Watchdog for these items stays observe until a later human
 * approve. No auto-merge, no git push, no HTTP, no default-authority flip.
 *
 * `console-model.mjs` stays a pure view helper.
 */
import {
  canApplyAutoLow,
  dispatchAutoLow,
  DEFAULT_AUTHORITY,
} from '../../runtime/src/auto-low.mjs';
import { canExecute } from '../../runtime/src/loop.mjs';
import {
  LIVE_PRESET,
  LIVE_PROVIDER,
  liveLoopLabel,
  parseRouteForAgentOptions,
  residentForCapability,
} from './live-loop-adapter.mjs';

export { canApplyAutoLow, dispatchAutoLow, DEFAULT_AUTHORITY };

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
 * Self-contained auto-low prompt: no Mandate, not a human-approved path.
 */
export function buildAutoLowPrompt(input = {}) {
  const item = input.workItem && typeof input.workItem === 'object' ? input.workItem : {};
  const workItemId = input.workItemId ?? item.id ?? '';
  const route = input.route ?? {};
  const assignment = input.assignment ?? {};
  const isolation = input.isolation ?? assignment.isolation ?? {};
  const resident = input.resident ?? residentForCapability(route.capability);
  const goal = item.intent ?? item.title ?? item.goal ?? '';
  const scope = item.scope ?? {};
  const tools = assignment.toolsWhitelist ?? [];
  const budget = assignment.budget ?? {};
  const workDir = assignment.workDir ?? isolation.cwd ?? '';
  const lines = [
    '# 工作项派单（有限 auto-low，未签发 Mandate）',
    '',
    `你是「${resident.short}」（${resident.capability} / ${resident.face}）。这是一份自包含的有限 auto-low 派单，请只在工作项范围内探索 / 计划 / 构建 / 验证。`,
    '',
    `- 工作项：${workItemId}`,
    `- 目标：${goal || '（见工作项）'}`,
    `- 能力态：${resident.capability}`,
    `- 策略规则：auto-low`,
    `- 范围 files：${listOf(scope.files)}`,
    `- 范围 newFiles：${listOf(scope.newFiles)}`,
    `- 工具白名单：${listOf(tools)}`,
    `- 预算：tokens=${budget.tokens ?? 0}，minutes=${budget.minutes ?? 0}`,
    `- 路由：${routeLine(route)}`,
    `- 隔离工作目录：${workDir || '（继承主代理）'}`,
    `- 允许路径：${listOf(isolation.allowPaths)}`,
    `- 允许新建：${listOf(isolation.allowNewFiles)}`,
    '',
    '未签发 Mandate，不得按 execute 授权理解本派单。不要超出范围。不要自动合并，不要执行 git merge 或 git push。完成后给出证据与回执建议。',
  ];
  return lines.join('\n');
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
 * Apply limited auto-low: dispatch without a Mandate, optionally start
 * a DSH child. Never arms the execute Watchdog loop.
 *
 * @param {string} root
 * @param {object} input work item or `{ workItem, workItemId, ... }`
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
 * }} [options]
 */
export async function applyAutoLow(root, input = {}, options = {}) {
  const dispatched = dispatchAutoLow(root, {
    ...(input && typeof input === 'object' && !input.id ? input : { workItem: input }),
    config: options.config ?? input.config ?? {},
    routes: options.routes ?? input.routes,
    runId: options.runId ?? input.runId,
    capability: options.capability ?? input.capability,
    role: options.role ?? input.role,
    risk: options.risk ?? input.risk,
  });

  const executeGrant = dispatched.workItem && root
    ? canExecute(root, dispatched.workItem)
    : { allowed: false, authority: DEFAULT_AUTHORITY };

  const base = {
    ...dispatched,
    label: null,
    resident: null,
    childId: null,
    warning: null,
    executeArmed: false,
    canExecute: executeGrant.allowed === true,
    defaultAuthority: DEFAULT_AUTHORITY,
  };

  if (!dispatched.applied) {
    return {
      ...base,
      started: false,
      reason: dispatched.reason,
    };
  }

  const resident = residentForCapability(dispatched.capability ?? dispatched.dispatch?.capability);
  const label = liveLoopLabel({ resident, workItemId: dispatched.workItem });
  const promptText = buildAutoLowPrompt({
    workItem: dispatched.item,
    workItemId: dispatched.workItem,
    route: dispatched.route,
    assignment: dispatched.assignment,
    isolation: dispatched.isolation,
    resident,
  });
  const withPrompt = {
    ...base,
    label,
    resident,
    prompt: promptText,
  };

  const parent = options.parent ?? options.invocation?.agent;
  if (parent === undefined || parent === null) {
    return {
      ...withPrompt,
      started: false,
      reason: '没有父代理，未签发 Mandate，子会话未启动',
    };
  }

  const ctx = options.ctx;
  const subagents = options.subagents ?? ctx?.get?.('subagents') ?? ctx?.subagents;
  if (subagents === undefined || typeof subagents.startActivation !== 'function') {
    return {
      ...withPrompt,
      started: false,
      reason: 'subagents 服务不可用，未签发 Mandate，子会话未启动',
    };
  }
  const provider = typeof subagents.getProvider === 'function'
    ? subagents.getProvider(LIVE_PROVIDER)
    : undefined;
  if (provider === undefined) {
    return {
      ...withPrompt,
      started: false,
      reason: `未注册 "${LIVE_PROVIDER}" 子代理后端，未签发 Mandate，子会话未启动`,
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
    return {
      ...withPrompt,
      started: true,
      childId: String(activation?.childId ?? ''),
      warning,
      reason: null,
    };
  } catch (error) {
    return {
      ...withPrompt,
      started: false,
      childId: null,
      warning,
      reason: `startActivation 失败：${errorMessage(error)}。未签发 Mandate，子会话未启动`,
    };
  }
}

