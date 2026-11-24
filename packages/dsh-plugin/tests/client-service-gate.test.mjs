/**
 * Cordis service gate: a direct `ctx.<service>` read is only allowed for names the
 * fiber declared in `inject`; `ctx.get(name)` reads without that declaration.
 *
 * This client half declares no inject list on purpose — one unavailable name would
 * park the whole plugin — so every service must be resolved through `ctx.get`.
 * These tests model the gate with throwing property getters, and cover the two
 * failures that gate produced in the wild: a blank settings page (`configForms`
 * unreadable) and a header button that did nothing (`layout` unreadable).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CLIENT_URL = new URL('../client.js', import.meta.url);

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

/**
 * A tiny renderer with persistent hook cells, enough for the settings tree.
 *
 * Hook owner = the component's position path, so cells survive a second pass; the
 * settings section adopts its host value in an effect, and a hookless stub would
 * never reach the table (it would show the "load failed / retry" branch).
 */
function createRenderer() {
  const cells = new Map();
  const cursors = [];
  const cellKey = (owner, index) => owner + '#' + index;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Component: class {
      constructor(props) { this.props = props; this.state = {}; }
      setState(next) { this.state = { ...this.state, ...next }; }
      render() { return null; }
    },
    Fragment: 'Fragment',
    useState: (init) => {
      const cursor = cursors[cursors.length - 1] || { owner: 'root', index: 0 };
      const key = cellKey(cursor.owner, cursor.index);
      cursor.index += 1;
      if (!cells.has(key)) cells.set(key, typeof init === 'function' ? init() : init);
      return [cells.get(key), (next) => { cells.set(key, typeof next === 'function' ? next(cells.get(key)) : next); }];
    },
    useEffect: (effect) => { effect(); },
    useLayoutEffect: (effect) => { effect(); },
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useReducer: (reducer, initial) => {
      const [value, setValue] = React.useState(initial);
      return [value, setValue];
    },
    useContext: () => ({}),
    createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
    memo: (component) => component,
    forwardRef: (render) => render,
  };

  const walk = (element, ownerPath, depth, visit) => {
    if (element === null || element === undefined || depth > 30) return;
    if (typeof element === 'string' || typeof element === 'number') {
      visit(String(element));
      return;
    }
    if (Array.isArray(element)) {
      element.forEach((child, index) => walk(child, ownerPath + '.' + index, depth + 1, visit));
      return;
    }
    if (typeof element !== 'object') return;
    if (element.type === 'style' || element.type === 'svg' || element.type === 'path') return;
    const children = element.children || [];
    if (typeof element.type === 'function') {
      const owner = ownerPath + '/' + (element.type.name || 'fn');
      cursors.push({ owner, index: 0 });
      const props = { ...element.props, ...(children.length ? { children } : {}) };
      let rendered;
      try {
        rendered = element.type.prototype instanceof React.Component
          ? new element.type(props).render()
          : element.type(props);
      } finally {
        cursors.pop();
      }
      walk(rendered, owner, depth + 1, visit);
      return;
    }
    children.forEach((child, index) => walk(child, ownerPath + '.' + index, depth + 1, visit));
  };

  return {
    React,
    /** Render twice so effect-driven state adoption is visible, then return the text. */
    text(element) {
      let out = '';
      for (let pass = 0; pass < 2; pass += 1) {
        const parts = [];
        walk(element, 'root', 0, (part) => parts.push(part));
        out = parts.join(' ');
      }
      return out;
    },
    /** First element matching `predicate`, expanded through function components. */
    find(element, predicate) {
      let found;
      for (let pass = 0; pass < 2 && found === undefined; pass += 1) {
        found = findIn(element, predicate, 'root', 0);
      }
      return found;
    },
  };

  function findIn(element, predicate, ownerPath, depth) {
    if (element === null || element === undefined || depth > 30) return undefined;
    if (Array.isArray(element)) {
      for (let index = 0; index < element.length; index += 1) {
        const found = findIn(element[index], predicate, ownerPath + '.' + index, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (typeof element !== 'object' || element === null) return undefined;
    const children = element.children || [];
    if (typeof element.type === 'function') {
      const owner = ownerPath + '/' + (element.type.name || 'fn');
      cursors.push({ owner, index: 0 });
      const props = { ...element.props, ...(children.length ? { children } : {}) };
      let rendered;
      try {
        rendered = element.type.prototype instanceof React.Component
          ? new element.type(props).render()
          : element.type(props);
      } finally {
        cursors.pop();
      }
      return findIn(rendered, predicate, owner, depth + 1);
    }
    if (predicate(element)) return element;
    for (let index = 0; index < children.length; index += 1) {
      const found = findIn(children[index], predicate, ownerPath + '.' + index, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
}

/** Services a booted page provides; pass `{ omit: ['configForms'] }` to model a gap. */
function makeServices(options = {}) {
  const omit = new Set(options.omit || []);
  const calls = [];
  const registrations = [];
  const tabTypes = [];
  const services = {
    slots: {
      inject: (name, callback) => {
        const disposer = callback();
        return () => { if (typeof disposer === 'function') disposer(); };
      },
      register: (spec, component) => {
        registrations.push({ spec, component });
        return () => {};
      },
    },
    locale: { getLocale: () => ({ id: 'zh-CN' }), subscribe: () => () => {} },
    configForms: {
      get: () => ({
        getSnapshot: () => ({
          status: 'ready',
          revision: 3,
          writable: true,
          value: {
            defaults: { provider: '', model: '', effort: '' },
            roles: { pm: { provider: 'ctaigw', model: 'deepseek-v4.1-flash-1017', effort: 'max' } },
            capabilities: {},
          },
        }),
        subscribe: () => () => {},
        mutate: async () => true,
      }),
    },
    remote: {
      session: {
        modelCatalog: async () => ({
          ok: true,
          value: {
            groups: [{ id: 'ctaigw', name: '天翼云', models: [{ id: 'deepseek-v4.1-flash-1017', name: 'Flash', reasoningEfforts: [] }] }],
            failures: [],
          },
        }),
      },
      commands: { execute: async () => ({ ok: true }) },
      workspaceFiles: { read: async () => ({ ok: false }) },
    },
    layout: {
      openRightbar: (track, fullscreen) => { calls.push(['openRightbar', track, fullscreen]); },
      closeRightbar: () => {},
    },
    sidebarRight: {
      mounted: { getSnapshot: () => undefined, subscribe: () => () => {} },
      openTab: (kind) => { calls.push(['openTab', kind]); },
      openResource: () => {},
      active: () => undefined,
      isExpanded: () => false,
    },
    sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => {}; } },
    sessions: {
      list: { getSnapshot: () => ({ projectionsBySession: {} }), subscribe: () => () => {} },
      refreshProjections: async () => {},
    },
    uiWorkspace: { openSession: () => {} },
    uiConversation: { binding: () => undefined },
  };
  for (const name of omit) delete services[name];
  return { services, calls, registrations, tabTypes };
}

/**
 * A context that behaves like Cordis: direct property reads of any service throw
 * ("cannot get property … without inject"), `ctx.get(name)` answers.
 */
function gatedContext(services) {
  const ctx = {
    effect: (callback) => {
      const disposer = callback();
      return () => { if (typeof disposer === 'function') disposer(); };
    },
    on: () => () => {},
    get: (name) => services[name],
  };
  for (const name of Object.keys(services)) {
    Object.defineProperty(ctx, name, {
      configurable: true,
      get() { throw new Error(`cannot get property "${name}" without inject`); },
    });
  }
  return ctx;
}

const REQUIRED_SLOTS = [
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

test('every service is resolved through ctx.get, so no inject declaration is needed', async () => {
  const factory = await loadClientFactory();
  const renderer = createRenderer();
  const plugin = factory((name) => {
    if (name === 'react') return renderer.React;
    throw new Error(`unexpected module request: ${name}`);
  });
  const { services, registrations, tabTypes } = makeServices();
  const ctx = gatedContext(services);
  assert.throws(() => ctx.slots, /without inject/, 'the mock must model the Cordis gate');

  plugin.apply(ctx);

  for (const name of REQUIRED_SLOTS) {
    assert.ok(
      registrations.some((entry) => entry.spec.name === name),
      `${name} must be registered even though every direct service read throws`,
    );
  }
  assert.equal(
    registrations.filter((entry) => entry.spec.name === 'conversation.session.header.utilities').length,
    2,
    'the header button and the mini faces both live in the utilities list',
  );
  assert.equal(tabTypes.length, 1, 'the right-pane tab type is registered');
  assert.equal(tabTypes[0].id, 'ds-superbot');
  assert.equal(tabTypes[0].kind, 'superbot');
});

test('the settings section renders its configuration instead of a blank page', async () => {
  const factory = await loadClientFactory();
  const renderer = createRenderer();
  const plugin = factory((name) => {
    if (name === 'react') return renderer.React;
    throw new Error(`unexpected module request: ${name}`);
  });
  const { services, registrations } = makeServices();
  plugin.apply(gatedContext(services));

  const entry = registrations.find((item) => item.spec.name === 'settings.section');
  assert.ok(entry, 'the settings section is registered');
  const text = renderer.text(entry.component({}));
  assert.match(text, /子代理模型与思考强度/, 'the section title renders');
  assert.match(text, /默认（兜底）/, 'the defaults row renders');
  assert.match(text, /角色/, 'the role table renders');
});

test('a page without configForms shows a readable notice instead of throwing', async () => {
  const factory = await loadClientFactory();
  const renderer = createRenderer();
  const plugin = factory((name) => {
    if (name === 'react') return renderer.React;
    throw new Error(`unexpected module request: ${name}`);
  });
  const { services, registrations } = makeServices({ omit: ['configForms'] });
  plugin.apply(gatedContext(services));

  const entry = registrations.find((item) => item.spec.name === 'settings.section');
  assert.ok(entry, 'the settings section is still registered so the nav entry exists');
  let text = '';
  assert.doesNotThrow(() => { text = renderer.text(entry.component({})); });
  assert.match(text, /设置命名空间/, 'the notice explains the missing settings namespace');
});

test('the header button opens the canvas when layout and sidebarRight are readable', async () => {
  const factory = await loadClientFactory();
  const renderer = createRenderer();
  const plugin = factory((name) => {
    if (name === 'react') return renderer.React;
    throw new Error(`unexpected module request: ${name}`);
  });
  const { services, calls, registrations } = makeServices();
  plugin.apply(gatedContext(services));

  const entry = registrations.find(
    (item) => item.spec.name === 'conversation.session.header.utilities' && item.spec.id === 'superbot-board',
  );
  assert.ok(entry, 'the header button is registered');
  const face = typeof entry.spec.inject === 'function' ? entry.spec.inject() : {};
  const button = renderer.find(entry.component({ ...face }), (node) => node.type === 'button');
  assert.ok(button, 'the header entry renders a button');
  button.props.onClick();
  assert.deepEqual(
    calls,
    [['openRightbar', true, false], ['openTab', 'superbot']],
    'clicking opens the docked right column and then the canvas tab',
  );
});

test('a page without the layout service records why the button cannot reserve the column', async () => {
  const factory = await loadClientFactory();
  const renderer = createRenderer();
  const plugin = factory((name) => {
    if (name === 'react') return renderer.React;
    throw new Error(`unexpected module request: ${name}`);
  });
  const { services, calls, registrations } = makeServices({ omit: ['layout'] });
  const storageEntries = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storageEntries.has(key) ? storageEntries.get(key) : null),
    setItem: (key, value) => { storageEntries.set(key, String(value)); },
    removeItem: (key) => { storageEntries.delete(key); },
  };
  try {
    plugin.apply(gatedContext(services));
    const entry = registrations.find(
      (item) => item.spec.name === 'conversation.session.header.utilities' && item.spec.id === 'superbot-board',
    );
    const face = typeof entry.spec.inject === 'function' ? entry.spec.inject() : {};
    const button = renderer.find(entry.component({ ...face }), (node) => node.type === 'button');
    button.props.onClick();
    // layout is missing: the tab still opens, and the breadcrumb says why the
    // docked column could not be reserved.
    assert.deepEqual(calls, [['openTab', 'superbot']]);
    const diag = JSON.parse(storageEntries.get('ds-superbot:diag:v2'));
    assert.ok(
      diag.failed.some((item) => item.slot === 'openRightbarDocked' && /layout/.test(item.message)),
      'the breadcrumb names the missing layout service',
    );
  } finally {
    delete globalThis.localStorage;
  }
});
