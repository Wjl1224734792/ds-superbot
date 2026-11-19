/**
 * Root plugin-page icon and architecture images shipped with the install entry.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(pluginDir));

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('root package.json declares a packaged root icon identical to the plugin icon', () => {
  const root = readJson(join(repoRoot, 'package.json'));
  assert.equal(root.icon, './icon.svg');
  assert.ok(Array.isArray(root.files) && root.files.includes('icon.svg'));
  const rootIcon = readFileSync(join(repoRoot, 'icon.svg'));
  const pluginIcon = readFileSync(join(pluginDir, 'icon.svg'));
  assert.equal(
    rootIcon.equals(pluginIcon),
    true,
    'root icon.svg must be byte-identical to packages/dsh-plugin/icon.svg',
  );
  assert.ok(rootIcon.length > 0 && rootIcon.length <= 256 * 1024);
  const svg = rootIcon.toString('utf8');
  assert.match(svg, /<svg\b/);
  assert.match(svg, /viewBox="0 0 64 64"/);
  const eyes = svg.match(/<ellipse\b[^>]*fill="#FFFFFF"/g) || [];
  assert.equal(eyes.length, 2, 'do not change the two upright oval eyes');
  assert.doesNotMatch(svg, /<circle\b/);
  assert.doesNotMatch(svg, /<rect\b/);
  assert.doesNotMatch(svg, /\bstroke=/);
});

test('README architecture sections use packaged images instead of mermaid-only blocks', () => {
  const root = readJson(join(repoRoot, 'package.json'));
  assert.ok(
    Array.isArray(root.files) && root.files.includes('docs/architecture/**'),
    'architecture images must be listed in package files',
  );

  const specs = [
    {
      readme: 'README.md',
      images: [
        'docs/architecture/zh-source-synthesis.png',
        'docs/architecture/zh-layers.png',
        'docs/architecture/zh-workflow.png',
      ],
      sources: [
        'docs/architecture/zh-source-synthesis.mmd',
        'docs/architecture/zh-layers.mmd',
        'docs/architecture/zh-workflow.mmd',
      ],
      workbench: '工作台',
    },
    {
      readme: 'README.en.md',
      images: [
        'docs/architecture/en-source-synthesis.png',
        'docs/architecture/en-layers.png',
        'docs/architecture/en-workflow.png',
      ],
      sources: [
        'docs/architecture/en-source-synthesis.mmd',
        'docs/architecture/en-layers.mmd',
        'docs/architecture/en-workflow.mmd',
      ],
      workbench: 'Workbench',
    },
  ];

  for (const spec of specs) {
    const text = readFileSync(join(repoRoot, spec.readme), 'utf8');
    const section = text
      .split(/^## /m)
      .find((block) => block.startsWith('架构\n') || block.startsWith('Architecture\n'));
    assert.ok(section, `${spec.readme} must have an architecture section`);
    assert.doesNotMatch(
      section,
      /```mermaid/,
      `${spec.readme} architecture section must not keep mermaid fences`,
    );
    for (const img of spec.images) {
      assert.match(
        text,
        new RegExp(`!\\[[^\\]]*\\]\\(${img.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`),
        `${spec.readme} must embed ${img}`,
      );
      const buf = readFileSync(join(repoRoot, img));
      assert.equal(buf.subarray(0, 8).equals(PNG_SIG), true, `${img} must be a PNG`);
      assert.ok(buf.length > 1000, `${img} must not be empty`);
    }
    for (const src of spec.sources) {
      const mmd = readFileSync(join(repoRoot, src), 'utf8');
      assert.match(mmd, new RegExp(spec.workbench), `${src} must name the right pane ${spec.workbench}`);
      assert.doesNotMatch(mmd, /舞台/, `${src} must not call the right pane 舞台`);
    }
  }
});
