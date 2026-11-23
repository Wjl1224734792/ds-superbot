/**
 * Goal: a new Session defaults the right sidebar to the Super Bot canvas tab.
 * 开始 stays switchable; the same Session is not forced open again after the
 * user leaves the canvas; workbench and decision cards stay as they are.
 *
 * Timing: after restart the official rightbar is collapsed and a new Session
 * seeds 开始. openTab not throwing is not success; only a confirmed active
 * canvas tab is recorded, after layout.openRightbar(true, false).
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
  const injected = [];
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
    layout: (options && options.layout) || { openRightbar: () => {}, closeRightbar: () => {} },
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
      active: () => undefined,
      isExpanded: () => false,
    },
    sessions: (options && options.sessions) || {
      list: { getSnapshot: () => ({ projectionsBySession: {} }), subscribe: () => () => {} },
    },
    effect: (callback) => { callback(); },
  };
  ctx.inject = (names, run) => {
    injected.push(names);
    run(ctx);
  };
  return { ctx, registered, tabTypes, injected };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kindsOf(calls, name) {
  return calls.filter((entry) => entry[0] === name);
}

test('version stays 0.2.5 and copy never uses 舞台', async () => {
  const root = JSON.parse(readFileSync(ROOT_PKG, 'utf8'));
  const plugin = JSON.parse(readFileSync(PLUGIN_PKG, 'utf8'));
  assert.equal(root.version, '0.2.5');
  assert.equal(plugin.version, '0.2.5');
  const source = readFileSync(CLIENT_URL, 'utf8');
  assert.doesNotMatch(source, /舞台/);
  assert.doesNotMatch(source, /['"]Stage['"]/);
  assert.match(source, /default-open the canvas on a new Session/);
  assert.doesNotMatch(source, /auto-open the board on a Super Bot dispatch/);
  assert.match(source, /openRightbar\(true, false\)/);
});

test('right tab kind stays superbot and the workbench plus decision cards stay registered', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered, tabTypes, injected } = createClientContext();
  instance.apply(ctx);

  assert.equal(tabTypes.length, 1);
  assert.equal(tabTypes[0].id, 'ds-superbot');
  assert.equal(tabTypes[0].kind, 'superbot');
  const guide = tabTypes[0].guide;
  assert.ok(Array.isArray(guide) && guide.length === 1, 'the official 开始 list gets a 画布 guide entry');
  assert.equal(guide[0].id, 'superbot-board');
  assert.equal(guide[0].order, 40);
  assert.equal(typeof guide[0].title, 'function');
  assert.equal(guide[0].title(), '画布');
  assert.equal(typeof guide[0].description, 'function');
  assert.equal(guide[0].description(), '角色 · 模型 · 任务 · 状态');
  assert.equal(typeof guide[0].icon, 'function', 'the 开始 card carries an icon instead of the cube placeholder');
  const guideIcon = guide[0].icon({ size: 26 });
  assert.equal(guideIcon.type, 'svg');
  assert.equal(guideIcon.props.width, 26);
  const iconFills = (guideIcon.children || []).map((child) => child && child.props && child.props.fill);
  assert.ok(iconFills.includes('#4D6BFE'), 'the 开始 card draws the project logo, not a placeholder');
  const names = registered.map((entry) => entry.options.name);
  assert.ok(names.includes('conversation.view'), 'the workbench tab stays');
  assert.equal(registered.find((entry) => entry.options.name === 'conversation.view').options.id, 'superbot-workbench');
  assert.ok(names.includes('conversation.chat.turnTail'), 'decision cards stay');
  assert.ok(names.includes('sidebar.right.pane.tab'), 'the canvas body stays in the official pane slot');
  assert.equal(names.includes('sidebar.right.tab.guide'), false, '开始 is not replaced');
  assert.equal(names.includes('sidebar'), false);
  assert.equal(names.includes('rightbar'), false);
  assert.equal(
    injected.length,
    0,
    'the canvas registers directly once both Sidebar services exist, without a deferred ctx.inject',
  );
  assert.equal(
    typeof ctx === 'object' && ctx.inject !== undefined,
    true,
    'the harness still answers ctx.inject for the other registrations',
  );
});

test('the canvas registers when the right-Sidebar services arrive after a cold start', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const tabTypes = [];
  const handlers = [];
  const cleanups = [];
  const ctx = {
    slots: { inject: (name, callback) => callback(), register: () => () => {} },
    locale: { getLocale: () => ({ id: 'zh-CN' }) },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } },
    configForms: {
      get: () => ({ getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {}, mutate: async () => true }),
    },
    uiWorkspace: { openSession: () => {} },
    effect: (callback) => {
      const cleanup = callback();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    },
    on: (name, callback) => {
      handlers.push({ name, callback });
      return () => {};
    },
  };
  instance.apply(ctx);
  assert.equal(tabTypes.length, 0, 'nothing registers before the Sidebar services exist');
  ctx.sidebarRight = {
    mounted: { getSnapshot: () => undefined, subscribe: () => () => {} },
    openTab: () => {},
    openResource: () => {},
  };
  ctx.sidebarRightTabs = {
    register: (definition) => {
      tabTypes.push(definition);
      return () => {};
    },
  };
  const serviceHandlers = handlers.filter((entry) => entry.name === 'internal/service');
  assert.ok(serviceHandlers.length > 0, 'the plugin listens for service publication');
  for (const handler of serviceHandlers) handler.callback('sidebarRightTabs', ctx.sidebarRightTabs);
  for (const cleanup of cleanups) cleanup();
  assert.equal(tabTypes.length, 1, 'the service publication finishes the canvas registration');
  assert.equal(tabTypes[0].id, 'ds-superbot');
  assert.equal(tabTypes[0].kind, 'superbot');
});

test('a fresh session defaults to the canvas; leaving it is respected until the next session', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));

  const calls = [];
  const mountedListeners = new Set();
  const listListeners = new Set();
  let mounted;
  let activeKind;
  let expanded = false;
  const { ctx } = createClientContext({
    layout: {
      openRightbar: (track, fullscreen) => { calls.push(['openRightbar', track, fullscreen]); },
      closeRightbar: () => { calls.push(['closeRightbar']); },
    },
    sidebarRight: {
      mounted: {
        getSnapshot: () => mounted,
        subscribe: (listener) => { mountedListeners.add(listener); return () => mountedListeners.delete(listener); },
      },
      openTab: (kind) => {
        calls.push(['openTab', kind]);
        activeKind = kind;
        expanded = true;
      },
      openResource: () => {},
      active: () => (activeKind ? { kind: activeKind, id: `tab-${activeKind}` } : undefined),
      isExpanded: () => expanded,
    },
    sessions: {
      list: {
        getSnapshot: () => ({ projectionsBySession: {} }),
        subscribe: (listener) => { listListeners.add(listener); return () => listListeners.delete(listener); },
      },
    },
  });
  instance.apply(ctx);
  assert.deepEqual(kindsOf(calls, 'openTab'), [], 'no open before a session is mounted');

  mounted = 'session-new';
  for (const listener of mountedListeners) listener();
  assert.deepEqual(kindsOf(calls, 'openRightbar'), [['openRightbar', true, false]], 'the official docked open is layout.openRightbar(true, false)');
  assert.deepEqual(kindsOf(calls, 'openTab'), [['openTab', 'superbot']], 'a new session opens the canvas without a dispatch or header click');
  assert.ok(calls.findIndex((entry) => entry[0] === 'openRightbar') < calls.findIndex((entry) => entry[0] === 'openTab'), 'the right column opens before openTab');

  // User switches back to 开始 or closes the canvas in this session.
  activeKind = 'guide';
  expanded = true;
  const afterFirst = calls.length;
  for (const listener of mountedListeners) listener();
  for (const listener of listListeners) listener();
  assert.equal(calls.length, afterFirst, 'closing the canvas or switching back to 开始 is not overridden in this session');

  mounted = 'session-later';
  activeKind = 'guide';
  expanded = false;
  for (const listener of mountedListeners) listener();
  assert.deepEqual(kindsOf(calls, 'openTab'), [['openTab', 'superbot'], ['openTab', 'superbot']], 'the next session still defaults to the canvas');
});

test('silent openTab is retried and is not recorded until the canvas is confirmed active', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));

  const calls = [];
  const mountedListeners = new Set();
  const listListeners = new Set();
  let mounted;
  // Host seeds 开始; the rightbar starts hidden; openTab is a silent no-op until armed.
  let activeKind = 'guide';
  let expanded = false;
  let openTabWorks = false;
  const { ctx } = createClientContext({
    layout: {
      openRightbar: (track, fullscreen) => { calls.push(['openRightbar', track, fullscreen]); },
      closeRightbar: () => { calls.push(['closeRightbar']); },
    },
    sidebarRight: {
      mounted: {
        getSnapshot: () => mounted,
        subscribe: (listener) => { mountedListeners.add(listener); return () => mountedListeners.delete(listener); },
      },
      openTab: (kind) => {
        calls.push(['openTab', kind]);
        if (openTabWorks) {
          activeKind = kind;
          expanded = true;
        }
      },
      openResource: () => {},
      active: () => ({ kind: activeKind, id: `tab-${activeKind}` }),
      isExpanded: () => expanded,
    },
    sessions: {
      list: {
        getSnapshot: () => ({ projectionsBySession: {} }),
        subscribe: (listener) => { listListeners.add(listener); return () => listListeners.delete(listener); },
      },
    },
  });
  instance.apply(ctx);

  mounted = 'session-race';
  for (const listener of mountedListeners) listener();
  assert.deepEqual(kindsOf(calls, 'openRightbar')[0], ['openRightbar', true, false]);
  assert.ok(kindsOf(calls, 'openTab').length >= 1, 'openTab is attempted even when the rightbar starts hidden');
  assert.equal(activeKind, 'guide', 'a silent openTab must not be treated as switching off 开始');
  assert.equal(expanded, false);
  const afterSilent = kindsOf(calls, 'openTab').length;

  openTabWorks = true;
  for (const listener of mountedListeners) listener();
  assert.equal(activeKind, 'superbot', 'a later tick retries and confirms the canvas tab is active');
  assert.equal(expanded, true);
  const afterConfirm = kindsOf(calls, 'openTab').length;
  assert.ok(afterConfirm > afterSilent, 'openTab is retried after a silent failure');

  activeKind = 'guide';
  expanded = true;
  for (const listener of mountedListeners) listener();
  for (const listener of listListeners) listener();
  await delay(40);
  assert.equal(kindsOf(calls, 'openTab').length, afterConfirm, 'after a confirmed open, switching back to 开始 is not forced again');

  mounted = 'session-next';
  activeKind = 'guide';
  expanded = false;
  for (const listener of mountedListeners) listener();
  assert.equal(activeKind, 'superbot');
  assert.ok(kindsOf(calls, 'openTab').length > afterConfirm, 'a later session still default-opens the canvas');
});

test('exhausted silent retries stop rather than looping forever', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));

  const calls = [];
  const mountedListeners = new Set();
  let mounted;
  const { ctx } = createClientContext({
    layout: {
      openRightbar: (track, fullscreen) => { calls.push(['openRightbar', track, fullscreen]); },
      closeRightbar: () => {},
    },
    sidebarRight: {
      mounted: {
        getSnapshot: () => mounted,
        subscribe: (listener) => { mountedListeners.add(listener); return () => mountedListeners.delete(listener); },
      },
      openTab: (kind) => { calls.push(['openTab', kind]); },
      openResource: () => {},
      active: () => ({ kind: 'guide', id: 'tab-guide' }),
      isExpanded: () => false,
    },
  });
  instance.apply(ctx);
  mounted = 'session-exhausted';
  for (const listener of mountedListeners) listener();
  await delay(2200);
  const count = kindsOf(calls, 'openTab').length;
  assert.ok(count >= 2 && count <= 8, `retries must be bounded, got ${count}`);
  for (const listener of mountedListeners) listener();
  await delay(80);
  assert.equal(kindsOf(calls, 'openTab').length, count, 'exhausted retries must not start a new loop');
  assert.equal(kindsOf(calls, 'openTab').every((entry) => entry[1] === 'superbot'), true);
});
