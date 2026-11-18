import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY = readFileSync(
  join(HERE, '../../../constitution/templates/policy.default.yaml'),
  'utf8',
);

export function tmpRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'runtime-p1-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'AGENTS.md'), '# AGENTS\n\nruntime fixture.\n');
  writeFileSync(join(root, 'README.md'), '# Fixture\n\nA fixture project used by runtime tests.\n');
  mkdirSync(join(root, 'docs/03-契约'), { recursive: true });
  writeFileSync(join(root, 'docs/03-契约/API接口.md'), '# API\n\nBaseURL /api, 错误码 4001, 权限从凭据解析。\n');
  mkdirSync(join(root, '.superbot/policy'), { recursive: true });
  writeFileSync(join(root, '.superbot/policy/default.yaml'), DEFAULT_POLICY);
  return root;
}
