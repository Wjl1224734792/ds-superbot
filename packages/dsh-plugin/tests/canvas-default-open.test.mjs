/**
 * Goal: a new Session defaults the right sidebar to the Super Bot canvas tab.
 * 开始 stays switchable; the same Session is not forced open again after the
 * user leaves the canvas; workbench and decision cards stay as they are.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CLIENT_URL = new URL('../client.js', import.meta.url);
const ROOT_PKG = new URL('../../../package.json', import.meta.url);
const PLUGIN_PKG = new URL('../package.json', import.meta.url);

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
  const stub = {
    createElement: (type, props, ...children) => {
      const merged = { ...(props || {}) };
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return { type, props: merged, children };
    },
    useState: (init) => {
      const initial = typeof init === 'function' ? init() : init;
      return [initial, () => {}];
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
  return { stub };
}

function createClientContext(options) {
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
    locale: { getLocale: () => ({ id: (options && options.locale) || 'zh-CN' }) },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } },
    configForms: { get: () => ({ getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {}, mutate: async () => true }) },
    uiWorkspace: { openSession: () => {} },
    sidebarRightTabs: {
      register: (definition) => {
        tabTypes.push(definition);
        return () => {};
      },
    },
    sidebarRight: (options && options.sidebarRight) || {
      mounted: { getSnapshot: () => undefined, subscribe: () => () => {} },
      openTab: () => {},
      openResource: () => {},
    },
    sessions: (options && options.sessions) || {
      list: { getSnapshot: () => ({ projectionsBySession: {} }), subscribe: () => () => {} },
    },
    effect: (callback) => { callback(); },
  };
  ctx.inject = (names, run) => run(ctx);
  return { ctx, registered, tabTypes };
}

test('version stays 0.2.1 and copy never uses 舞台', async () => {
  const root = JSON.parse(readFileSync(ROOT_PKG, 'utf8'));
  const plugin = JSON.parse(readFileSync(PLUGIN_PKG, 'utf8'));
  assert.equal(root.version, '0.2.1');
  assert.equal(plugin.version, '0.2.1');
  const source = readFileSync(CLIENT_URL, 'utf8');
  assert.doesNotMatch(source, /舞台/);
  assert.doesNotMatch(source, /['\"]Stage['\"]/);
  assert.match(source, /default-open the canvas on a new Session/);
  assert.doesNotMatch(source, /auto-open the board on a Super Bot dispatch/);
});

test('right tab kind stays superbot and the workbench plus decision cards stay registered', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered, tabTypes } = createClientContext();
  instance.apply(ctx);

  assert.equal(tabTypes.length, 1);
  assert.equal(tabTypes[0].id, 'ds-superbot');
  assert.equal(tabTypes[0].kind, 'superbot');
  const names = registered.map((entry) => entry.options.name);
  assert.ok(names.includes('conversation.view'), 'the workbench tab stays');
  assert.equal(registered.find((entry) => entry.options.name === 'conversation.view').options.id, 'superbot-workbench');
  assert.ok(names.includes('conversation.chat.turnTail'), 'decision cards stay');
  assert.ok(names.includes('sidebar.right.pane.tab'), 'the canvas body stays in the official pane slot');
  assert.equal(names.includes('sidebar.right.tab.guide'), false, '开始 is not replaced');
  assert.equal(names.includes('sidebar'), false);
  assert.equal(names.includes('rightbar'), false);
});

test('a fresh session defaults to the canvas; leaving it is respected until the next session', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));

  const opened = [];
  const mountedListeners = new Set();
  const listListeners = new Set();
  let mounted;
  const { ctx } = createClientContext({
    sidebarRight: {
      mounted: {
        getSnapshot: () => mounted,
        subscribe: (listener) => { mountedListeners.add(listener); return () => mountedListeners.delete(listener); },
      },
      openTab: (kind) => opened.push(kind),
      openResource: () => {},
    },
    sessions: {
      list: {
        getSnapshot: () => ({ projectionsBySession: {} }),
        subscribe: (listener) => { listListeners.add(listener); return () => listListeners.delete(listener); },
      },
    },
  });
  instance.apply(ctx);
  assert.deepEqual(opened, [], 'no open before a session is mounted');

  mounted = 'session-new';
  for (const listener of mountedListeners) listener();
  assert.deepEqual(opened, ['superbot'], 'a new session opens the canvas without a dispatch or header click');

  for (const listener of mountedListeners) listener();
  for (const listener of listListeners) listener();
  assert.deepEqual(opened, ['superbot'], 'closing the canvas or switching back to 开始 is not overridden in this session');

  mounted = 'session-later';
  for (const listener of mountedListeners) listener();
  assert.deepEqual(opened, ['superbot', 'superbot'], 'the next session still defaults to the canvas');
});
