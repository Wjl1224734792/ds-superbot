/**
 * Workbench entry, copy, and plugin logo for a new session with no work items.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, '../client.js');
const ICON = join(HERE, '../icon.svg');
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
    uiWorkspace: { openSession: () => {} },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { mounted: { getSnapshot: () => undefined, subscribe: () => () => {} }, openTab: () => {}, openResource: () => {} },
    sessions: { list: { getSnapshot: () => ({ projectionsBySession: {} }), subscribe: () => () => {} } },
    layout: { selectPanel: (id) => id },
    effect: (callback) => { callback(); },
  };
  ctx.inject = (names, run) => run(ctx);
  // Cordis gates a direct ctx.<service> read on the inject declaration; the
  // plugin resolves everything through ctx.get, so the mock must answer it too.
  ctx.get = (name) => ctx[name];
  return { ctx, registered };
}

test('icon.svg is an SVG plugin logo with a 64×64 viewBox', () => {
  const svg = readFileSync(ICON, 'utf8');
  assert.match(svg, /<svg\b/);
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.match(svg, /#4D6BFE|#4C6EF5/i);
  const eyes = svg.match(/<ellipse\b[^>]*fill="#FFFFFF"/g) || [];
  assert.equal(eyes.length, 2, 'two upright oval eyes, no extra highlight bars');
  assert.doesNotMatch(svg, /<rect\b/);
  assert.doesNotMatch(svg, /<circle\b/);
  assert.doesNotMatch(svg, /stwd-sclera/);
  assert.doesNotMatch(svg, /#243A6E|#0E1528|#14C16F/i);
  assert.doesNotMatch(svg, /\bstroke=/);
});

test('client copy uses 工作台 / Workbench for the tab and 画布 / Canvas for the right pane, never Super Bot 团队面板 or 舞台', () => {
  const source = readFileSync(CLIENT, 'utf8');
  assert.match(source, /tabTitle: '工作台'/);
  assert.match(source, /openPanel: '打开工作台'/);
  assert.match(source, /canvasTitle: '画布'/);
  assert.match(source, /openCanvas: '打开画布'/);
  assert.match(source, /tabTitle: 'Workbench'/);
  assert.match(source, /openPanel: 'Open the workbench'/);
  assert.match(source, /canvasTitle: 'Canvas'/);
  assert.match(source, /openCanvas: 'Open the canvas'/);
  assert.doesNotMatch(source, /打开 Super Bot 团队面板/);
  assert.doesNotMatch(source, /Open the Super Bot team panel/);
  assert.doesNotMatch(source, /stageTitle: '舞台'/);
  assert.doesNotMatch(source, /stageTitle: 'Stage'/);
  assert.doesNotMatch(source, /canvasTitle: '舞台'/);
  assert.doesNotMatch(source, /canvasTitle: 'Stage'/);
});

test('a new session can open the workbench from mini faces and the canvas from the header button', async () => {
  const { id, factory } = await loadClientFactory();
  assert.equal(id, 'ds-superbot');
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);
  const corner = registered.find((entry) => entry.options.name === 'conversation.session.header.utilities' && entry.options.id === 'superbot-faces');
  const utilities = registered.find((entry) => entry.options.name === 'conversation.session.header.utilities' && entry.options.id === 'superbot-board');
  assert.ok(corner && utilities);
  const opened = [];
  const text = {
    stageTitle: '仓 / 探 / 作 / 验',
    tabTitle: '工作台',
    openWorkbench: '打开工作台',
    openPanel: '打开工作台',
    canvasTitle: '画布',
    openCanvas: '打开画布',
  };
  const empty = await harness.settle(() => corner.component({
    workItems: [],
    text,
    openView: (view) => { opened.push(['view', view]); },
    openPanel: () => { opened.push(['panel']); },
  }));
  const entry = harness.collect(empty, harness.byClass('stwd-mini-entry'));
  assert.equal(entry.length, 1, 'MiniFaces stays visible without work items');
  assert.equal(entry[0].props['aria-label'], '打开工作台');
  entry[0].props.onClick();
  assert.deepEqual(opened, [['view', 'superbot-workbench']]);
  const buttonHost = harness.expand(utilities.component({
    text,
    openPanel: () => { opened.push(['panel']); },
  }));
  const buttons = harness.collect(buttonHost, harness.byClass('stwd-headbtn'));
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props['aria-label'], '打开画布');
  assert.equal(harness.textOf(harness.collect(buttonHost, harness.byClass('stwd-headbtn-label'))[0]), '画布');
  buttons[0].props.onClick();
  assert.deepEqual(opened, [['view', 'superbot-workbench'], ['panel']]);
});
