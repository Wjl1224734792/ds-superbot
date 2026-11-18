/**
 * P5 left-console wiring: 批准 → onDecide(approve), 否决 confirms then onDecide(reject).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CLIENT_URL = new URL('../client.js', import.meta.url);
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
    out.push({ type: type, props: element.props || {}, children });
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

function createClientContext(overrides = {}) {
  const registered = [];
  const tabTypes = [];
  const ctx = {
    slots: {
      inject: (name, callback) => callback(),
      register: (definition, component) => {
        registered.push({ options: definition, component });
        return () => {};
      },
    },
    locale: { getLocale: () => ({ id: 'zh-CN' }) },
    remote: {
      session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) },
      commands: overrides.commands || undefined,
    },
    configForms: { get: () => ({ getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {}, mutate: async () => true }) },
    uiWorkspace: { openSession: () => {}, sessionId: overrides.sessionId || 'session-1' },
    sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => {}; } },
    sidebarRight: {
      mounted: { getSnapshot: () => overrides.mounted ?? 'session-1', subscribe: () => () => {} },
      openTab: () => {},
      openResource: () => {},
    },
    sessions: { list: { getSnapshot: () => ({ projectionsBySession: {}, byId: { 'session-1': {} } }), subscribe: () => () => {} } },
    layout: { selectPanel: (id) => id },
    effect: (callback) => { callback(); },
  };
  ctx.inject = (names, run) => run(ctx);
  return { ctx, registered, tabTypes };
}

function slot(registered, name, pred) {
  const found = registered.filter((entry) => entry.options.name === name && (!pred || pred(entry)));
  return found[0];
}

const ITEMS = [
  { id: 'WI-113', state: 'Building', title: '实现导出', face: 'zuo', role: 'backend-dev' },
  { id: 'WI-114', state: 'AwaitingApproval', title: '请批 Mandate', face: 'cang' },
  { id: 'WI-115', state: 'Failed', title: '门禁失败', face: 'cang' },
];

test('left console primary button is 批准 and calls onDecide(approve), not openItem', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);
  const entry = slot(registered, 'main');
  const face = typeof entry.options.inject === 'function' ? entry.options.inject() : {};
  const decided = [];
  const opened = [];
  const host = await harness.settle(() => entry.component({
    ...face,
    workItems: ITEMS,
    healthy: true,
    authority: 'observe',
    onDecide: (item, action) => { decided.push([item.id, action]); return { kind: 'success', text: 'ok' }; },
    onSelectItem: (item) => { opened.push(item.id); },
    openPanel: () => { opened.push('panel'); },
    confirm: () => true,
  }));
  const decide = harness.collect(host, harness.byClass('stwd-console-decide'))[0];
  assert.ok(decide, 'the decision block is rendered');
  const buttons = harness.collect([decide], (node) => node.type === 'button');
  const labels = buttons.map((node) => harness.textOf(node));
  assert.ok(labels.includes('批准'), `expected 批准, got ${labels.join(',')}`);
  assert.ok(labels.includes('否决'));
  assert.ok(!labels.includes('查看'), 'the primary button must no longer be 查看');
  const approve = buttons.find((node) => harness.textOf(node) === '批准');
  approve.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(decided, [['WI-114', 'approve']]);
  assert.deepEqual(opened, []);
});

test('reject still requires confirmation and then calls onDecide(reject)', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);
  const entry = slot(registered, 'main');
  const face = typeof entry.options.inject === 'function' ? entry.options.inject() : {};
  const decided = [];
  let asked = 0;
  const host = await harness.settle(() => entry.component({
    ...face,
    workItems: ITEMS,
    onDecide: (item, action) => { decided.push([item.id, action]); },
    confirm: () => { asked += 1; return false; },
  }));
  const decide = harness.collect(host, harness.byClass('stwd-console-decide'))[0];
  const reject = harness.collect([decide], (node) => node.type === 'button').find((node) => harness.textOf(node) === '否决');
  reject.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(asked, 1);
  assert.deepEqual(decided, [], 'a declined confirm must not reject');

  asked = 0;
  const host2 = await harness.settle(() => entry.component({
    ...face,
    workItems: ITEMS,
    onDecide: (item, action) => { decided.push([item.id, action]); },
    confirm: () => { asked += 1; return true; },
  }));
  const decide2 = harness.collect(host2, harness.byClass('stwd-console-decide'))[0];
  const reject2 = harness.collect([decide2], (node) => node.type === 'button').find((node) => harness.textOf(node) === '否决');
  reject2.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(asked, 1);
  assert.deepEqual(decided, [['WI-114', 'reject']]);
});

test('main slot inject wires onDecide to /superbot-decide via ctx.remote.commands', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const calls = [];
  const { ctx, registered } = createClientContext({
    commands: {
      execute: async (agent, line) => {
        calls.push([agent, line]);
        return { kind: 'success', text: '已批准 WI-114，Mandate MD-1 已签发。' };
      },
    },
  });
  instance.apply(ctx);
  const entry = slot(registered, 'main');
  const face = typeof entry.options.inject === 'function' ? entry.options.inject() : {};
  assert.equal(typeof face.onDecide, 'function', 'inject must pass onDecide');
  const result = await face.onDecide({ id: 'WI-114' }, 'approve');
  assert.deepEqual(calls, [['session-1', '/superbot-decide approve WI-114']]);
  assert.equal(result.kind, 'success');

  await face.onDecide({ id: 'WI-115' }, 'reject');
  assert.deepEqual(calls[1], ['session-1', '/superbot-decide reject WI-115']);
});

test('createConsoleOnDecide reports a missing command channel instead of inventing HTTP', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx } = createClientContext({ commands: undefined });
  ctx.remote.commands = undefined;
  const onDecide = instance.__test.createConsoleOnDecide(ctx, {
    decideNeedCommand: 'no-commands',
    decideNeedSession: 'no-session',
  });
  const result = await onDecide({ id: 'WI-114' }, 'approve');
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'error');
  assert.equal(result.text, 'no-commands');
});
