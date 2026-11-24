/**
 * Cold-boot regression: a client plugin is applied before the renderer, locale
 * and right-Sidebar services are provided. The registrations must still happen
 * when those services arrive, and must happen exactly once.
 *
 * History: the wait used to live in one `ctx.effect` whose only wake-ups were a
 * polling interval and the host-side `internal/service` event. A cold boot
 * could lose both, leaving a plugin that rendered nothing (no header button, no
 * right-pane tab, no settings page) until the page reloaded.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CLIENT_URL = new URL('../client.js', import.meta.url);

async function loadClientFactory() {
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
  return loaded.factory;
}

function stubReact() {
  class Component {
    constructor(props) { this.props = props; this.state = {}; }
    setState(next) { this.state = { ...this.state, ...next }; }
    render() { return null; }
  }
  return {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Component,
    PureComponent: Component,
    Fragment: 'Fragment',
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useReducer: (reducer, initial) => [typeof initial === 'function' ? initial(initial) : initial, () => {}],
    useContext: () => ({}),
    createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
    memo: (component) => component,
    forwardRef: (render) => render,
  };
}

/** The services a booted client tree provides; absent until `provide()` runs. */
function makeServices(registrations, tabTypes) {
  return {
    slots: {
      inject: (name, callback) => {
        const disposer = callback();
        return () => { if (typeof disposer === 'function') disposer(); };
      },
      register: (definition) => { registrations.push(definition); return () => {}; },
    },
    locale: { getLocale: () => ({ id: 'zh-CN' }), subscribe: () => () => {}, bind: () => (key) => key },
    layout: { openRightbar() {}, closeRightbar() {}, toggleSidebar() {}, selectPanel() {} },
    sidebarRight: {
      mounted: { getSnapshot: () => undefined, subscribe: () => () => {} },
      active: () => ({ kind: 'superbot' }),
      isExpanded: () => true,
      openTab() {},
      openResource() {},
    },
    sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => {}; } },
    sessions: { list: { getSnapshot: () => ({ projectionsBySession: {} }), subscribe: () => () => {} }, refreshProjections: async () => {} },
    uiWorkspace: { openSession() {} },
    theme: { getTheme: () => ({}) },
    timer: { timeout() {}, interval() {} },
  };
}

function makeColdContext(services, registrations) {
  const ctx = {
    effect: (callback) => { const disposer = callback(); return () => { if (typeof disposer === 'function') disposer(); }; },
    on: () => () => {},
    inject: (names, run) => {
      if (names.every((name) => ctx[name] !== undefined)) run(ctx);
      return () => {};
    },
    logger: { info() {}, warn() {}, error() {} },
  };
  for (const name of Object.keys(services)) ctx[name] = undefined;
  // The plugin resolves services through ctx.get (no inject declaration); the
  // mock answers it from the same properties, so assigning them later is live.
  ctx.get = (name) => ctx[name];
  void registrations;
  return ctx;
}

const SLOT_IDS = [
  ['settings.section', 'superbot'],
  ['settings.section.icon', 'superbot'],
  ['conversation.view', 'superbot-workbench'],
  ['conversation.chat.turnTail', 'ds-superbot-cards'],
  ['sidebar.right.pane.tab', 'ds-superbot'],
  ['sidebar.right.pane.tab.title', 'ds-superbot'],
  ['conversation.session.header.utilities', 'superbot-board'],
  ['conversation.session.header.utilities', 'superbot-faces'],
  ['conversation.session.header.actions', 'ds-superbot-decide'],
  ['conversation.input.dock', 'ds-superbot-caption'],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('cold boot: registrations land once the client services appear', async () => {
  const factory = await loadClientFactory();
  const plugin = factory((name) => {
    if (name === 'react') return stubReact();
    throw new Error(`unexpected module request: ${name}`);
  });
  const registrations = [];
  const tabTypes = [];
  const services = makeServices(registrations, tabTypes);
  const ctx = makeColdContext(services, registrations);

  plugin.apply(ctx);
  assert.equal(registrations.length, 0, 'nothing can register before the slot service exists');
  assert.equal(tabTypes.length, 0, 'no tab type before the right-Sidebar service exists');

  Object.assign(ctx, services);
  for (let attempt = 0; attempt < 40 && registrations.length < SLOT_IDS.length; attempt += 1) {
    await sleep(25);
  }

  for (const [name, id] of SLOT_IDS) {
    const found = registrations.filter((entry) => entry.name === name && (entry.id === id || entry.key === id));
    assert.equal(found.length, 1, `${name} #${id} must be registered exactly once`);
  }
  assert.equal(tabTypes.length, 1, 'the right-pane tab type must be registered once');
  assert.equal(tabTypes[0].id, 'ds-superbot');
  assert.equal(tabTypes[0].kind, 'superbot');
  assert.equal(
    registrations.filter((entry) => entry.name === 'conversation.session.header.corner').length,
    0,
    'the singleton header corner must never be registered',
  );

  const before = registrations.length;
  await sleep(400);
  assert.equal(registrations.length, before, 'the late-start guard must not register twice');
  assert.equal(tabTypes.length, 1, 'the late-start guard must not register the tab type twice');
});
