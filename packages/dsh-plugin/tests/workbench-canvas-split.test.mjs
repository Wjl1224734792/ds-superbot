/**
 * Workbench tab vs right-pane canvas split: Super Bot work items stay on the
 * workbench, native DSH subagents stay on the canvas, and clicks focus the tab.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CLIENT_URL = new URL('../client.js', import.meta.url);
const ROOT_PKG = new URL('../../../package.json', import.meta.url);

let clientBundle = null;

async function loadClientFactory() {
  if (clientBundle !== null) return clientBundle;
  const source = readFileSync(CLIENT_URL, 'utf8');
  let loaded = null;
  const previousWindow = globalThis.window;
  globalThis.window = { __ModuleLoader__: { load: (definition) => { loaded = definition; } } };
  try {
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
  } finally {
    globalThis.window = previousWindow;
  }
  assert.ok(loaded, 'the bundle must call window.__ModuleLoader__.load');
  clientBundle = { id: loaded.id, factory: loaded.factory };
  return clientBundle;
}

function createRenderHarness() {
  const cells = new Map();
  const ownerStack = [];
  let owners = new Map();
  let hooks = new Map();
  const enterOwner = (label) => {
    const seen = owners.get(label) || 0;
    owners.set(label, seen + 1);
    return label + '#' + seen;
  };
  const stub = {
    createElement: (type, props, ...children) => {
      const merged = { ...(props || {}) };
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return { type, props: merged, children };
    },
    useState: (init) => {
      const initial = typeof init === 'function' ? init() : init;
      const owner = ownerStack.length > 0 ? ownerStack[ownerStack.length - 1] : 'root';
      const index = hooks.get(owner) || 0;
      hooks.set(owner, index + 1);
      const key = owner + '|' + index;
      if (!cells.has(key)) cells.set(key, { value: initial });
      const cell = cells.get(key);
      return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
    useEffect: (effect) => { effect(); },
    useMemo: (factory) => factory(),
    useRef: (init) => ({ current: init }),
    useCallback: (fn) => fn,
    Fragment: Symbol('Fragment'),
    Component: class {
      constructor(props) { this.props = props; this.state = {}; }
    },
  };
  const expandComponent = (label, render) => {
    ownerStack.push(enterOwner(label));
    try { return render(); } finally { ownerStack.pop(); }
  };
  const expand = (element, out = []) => {
    if (element === null || element === undefined) return out;
    if (typeof element !== 'object') return out;
    if (Array.isArray(element)) {
      for (const item of element) expand(item, out);
      return out;
    }
    const type = element.type;
    if (type === 'style') return out;
    if (type === stub.Fragment) {
      const kids = element.children || (element.props && element.props.children) || [];
      const list = Array.isArray(kids) ? kids : [kids];
      for (const child of list) expand(child, out);
      return out;
    }
    if (typeof type === 'function') {
      const label = type.name || type.displayName || 'anonymous';
      if (type.prototype instanceof stub.Component) {
        return expandComponent(label, () => expand(new type(element.props).render(), out));
      }
      return expandComponent(label, () => expand(type(element.props), out));
    }
    const children = [];
    for (const child of element.children || []) {
      if (child === null || child === undefined) continue;
      if (typeof child === 'object') {
        for (const node of expand(child, [])) children.push(node);
      } else {
        children.push(child);
      }
    }
    out.push({ type, props: element.props || {}, children });
    return out;
  };
  const collect = (nodes, predicate, found = []) => {
    for (const node of nodes) {
      if (predicate(node)) found.push(node);
      collect(node.children.filter((child) => typeof child === 'object'), predicate, found);
    }
    return found;
  };
  const textOf = (node) => node.children.map((child) => (typeof child === 'object' ? textOf(child) : String(child))).join('');
  const byClass = (name) => (node) => typeof node.props.className === 'string' && node.props.className.split(/\s+/).indexOf(name) >= 0;
  const settle = async (make) => {
    let host = [];
    for (let pass = 0; pass < 4; pass += 1) {
      owners = new Map();
      hooks = new Map();
      ownerStack.length = 0;
      host = expand(make());
      if (pass < 3) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return host;
  };
  return { stub, expand, collect, textOf, byClass, settle };
}

function createClientContext(options) {
  const registered = [];
  const tabTypes = [];
  const selected = [];
  const ctx = {
    slots: {
      inject: (name, callback) => callback(),
      register: (definition, component) => {
        registered.push({ options: definition, component });
        return () => {};
      },
    },
    locale: { getLocale: () => ({ id: (options && options.locale) || 'zh-CN' }) },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } },
    configForms: { get: () => ({ getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {}, mutate: async () => true }) },
    uiWorkspace: { openSession: () => {} },
    sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => {}; } },
    sidebarRight: { mounted: { getSnapshot: () => undefined, subscribe: () => () => {} }, openTab: (kind) => selected.push(['tab', kind]), openResource: () => {} },
    sessions: { list: { getSnapshot: () => ({ projectionsBySession: {} }), subscribe: () => () => {} } },
    layout: { selectPanel: (id) => selected.push(['selectPanel', id]) },
    effect: (callback) => { callback(); },
  };
  ctx.inject = (names, run) => run(ctx);
  return { ctx, registered, tabTypes, selected };
}

function slot(registered, name, pred) {
  return registered.find((entry) => entry.options.name === name && (!pred || pred(entry)));
}

const LEDGER_ITEM = {
  id: 'WI-200',
  state: 'AwaitingApproval',
  title: '请批 Mandate',
  face: 'cang',
  mandate: '导出接口要过门禁',
  receipt: { status: 'pending' },
};

const NATIVE_AGENT = {
  id: 'f85c4abb-0e64-4ec0-881e-b8e78e3b2e77',
  title: '你是软件开发团队的后端工程',
  label: 'backend-dev',
  mode: 'one-shot',
  origin: 'agent-row',
};

test('package version stays 0.2.0 and client still uses official additive slots', () => {
  const pkg = JSON.parse(readFileSync(ROOT_PKG, 'utf8'));
  assert.equal(pkg.version, '0.2.0');
  const source = readFileSync(CLIENT_URL, 'utf8');
  assert.match(source, /name:\s*'conversation\.view'/);
  assert.match(source, /superbot-workbench/);
  assert.match(source, /name:\s*'sidebar\.right\.pane\.tab'/);
  assert.match(source, /name:\s*'conversation\.chat\.turnTail'/);
  assert.doesNotMatch(source, /layout\.selectPanel\s*\(/);
  assert.doesNotMatch(source, /canvasTitle: '舞台'/);
  assert.doesNotMatch(source, /canvasTitle: 'Stage'/);
});

test('title helpers skip UUIDs and system prompts, and native agents are not Super Bot work items', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const {
    isUuidLike,
    looksLikeSystemPrompt,
    humanWorkItemTitle,
    isSuperBotWorkItem,
    workItemsFromAgents,
    collectWorkItems,
    HISTORY_LIMIT,
  } = instance.__test;
  assert.equal(HISTORY_LIMIT, 8);
  assert.equal(isUuidLike('f85c4abb-0e64-4ec0-881e-b8e78e3b2e77'), true);
  assert.equal(isUuidLike('WI-200'), false);
  assert.equal(looksLikeSystemPrompt('你是软件开发团队的后端工程'), true);
  assert.equal(looksLikeSystemPrompt('You are the backend engineer'), true);
  assert.equal(looksLikeSystemPrompt('请批 Mandate'), false);
  assert.equal(humanWorkItemTitle(NATIVE_AGENT, { workItemFallback: '工作项' }), 'backend-dev');
  assert.equal(humanWorkItemTitle({ title: 'f85c4abb-0e64-4ec0-881e-b8e78e3b2e77' }, { workItemFallback: '工作项' }), '工作项');
  assert.equal(humanWorkItemTitle(LEDGER_ITEM, { workItemFallback: '工作项' }), '请批 Mandate');
  assert.equal(isSuperBotWorkItem(LEDGER_ITEM), true);
  assert.equal(isSuperBotWorkItem(NATIVE_AGENT), false);
  assert.deepEqual(workItemsFromAgents([NATIVE_AGENT, { ...NATIVE_AGENT, mandate: '写接口' }]).map((item) => item.mandate), ['写接口']);
  assert.deepEqual(collectWorkItems({
    useProjection: (key) => (key === 'subagentCatalog' ? [NATIVE_AGENT] : undefined),
  }), []);
  assert.equal(collectWorkItems({ workItems: [LEDGER_ITEM] })[0].id, 'WI-200');
});

test('the workbench tab stays 工作台, the right tab is 画布, and a new session can open the canvas', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered, tabTypes, selected } = createClientContext();
  instance.apply(ctx);

  const view = slot(registered, 'conversation.view');
  assert.equal(view.options.id, 'superbot-workbench');
  const viewLabel = typeof view.options.label === 'function' ? view.options.label() : view.options.label;
  assert.equal(viewLabel, '工作台');
  assert.equal(selected.length, 0, 'apply must not switch the session view');

  assert.equal(tabTypes[0].id, 'ds-superbot');
  assert.equal(tabTypes[0].kind, 'superbot');
  const tabTitle = typeof tabTypes[0].title === 'function' ? tabTypes[0].title() : tabTypes[0].title;
  assert.equal(tabTitle, '画布');
  assert.doesNotMatch(String(tabTitle), /工作台|舞台|Stage/);

  const utilities = slot(registered, 'conversation.session.header.utilities', (entry) => entry.options.id === 'superbot-board');
  const opened = [];
  const buttonHost = harness.expand(utilities.component({
    ...(typeof utilities.options.inject === 'function' ? utilities.options.inject() : {}),
    openPanel: () => { opened.push('canvas'); },
  }));
  const buttons = harness.collect(buttonHost, harness.byClass('stwd-headbtn'));
  assert.equal(buttons.length, 1, 'the canvas entry is visible on a new session');
  assert.equal(buttons[0].props['aria-label'], '打开画布');
  assert.equal(harness.textOf(harness.collect(buttonHost, harness.byClass('stwd-headbtn-label'))[0]), '画布');
  buttons[0].props.onClick();
  assert.deepEqual(opened, ['canvas']);
});

test('the workbench shows decisions, faces, valued facts and history, never native-agent cards or TeamGraph', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);
  const view = slot(registered, 'conversation.view');
  const face = typeof view.options.inject === 'function' ? view.options.inject('session-split') : {};
  const history = [
    { id: 'WI-201', state: 'Delivered', title: '导出完成', face: 'zuo', receipt: '已交付' },
    { id: 'WI-202', state: 'Failed', title: '门禁失败', face: 'cang' },
  ];
  const host = await harness.settle(() => view.component({
    ...face,
    sessionId: 'session-split',
    workItems: [LEDGER_ITEM, ...history],
    healthy: true,
    authority: 'observe',
    loadRun: async () => ({ status: 'empty', dir: '', artifacts: [] }),
    useProjection: () => undefined,
    useSessions: () => undefined,
    useSessionStatus: () => undefined,
    text: {
      ...face.text,
      decideTitle: '待你决定',
      historyTitle: '工作项历史',
      workItemFallback: '工作项',
    },
  }));
  const text = host.map((node) => harness.textOf(node)).join('\n');
  assert.match(text, /待你决定/);
  assert.match(text, /请批 Mandate/);
  assert.match(text, /导出接口要过门禁/);
  assert.match(text, /工作项历史/);
  assert.match(text, /导出完成/);
  assert.doesNotMatch(text, /授权：observe/);
  assert.doesNotMatch(text, /自动合并不启用/);
  assert.doesNotMatch(text, /任务进度取自 DSH/);
  assert.doesNotMatch(text, /原生任务列表/);
  assert.equal(harness.collect(host, harness.byClass('stwd-graph-view')).length, 0);
  assert.ok(harness.collect(host, harness.byClass('stwd-resident')).length >= 4);

  const nativeHost = await harness.settle(() => view.component({
    ...face,
    sessionId: 'session-native',
    workItems: [],
    loadRun: async () => ({ status: 'empty', dir: '', artifacts: [] }),
    useProjection: (key) => (key === 'subagentCatalog' ? [NATIVE_AGENT] : undefined),
    useSessions: (selector) => selector({
      byId: { [NATIVE_AGENT.id]: { title: NATIVE_AGENT.title } },
      projectionsBySession: {},
    }),
    useSessionStatus: () => undefined,
  }));
  const nativeText = nativeHost.map((node) => harness.textOf(node)).join('\n');
  assert.doesNotMatch(nativeText, /你是软件开发团队/);
  assert.doesNotMatch(nativeText, /f85c4abb-0e64-4ec0-881e-b8e78e3b2e77/);
  assert.doesNotMatch(nativeText, /Mandate/);
  assert.equal(harness.collect(nativeHost, harness.byClass('stwd-graph-view')).length, 0);
});

test('the right canvas mounts TeamGraph for native agents and has no work-item cards or faces', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);
  const entry = slot(registered, 'sidebar.right.pane.tab');
  const face = entry.options.inject('session-canvas');
  const host = await harness.settle(() => entry.component({
    ...face,
    sessionId: 'session-canvas',
    workItems: [LEDGER_ITEM],
    loadRun: async () => ({ status: 'ready', dir: 'tmp/superbot/demo', artifacts: [{ name: 'qa.md', path: 'tmp/superbot/demo/qa.md' }] }),
    useProjection: (key) => (key === 'subagentCatalog' ? [{ id: 'child-a', mode: 'one-shot', label: 'backend-dev · 写接口', createdAt: 1 }] : undefined),
    useSessions: (selector) => selector({ byId: {}, projectionsBySession: {} }),
    useSessionStatus: (selector) => selector(new Map([['child-a', { running: false }]])),
    openSession: () => {},
  }));
  const text = host.map((node) => harness.textOf(node)).join('\n');
  assert.match(text, /画布/);
  assert.doesNotMatch(text, /待你决定/);
  assert.doesNotMatch(text, /请批 Mandate/);
  assert.doesNotMatch(text, /qa\.md/);
  assert.doesNotMatch(text, /任务进度取自 DSH/);
  assert.equal(harness.collect(host, harness.byClass('stwd-gnode')).length, 1);
  assert.ok(harness.collect(host, harness.byClass('stwd-graph-view')).length >= 1);
  assert.equal(harness.collect(host, harness.byClass('stwd-resident')).length, 0);
  assert.equal(harness.collect(host, harness.byClass('stwd-console-decide')).length, 0);
  assert.equal(harness.collect(host, harness.byClass('stwd-artifacts')).length, 0);
  assert.match(text, /鱼骨/);
  assert.match(text, /树状/);
  assert.match(text, /辐射/);
});

test('decision cards, 待你决定, and mini faces open the workbench view and leave the session', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered, selected } = createClientContext();
  instance.apply(ctx);
  const opened = [];
  const cards = slot(registered, 'conversation.chat.turnTail');
  const cardHost = await harness.settle(() => cards.component({
    sessionId: 'session-1',
    seq: 4,
    workItems: [LEDGER_ITEM],
    text: { decideTitle: '待你决定', decideApprove: '批准', decideReject: '否决', seeEvidence: '看证据' },
    openView: (view, focus) => { opened.push(['card', view, focus]); },
  }));
  const evidence = harness.collect(cardHost, harness.byClass('stwd-decision-card-evidence'))[0]
    || harness.collect(cardHost, harness.byClass('stwd-decision-card'))[0];
  evidence.props.onClick();
  assert.equal(opened[0][1], 'superbot-workbench');

  const actions = slot(registered, 'conversation.session.header.actions', (entry) => entry.options.id === 'ds-superbot-decide');
  const decideHost = await harness.settle(() => actions.component({
    sessionId: 'session-1',
    workItems: [LEDGER_ITEM],
    text: { decideTitle: '待你决定' },
    openView: (view) => { opened.push(['header', view]); },
  }));
  const button = harness.collect(decideHost, harness.byClass('stwd-decision-count'))[0];
  button.props.onClick();
  assert.equal(opened[1][1], 'superbot-workbench');

  const corner = slot(registered, 'conversation.session.header.corner');
  let panel = 0;
  const live = await harness.settle(() => corner.component({
    sessionId: 'session-1',
    workItems: [LEDGER_ITEM],
    text: { openWorkbench: '打开工作台', openPanel: '打开工作台' },
    openView: (view) => { opened.push(['faces', view]); },
    openPanel: () => { panel += 1; },
  }));
  const cang = harness.collect(live, harness.byClass('stwd-resident-mini'))
    .find((node) => String(node.props.className).includes('stwd-resident--cang'));
  cang.props.onClick();
  assert.equal(opened[2][1], 'superbot-workbench');
  assert.equal(panel, 0, 'mini faces must not only open the right canvas');
  assert.equal(selected.filter((row) => row[0] === 'selectPanel').length, 0);
});

test('health copy appears on the workbench only when the run is abnormal', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);
  const view = slot(registered, 'conversation.view');
  const face = typeof view.options.inject === 'function' ? view.options.inject('session-health') : {};
  const props = {
    ...face,
    sessionId: 'session-health',
    workItems: [LEDGER_ITEM],
    loadRun: async () => ({ status: 'empty', dir: '', artifacts: [] }),
    useProjection: () => undefined,
    useSessions: () => undefined,
    useSessionStatus: () => undefined,
  };
  const ok = await harness.settle(() => view.component({ ...props, healthy: true, paused: false, authority: 'observe' }));
  assert.equal(harness.collect(ok, harness.byClass('stwd-console-health')).length, 0);
  const paused = await harness.settle(() => view.component({ ...props, healthy: true, paused: true, authority: 'observe' }));
  assert.ok(harness.collect(paused, harness.byClass('stwd-console-health')).length >= 1);
});
