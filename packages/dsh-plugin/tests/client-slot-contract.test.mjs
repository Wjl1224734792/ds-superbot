/**
 * Client slot contract: every seat this plugin takes is additive, one rejected
 * seat can never take the rest of the plugin down, and the page-local
 * breadcrumb records what happened.
 *
 * History: `conversation.session.header.corner` is a `single` seat the shell
 * already occupies. Registering into it throws ("single slot … already has a
 * registration at priority 0 (registered by WC) …"), and before this contract
 * that throw escaped apply() and rolled back every registration — the whole UI
 * disappeared with nothing on screen to explain it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CLIENT_URL = new URL('../client.js', import.meta.url);
const DIAG_KEY = 'ds-superbot:diag:v2';

/** Seats this client half may take; anything else would replace shipped UI. */
const ADDITIVE_SLOTS = [
  'settings.section',
  'settings.section.icon',
  'conversation.view',
  'conversation.chat.turnTail',
  'sidebar.right.pane.tab',
  'sidebar.right.pane.tab.title',
  'conversation.session.header.utilities',
  'conversation.session.header.actions',
  'conversation.input.dock',
];

/** Every entry the plugin registers when nothing is rejected. */
const EXPECTED = [
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

const SINGLETON_SLOTS = [
  'conversation.session.header.corner',
  'sidebar',
  'rightbar',
  'conversation.session.header',
  'conversation.header',
];

let clientFactory = null;

async function loadClientFactory() {
  if (clientFactory !== null) return clientFactory;
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
  clientFactory = loaded.factory;
  return clientFactory;
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

/** Storage stub standing in for the page's localStorage. */
function installStorage() {
  const entries = new Map();
  globalThis.localStorage = {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => { entries.set(key, String(value)); },
    removeItem: (key) => { entries.delete(key); },
    clear: () => { entries.clear(); },
    key: (index) => [...entries.keys()][index] ?? null,
    get length() { return entries.size; },
  };
  return {
    read: () => (entries.has(DIAG_KEY) ? JSON.parse(entries.get(DIAG_KEY)) : undefined),
    clear: () => { entries.clear(); },
    uninstall: () => { delete globalThis.localStorage; },
  };
}

/**
 * A booted client context: every service present, `slots.register` rejecting the
 * seats named by `reject` the way DSH rejects a second entry in a single seat.
 */
function createClientContext({ reject } = {}) {
  const registrations = [];
  const tabTypes = [];
  const ctx = {
    slots: {
      inject: (name, callback) => {
        const disposer = callback();
        return () => { if (typeof disposer === 'function') disposer(); };
      },
      register: (spec, component) => {
        if (typeof reject === 'function' && reject(spec)) {
          throw new Error(
            `single slot "${spec.name}" already has a registration at priority 0 `
            + '(registered by WC) — register at a different priority to shadow it (lowest renders)',
          );
        }
        registrations.push({ spec, component });
        return () => {};
      },
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
    sessions: {
      list: { getSnapshot: () => ({ projectionsBySession: {} }), subscribe: () => () => {} },
      refreshProjections: async () => {},
    },
    uiWorkspace: { openSession() {} },
    theme: { getTheme: () => ({}) },
    timer: { timeout() {}, interval() {} },
    effect: (callback) => {
      const disposer = callback();
      return () => { if (typeof disposer === 'function') disposer(); };
    },
    inject: (names, run) => {
      if (names.every((name) => ctx[name] !== undefined)) run(ctx);
      return () => {};
    },
    logger: { info() {}, warn() {}, error() {} },
  };
  // The plugin resolves services through ctx.get (no inject declaration).
  ctx.get = (name) => ctx[name];
  return { ctx, registrations, tabTypes };
}

test('every registration targets an additive seat and the singleton corner is never taken', async () => {
  const factory = await loadClientFactory();
  const instance = factory((name) => {
    if (name === 'react') return stubReact();
    throw new Error(`unexpected module request: ${name}`);
  });
  const storage = installStorage();
  const { ctx, registrations } = createClientContext();
  try {
    instance.apply(ctx);
  } finally {
    storage.uninstall();
  }

  const names = registrations.map((entry) => entry.spec.name);
  for (const name of names) {
    assert.ok(ADDITIVE_SLOTS.includes(name), `registered a non-additive seat: ${name}`);
  }
  for (const [name, id] of EXPECTED) {
    const found = registrations.filter((entry) => entry.spec.name === name && (entry.spec.id === id || entry.spec.key === id));
    assert.equal(found.length, 1, `${name} #${id} must be registered exactly once`);
  }
  for (const singleton of SINGLETON_SLOTS) {
    assert.equal(
      registrations.filter((entry) => entry.spec.name === singleton).length,
      0,
      `the singleton seat ${singleton} must never be registered`,
    );
  }
});

test('one rejected seat costs one entry instead of the whole plugin', async () => {
  const factory = await loadClientFactory();
  const instance = factory((name) => {
    if (name === 'react') return stubReact();
    throw new Error(`unexpected module request: ${name}`);
  });
  const storage = installStorage();
  // DSH rejects a second occupant of a single seat; smash one of our own
  // additive seats to prove the rest still registers.
  const { ctx, registrations, tabTypes } = createClientContext({
    reject: (spec) => spec.name === 'conversation.session.header.utilities' && spec.id === 'superbot-faces',
  });
  try {
    instance.apply(ctx);
    const diag = storage.read();
    assert.ok(diag, 'the page-local breadcrumb must be written');
    assert.equal(diag.v, 2);
    assert.equal(diag.stage, 'applied', 'the surviving registrations still complete the apply');
    assert.equal(diag.failed.length, 1, 'exactly the rejected seat is recorded');
    assert.equal(diag.failed[0].slot, 'conversation.session.header.utilities');
    assert.match(diag.failed[0].message, /single slot/);
    assert.ok(diag.registered.includes('conversation.session.header.utilities#superbot-board'));
  } finally {
    storage.uninstall();
  }

  const expectedSurvivors = EXPECTED.filter(([name, id]) => !(name === 'conversation.session.header.utilities' && id === 'superbot-faces'));
  assert.equal(registrations.length, expectedSurvivors.length, 'every other entry still registers');
  for (const [name, id] of expectedSurvivors) {
    const found = registrations.filter((entry) => entry.spec.name === name && (entry.spec.id === id || entry.spec.key === id));
    assert.equal(found.length, 1, `${name} #${id} survived the rejected seat`);
  }
  assert.equal(tabTypes.length, 1, 'the right-pane tab type is unaffected');
});

test('a clean apply leaves an applied breadcrumb with no failures', async () => {
  const factory = await loadClientFactory();
  const instance = factory((name) => {
    if (name === 'react') return stubReact();
    throw new Error(`unexpected module request: ${name}`);
  });
  const storage = installStorage();
  try {
    instance.apply(createClientContext().ctx);
    const diag = storage.read();
    assert.ok(diag, 'the page-local breadcrumb must be written');
    assert.equal(diag.v, 2);
    assert.equal(diag.stage, 'applied');
    assert.deepEqual(diag.failed, []);
    assert.equal(diag.registered.length, EXPECTED.length, 'every entry is named in the breadcrumb');
    assert.ok(diag.registered.includes('conversation.session.header.utilities#superbot-faces'));
  } finally {
    storage.uninstall();
  }
});
