#!/usr/bin/env node
/**
 * If @deepseek-ai/schemastery cannot be resolved (no DSH profile, offline box),
 * drop a tiny local stub under packages/dsh-plugin/node_modules so host-contract
 * tests can load index.js. The stub is gitignored with node_modules and is not
 * a runtime dependency of the plugin.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginDir = join(dirname(fileURLToPath(import.meta.url)), '../packages/dsh-plugin');
const dest = join(pluginDir, 'node_modules/@deepseek-ai/schemastery');
const requireFrom = createRequire(pathToFileURL(join(pluginDir, 'package.json')));

try {
  const loaded = requireFrom('@deepseek-ai/schemastery');
  if (typeof loaded.object === 'function') {
    const schema = loaded.object({}).description('probe');
    if (typeof schema === 'function') process.exit(0);
  }
} catch {
  // install stub
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
writeFileSync(join(dest, 'package.json'), `${JSON.stringify({
  name: '@deepseek-ai/schemastery',
  version: '3.18.4-test-stub',
  main: 'index.js',
  description: 'Offline test stub. Not a shipping dependency.',
}, null, 2)}\n`);
writeFileSync(join(dest, 'index.js'), `function live(value) {
  return { get: () => value, value };
}
function instantiate(schema, input) {
  if (!schema) return input;
  if (schema.type === 'object') {
    const src = input && typeof input === 'object' ? input : {};
    const out = {};
    for (const [key, child] of Object.entries(schema.shape || {})) {
      out[key] = instantiate(child, src[key]);
    }
    return out;
  }
  const value = (input === undefined || input === null)
    ? (Object.prototype.hasOwnProperty.call(schema, 'defaultValue') ? schema.defaultValue : input)
    : input;
  if (schema.volatile) return live(value ?? '');
  return value;
}
function chain(state) {
  const schema = function parse(input) { return instantiate(schema, input); };
  Object.assign(schema, state);
  schema.default = (value) => chain({ ...state, defaultValue: value });
  schema.description = (text) => chain({ ...state, description: text });
  schema.volatile = () => chain({ ...state, volatile: true });
  schema.required = () => chain({ ...state, required: true });
  return schema;
}
function string() { return chain({ type: 'string' }); }
function object(shape) { return chain({ type: 'object', shape: shape || {} }); }
function boolean() { return chain({ type: 'boolean' }); }
function number() { return chain({ type: 'number' }); }
function array(inner) { return chain({ type: 'array', items: inner }); }
const z = { string, object, boolean, number, array };
module.exports = z;
module.exports.default = z;
`);
process.stderr.write('ensure-schemastery-stub: wrote a local test stub (gitignored node_modules)\n');
