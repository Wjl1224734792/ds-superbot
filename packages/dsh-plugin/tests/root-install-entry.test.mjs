import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDir = dirname(fileURLToPath(import.meta.url));
const pluginDir = dirname(testDir);
const repoRoot = dirname(dirname(pluginDir));

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function collectPackageJsonFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectPackageJsonFiles(full, acc);
    } else if (name === 'package.json') {
      acc.push(full);
    }
  }
  return acc;
}

test('root package.json is the ds-superbot install_bundle entry', () => {
  const root = readJson(join(repoRoot, 'package.json'));
  assert.equal(root.name, 'ds-superbot');
  assert.equal(root.version, '0.2.5');
  assert.ok(root.dsh && root.dsh.bundle && root.dsh.bundle.patch, 'root must declare dsh.bundle.patch');
  const patchPath = join(repoRoot, root.dsh.bundle.patch);
  assert.ok(existsSync(patchPath), `bundle patch must exist: ${root.dsh.bundle.patch}`);
  assert.ok(root.dsh.client && Array.isArray(root.dsh.client.inject), 'root must declare dsh.client.inject');
  assert.ok(root.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));
  assert.equal(root.exports['.'], './packages/dsh-plugin/index.js');
  assert.equal(root.exports['./client'], './packages/dsh-plugin/client.js');
  assert.equal(root.exports['./locale/*.json'], './packages/dsh-plugin/locale/*.json');
  assert.equal(root.exports['./icon'], './packages/dsh-plugin/icon.svg');
  assert.ok(existsSync(join(repoRoot, 'packages/dsh-plugin/index.js')));
  assert.ok(existsSync(join(repoRoot, 'packages/dsh-plugin/client.js')));
  assert.ok(existsSync(join(repoRoot, 'packages/dsh-plugin/icon.svg')));
  assert.ok(Array.isArray(root.files) && root.files.includes('README.md') && root.files.includes('README.en.md'));
});

test('workspace has exactly one package named ds-superbot', () => {
  const named = collectPackageJsonFiles(repoRoot)
    .map((file) => ({ file, pkg: readJson(file) }))
    .filter((entry) => entry.pkg.name === 'ds-superbot');
  assert.deepEqual(
    named.map((entry) => relative(repoRoot, entry.file).replaceAll('\\', '/')),
    ['package.json'],
  );
  const plugin = readJson(join(pluginDir, 'package.json'));
  assert.equal(plugin.name, '@ds-superbot/plugin');
  assert.equal(plugin.private, true);
  assert.equal(plugin.dsh, undefined, 'inner package must not declare a second dsh bundle');
});

test('locale meta.detail resolves to repository-root README files', () => {
  const zh = readJson(join(pluginDir, 'locale/zh.json'));
  const en = readJson(join(pluginDir, 'locale/en.json'));
  assert.equal(zh.meta.detail, 'README.md');
  assert.equal(en.meta.detail, 'README.en.md');
  assert.ok(existsSync(join(repoRoot, zh.meta.detail)), 'zh detail must resolve at package root (repo root)');
  assert.ok(existsSync(join(repoRoot, en.meta.detail)), 'en detail must resolve at package root (repo root)');
  assert.equal(zh.meta.title, 'ds-superbot');
  assert.equal(en.meta.title, 'ds-superbot');
  assert.equal(/[「」『』]/.test(zh.meta.title), false);
  assert.equal(/[「」『』]/.test(en.meta.title), false);
});

test('consoleLabel has no corner quotes', () => {
  const client = readFileSync(join(pluginDir, 'client.js'), 'utf8');
  const labels = [...client.matchAll(/consoleLabel:\s*'([^']*)'/g)].map((m) => m[1]);
  assert.ok(labels.length >= 2, 'expected zh and en consoleLabel entries');
  for (const label of labels) {
    assert.equal(label, 'ds-superbot');
    assert.equal(/[「」『』]/.test(label), false);
  }
  const fallbacks = [...client.matchAll(/text(?:Of\(\))?\.consoleLabel\s*\|\|\s*'([^']*)'/g)].map((m) => m[1]);
  assert.ok(fallbacks.length >= 1, 'expected consoleLabel fallbacks');
  for (const label of fallbacks) {
    assert.equal(label, 'ds-superbot');
    assert.equal(/[「」『』]/.test(label), false);
  }
  assert.equal(client.includes('「ds-superbot」'), false);
  assert.equal(client.includes('『ds-superbot』'), false);
});
