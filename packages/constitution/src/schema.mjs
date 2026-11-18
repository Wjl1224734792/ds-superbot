/**
 * Zero-dependency JSON Schema (draft subset) validator.
 * Supports the features used by packages/constitution/schemas/*.json.
 * Do not add ajv or any other runtime dependency.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './errors.mjs';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../schemas');

const CACHE = new Map();

export function loadSchema(name) {
  const file = name.endsWith('.json') ? name : `${name}.schema.json`;
  if (!CACHE.has(file)) {
    const raw = readFileSync(join(SCHEMA_DIR, file), 'utf8');
    CACHE.set(file, JSON.parse(raw));
  }
  return CACHE.get(file);
}

/**
 * @param {unknown} value
 * @param {object} schema
 * @param {string} [path]
 * @returns {{ ok: true, value: unknown } | { ok: false, errors: string[] }}
 */
export function validate(value, schema, path = '$') {
  const errors = [];
  check(value, schema, path, errors);
  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

export function assertValid(value, schema, label = 'document') {
  const result = validate(value, schema);
  if (!result.ok) {
    fail('SCHEMA', `${label} failed schema validation: ${result.errors.join('; ')}`, {
      errors: result.errors,
    });
  }
  return value;
}

export function validateNamed(name, value) {
  return assertValid(value, loadSchema(name), name);
}

function check(value, schema, path, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (Object.hasOwn(schema, 'const') && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: expected one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
    return;
  }

  const types = normalizeTypes(schema.type);
  if (types && !matchesType(value, types)) {
    errors.push(`${path}: expected type ${types.join('|')}, got ${typeName(value)}`);
    return;
  }

  if (value === null || value === undefined) return;

  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) {
      errors.push(`${path}: below minimum ${schema.minimum}`);
    }
    if (schema.maximum != null && value > schema.maximum) {
      errors.push(`${path}: above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => check(item, schema.items, `${path}[${i}]`, errors));
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value) && typesIncludes(types, 'object')) {
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}: missing required property ${key}`);
    }
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(props, key)) {
        check(value[key], props[key], `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected property ${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        check(value[key], schema.additionalProperties, `${path}.${key}`, errors);
      }
    }
  }
}

function normalizeTypes(type) {
  if (type == null) return null;
  return Array.isArray(type) ? type : [type];
}

function typesIncludes(types, name) {
  return !types || types.includes(name);
}

function matchesType(value, types) {
  return types.some((t) => {
    if (t === 'null') return value === null;
    if (t === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    if (t === 'array') return Array.isArray(value);
    if (t === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (t === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (t === 'string') return typeof value === 'string';
    if (t === 'boolean') return typeof value === 'boolean';
    return false;
  });
}

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
