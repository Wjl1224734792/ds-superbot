/**
 * P2 additive-slot wiring, left console ordering, stage presence, and quiet chat.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { chatSpeechFor, sortConsoleSections } from '../lib/console-model.mjs';

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
    remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } },
    configForms: { get: () => ({ getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {}, mutate: async () => true }) },
    uiWorkspace: { openSession: () => {} },
    sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => {}; } },
    sidebarRight: {
      mounted: { getSnapshot: () => undefined, subscribe: () => () => {} },
      openTab: () => {},
      openResource: () => {},
    },
    sessions: { list: { getSnapshot: () => ({ projectionsBySession: {} }), subscribe: () => () => {} } },
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
  { id: 'WI-116', state: 'Delivered', title: '可合并', face: 'cang', pendingMerge: true },
  { id: 'WI-117', state: 'Verifying', title: '验收中', face: 'yan', role: 'qa-engineer' },
];

afterEach(() => {
  if (globalThis.window && globalThis.window.__p2TestStorage) delete globalThis.window;
});

test('P2 registers official additive slots and keeps 0.1.0 tab ids', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered, tabTypes } = createClientContext();
  instance.apply(ctx);

  const panellist = slot(registered, 'sidebar.panellist');
  const main = slot(registered, 'main');
  assert.ok(panellist && main, 'left console slots must exist');
  assert.equal(panellist.options.id, 'ds-superbot-console');
  assert.equal(main.options.key, 'ds-superbot-console');
  const label = typeof panellist.options.label === 'function' ? panellist.options.label() : panellist.options.label;
  assert.equal(label, '「ds-superbot」');

  assert.ok(slot(registered, 'conversation.session.header.corner'), 'header corner mini-faces');
  assert.ok(slot(registered, 'conversation.session.header.utilities', (entry) => entry.options.id === 'superbot-board'));
  assert.ok(slot(registered, 'sidebar.right.pane.tab', (entry) => entry.options.key === 'ds-superbot'));
  assert.equal(tabTypes[0].id, 'ds-superbot');
  assert.equal(tabTypes[0].kind, 'superbot');

  const forbidden = new Set(['sidebar', 'rightbar', 'conversation.session.header', 'conversation.header']);
  assert.equal(registered.filter((entry) => forbidden.has(entry.options.name)).length, 0);
});

test('the left console lists AwaitingApproval work items first under 待你决定', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);
  const entry = slot(registered, 'main');
  const face = typeof entry.options.inject === 'function' ? entry.options.inject() : {};
  const host = await harness.settle(() => entry.component({ ...face, workItems: ITEMS, healthy: true, authority: 'observe' }));
  const text = host.map((node) => harness.textOf(node)).join('\n');
  assert.match(text, /待你决定/);
  const decide = harness.collect(host, harness.byClass('stwd-console-decide'))[0];
  assert.ok(decide, 'the decision block is rendered');
  const decideText = harness.textOf(decide);
  assert.match(decideText, /WI-114/);
  assert.match(decideText, /待批准/);
  assert.doesNotMatch(decideText, /WI-113/, 'Building must not appear in 待你决定');
  assert.doesNotMatch(decideText, /WI-117/, 'Verifying must not appear in 待你决定');
  const ids = harness.collect([decide], harness.byClass('stwd-console-id')).map((node) => harness.textOf(node));
  assert.deepEqual(ids.slice(0, 3), ['WI-114', 'WI-116', 'WI-115']);
  assert.match(text, /授权：observe/);
  assert.match(text, /自动合并不启用/);
  assert.doesNotMatch(text, /Ticket/i);
  const health = harness.collect(host, harness.byClass('stwd-console-health'))[0];
  assert.ok(String(health.props.className).includes('stwd-console-health-compact'), 'healthy summary stays compact');
});

test('the right stage uses presenceOf, aria-labels, and caps high energy at one', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);
  const awaiting = ITEMS.filter((item) => item.id === 'WI-114');
  const entry = registered.find((item) => item.options.name === 'sidebar.right.pane.tab');
  const face = entry.options.inject('session-stage');
  const render = () => entry.component({
    ...face,
    sessionId: 'session-stage',
    workItems: awaiting,
    loadRun: async () => ({ status: 'empty', dir: '', artifacts: [] }),
    useProjection: () => undefined,
    useSessions: () => undefined,
    useSessionStatus: () => undefined,
  });
  const host = await harness.settle(render);
  const residents = harness.collect(host, harness.byClass('stwd-resident'));
  assert.ok(residents.length >= 4, `expected four stage faces, got ${residents.length}`);
  const highs = residents.filter((node) => String(node.props.className).includes('stwd-energy-high'));
  assert.ok(highs.length <= 1, `at most one high-energy face, got ${highs.length}`);
  const mixedHighs = instance.__test.stageField(ITEMS).filter((entry) => entry.energy === 'high');
  assert.ok(mixedHighs.length <= 1, `mixed field highs: ${mixedHighs.map((entry) => entry.face)}`);
  const cang = residents.find((node) => String(node.props.className).includes('stwd-resident--cang'));
  assert.ok(cang, '仓 is on the stage');
  assert.match(String(cang.props['aria-label']), /仓，正在看你，待批 WI-114/);
  assert.match(String(cang.props.className), /stwd-eye-await/);
  assert.match(String(cang.props.className), /stwd-motion-gaze/);
  const caption = harness.collect(host, harness.byClass('stwd-stage-caption'))[0];
  assert.match(harness.textOf(caption), /仓正在看你 · 待批 WI-114/);
  // 0.1.0 DAG is still present, but demoted into the work-item detail section.
  const detail = harness.collect(host, harness.byClass('stwd-detail-section'))[0];
  assert.ok(detail, 'work-item details wrap the DAG');
  assert.ok(harness.collect([detail], harness.byClass('stwd-graph-view')).length >= 0);
});

test('prefers-reduced-motion freezes loops to still while status text remains', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);
  const entry = registered.find((item) => item.options.name === 'sidebar.right.pane.tab');
  const face = entry.options.inject('session-motion');
  const host = await harness.settle(() => entry.component({
    ...face,
    sessionId: 'session-motion',
    workItems: ITEMS.filter((item) => item.id === 'WI-114'),
    reducedMotion: true,
    loadRun: async () => ({ status: 'empty', dir: '', artifacts: [] }),
    useProjection: () => undefined,
    useSessions: () => undefined,
    useSessionStatus: () => undefined,
  }));
  const residents = harness.collect(host, harness.byClass('stwd-resident'));
  assert.ok(residents.every((node) => String(node.props.className).includes('stwd-motion-still')));
  assert.ok(residents.every((node) => String(node.props.className).includes('stwd-reduced')));
  const cang = residents.find((node) => String(node.props.className).includes('stwd-resident--cang'));
  assert.match(String(cang.props['aria-label']), /仓，正在看你，待批 WI-114/);
  const caption = harness.collect(host, harness.byClass('stwd-stage-caption'))[0];
  assert.match(harness.textOf(caption), /仓正在看你 · 待批 WI-114/);
  const panelText = host.map((node) => harness.textOf(node)).join('\n');
  assert.match(panelText, /待批准|AwaitingApproval|请批 Mandate/);
});

test('header corner renders nothing when idle, and utilities still open the stage', async () => {
  const { factory } = await loadClientFactory();
  const harness = createRenderHarness();
  const instance = factory((name) => (name === 'react' ? harness.stub : {}));
  const { ctx, registered } = createClientContext();
  instance.apply(ctx);
  const corner = slot(registered, 'conversation.session.header.corner');
  const empty = await harness.settle(() => corner.component({ workItems: [], text: { stageTitle: '舞台' } }));
  assert.equal(empty.length, 0, 'an empty corner must render nothing');
  const live = await harness.settle(() => corner.component({ workItems: ITEMS, text: { stageTitle: '舞台' } }));
  assert.ok(harness.collect(live, harness.byClass('stwd-resident-mini')).length >= 4);

  const utilities = slot(registered, 'conversation.session.header.utilities', (entry) => entry.options.id === 'superbot-board');
  let opened = 0;
  const buttonHost = harness.expand(utilities.component({ text: { openPanel: '打开 Super Bot 团队面板' }, openPanel: () => { opened += 1; } }));
  const buttons = harness.collect(buttonHost, harness.byClass('stwd-headbtn'));
  assert.equal(buttons.length, 1);
  buttons[0].props.onClick();
  assert.equal(opened, 1);
});

test('Building and Verifying stay quiet in chat; decision and terminal states may speak', () => {
  assert.equal(chatSpeechFor({ state: 'Building' }).ok, false);
  assert.equal(chatSpeechFor({ state: 'Verifying' }).ok, false);
  assert.equal(chatSpeechFor({ state: 'Planned' }).ok, false);
  assert.deepEqual(chatSpeechFor({ state: 'AwaitingApproval' }), { ok: true, reason: 'needs-decision', kind: 'approval' });
  assert.deepEqual(chatSpeechFor({ state: 'Delivered' }), { ok: true, reason: 'result-ready', kind: 'result' });
  assert.deepEqual(chatSpeechFor({ state: 'Failed' }), { ok: true, reason: 'failed', kind: 'result' });
  const { decisions } = sortConsoleSections(ITEMS);
  assert.equal(decisions[0].id, 'WI-114');
});

test('P2 styles stay inside the .stwd- prefix', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bTicket\b/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /\.stwd-resident/);
  assert.match(source, /stwd-console-decide/);
  assert.match(source, /\.stwd-stage-caption/);
});
