/**
 * Settings logo, session workbench view, and quiet group-chat decision cards.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CLIENT_URL = new URL('../client.js', import.meta.url);
const CLIENT = new URL('../client.js', import.meta.url).pathname;

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

function createClientContext() {
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
    locale: { getLocale: () => ({ id: 'zh-CN' }) },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } },
    configForms: { get: () => ({ getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {}, mutate: async () => true }) },
    uiWorkspace: { openSession: () => {}, sessionId: 'session-1' },
    sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => {}; } },
    sidebarRight: {
      mounted: { getSnapshot: () => 'session-1', subscribe: () => () => {} },
      openTab: (kind) => { selected.push(['openTab', kind]); },
      openResource: () => {},
    },
    sessions: { list: { getSnapshot: () => ({ projectionsBySession: {}, byId: { 'session-1': {} } }), subscribe: () => () => {} } },
    layout: { selectPanel: (id) => { selected.push(['selectPanel', id]); return id; } },
    uiConversation: {
      binding: (sessionId) => ({
        activate: (view) => { selected.push(['activate', sessionId, view]); },
      }),
    },
    effect: (callback) => { callback(); },
  };
  ctx.inject = (names, run) => run(ctx);
  return { ctx, registered, tabTypes, selected };
}

function slot(registered, name, pred) {
  return registered.filter((entry) => entry.options.name === name && (!pred || pred(entry)))[0];
}

function svgLogo(nodes, collect, byClass) {
  const logos = collect(nodes, (node) => node.type === 'svg' && node.props.viewBox === '0 0 64 64');
  return logos[0];
}

function logoMarks(svg, collect) {
  const paths = collect([svg], (node) => node.type === 'path');
  const ellipses = collect([svg], (node) => node.type === 'ellipse');
  return { paths, ellipses };
}

const ITEMS = [
  { id: 'WI-113', state: 'Building', title: '实现导出', face: 'zuo', role: 'backend-dev' },
  { id: 'WI-114', state: 'AwaitingApproval', title: '请批 Mandate', face: 'cang' },
  { id: 'WI-118', state: 'Delivered', title: '导出完成', face: 'zuo' },
  { id: 'WI-115', state: 'Failed', title: '门禁失败', face: 'cang' },
];

test('source no longer steals the session with selectPanel or a left console', () => {
  const source = readFileSync(CLIENT_URL, 'utf8');
  assert.doesNotMatch(source, /layout\.selectPanel\s*\(/);
  assert.doesNotMatch(source, /name:\s*'sidebar\.panellist'/);
  assert.doesNotMatch(source, /key:\s*'ds-superbot-console'/);
  assert.doesNotMatch(source, /function openConsole/);
  assert.match(source, /name:\s*'conversation\.view'/);
  assert.match(source, /superbot-workbench/);
  assert.match(source, /name:\s*'conversation\.chat\.turnTail'/);
  assert.match(source, /name:\s*'settings\.section\.icon'/);
  assert.doesNotMatch(source, /舞台/);
  assert.doesNotMatch(source, /viewBox:\s*'0 0 24 24'/);
});

test('settings section and title-bar entry use the project blue-whale Logo', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);

  const icon = slot(registered, 'settings.section.icon');
  assert.ok(icon);
  assert.equal(icon.options.id, 'superbot');
  const iconHost = harness.expand(icon.component({ size: 18, active: false }));
  const iconSvg = svgLogo(iconHost, harness.collect, harness.byClass);
  assert.ok(iconSvg, 'settings icon renders the 64×64 logo');
  const iconMarks = logoMarks(iconSvg, harness.collect);
  assert.equal(iconMarks.paths[0].props.fill, '#4D6BFE');
  assert.equal(iconMarks.ellipses.length, 2);
  assert.ok(iconMarks.ellipses.every((node) => node.props.fill === '#FFFFFF'));

  const header = slot(registered, 'conversation.session.header.utilities', (entry) => entry.options.id === 'superbot-board');
  const headerHost = harness.expand(header.component({ text: { openPanel: '打开工作台', stageTitle: '工作台' }, openPanel: () => {} }));
  const headerSvg = svgLogo(headerHost, harness.collect, harness.byClass);
  assert.ok(headerSvg, 'title-bar entry uses the project logo');
  const headerMarks = logoMarks(headerSvg, harness.collect);
  assert.equal(headerMarks.paths[0].props.fill, '#4D6BFE');
  assert.equal(headerMarks.ellipses.length, 2);
  assert.doesNotMatch(JSON.stringify(headerSvg.props), /currentColor/);
});

test('workbench view is registered, stays off chat by default, and never calls selectPanel', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered, selected } = createClientContext();
  instance.apply(ctx);
  const view = slot(registered, 'conversation.view');
  assert.equal(view.options.id, 'superbot-workbench');
  const label = typeof view.options.label === 'function' ? view.options.label() : view.options.label;
  assert.equal(label, '工作台');
  assert.equal(selected.filter((row) => row[0] === 'selectPanel' || row[0] === 'activate').length, 0, 'apply must not switch the view');

  const host = await harness.settle(() => view.component({
    ...(typeof view.options.inject === 'function' ? view.options.inject('session-1') : {}),
    workItems: ITEMS,
    text: { tabTitle: '工作台', title: '工作台', stageTitle: '仓 / 探 / 作 / 验', decideTitle: '待你决定', historyTitle: '工作项历史', seeEvidence: '看证据', evidenceTitle: '证据' },
  }));
  const text = host.map((node) => harness.textOf(node)).join('\n');
  assert.match(text, /待你决定/);
  assert.match(text, /工作项历史/);
  assert.match(text, /证据/);
  assert.equal(selected.filter((row) => row[0] === 'selectPanel').length, 0);
});

test('group-chat turnTail shows quiet product cards and can approve or open the workbench', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);
  const entry = slot(registered, 'conversation.chat.turnTail');
  assert.ok(entry);
  const decided = [];
  const opened = [];
  const host = await harness.settle(() => entry.component({
    sessionId: 'session-1',
    seq: 4,
    workItems: ITEMS,
    text: {
      decideTitle: '待你决定',
      cardResult: '结果已就绪',
      cardFailed: '未能完成',
      decideApprove: '批准',
      decideReject: '否决',
      seeEvidence: '看证据',
      decideRejectConfirm: '确定否决这个工作项？此操作需要你确认。',
    },
    onDecide: (item, action) => { decided.push([item.id, action]); },
    confirm: () => true,
    openView: (view, focus) => { opened.push([view, focus]); },
  }));
  const text = host.map((node) => harness.textOf(node)).join('\n');
  assert.match(text, /待你决定/);
  assert.match(text, /请批 Mandate/);
  assert.match(text, /结果已就绪/);
  assert.match(text, /未能完成/);
  assert.match(text, /看证据/);
  assert.doesNotMatch(text, /实现导出/, 'Building stays quiet in chat');
  const cards = harness.collect(host, harness.byClass('stwd-decision-card'));
  assert.equal(cards.length, 3);
  const approve = harness.collect(host, (node) => node.type === 'button' && harness.textOf(node) === '批准')[0];
  approve.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(decided, [['WI-114', 'approve']]);
  const evidence = harness.collect(host, harness.byClass('stwd-decision-card-evidence'))[0];
  evidence.props.onClick();
  assert.equal(opened[0][0], 'superbot-workbench');
});

test('header 待你决定 opens the workbench view, and mini-faces stay still while opening the right workbench', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered, selected } = createClientContext();
  instance.apply(ctx);

  const actions = slot(registered, 'conversation.session.header.actions', (entry) => entry.options.id === 'ds-superbot-decide');
  const opened = [];
  const decideHost = await harness.settle(() => actions.component({
    ...(typeof actions.options.inject === 'function' ? actions.options.inject('session-1') : {}),
    workItems: ITEMS,
    openView: (view) => { opened.push(view); },
  }));
  const button = harness.collect(decideHost, harness.byClass('stwd-decision-count'))[0];
  button.props.onClick();
  assert.deepEqual(opened, ['superbot-workbench']);
  assert.equal(selected.filter((row) => row[0] === 'selectPanel').length, 0);

  const corner = slot(registered, 'conversation.session.header.corner');
  let panel = 0;
  const live = await harness.settle(() => corner.component({
    sessionId: 'session-1',
    workItems: ITEMS,
    text: { stageTitle: '工作台', openPanel: '打开工作台' },
    openPanel: () => { panel += 1; },
  }));
  const minis = harness.collect(live, harness.byClass('stwd-resident-mini'));
  assert.ok(minis.length >= 4);
  assert.ok(minis.every((node) => String(node.props.className).includes('stwd-motion-still')));
  const cang = minis.find((node) => String(node.props.className).includes('stwd-resident--cang'));
  cang.props.onClick();
  assert.equal(panel, 1);
  assert.equal(selected.filter((row) => row[0] === 'selectPanel').length, 0);
});
