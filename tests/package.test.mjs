import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = (p) => new URL('../' + p, import.meta.url);
const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8'));

test('package: LICENSE ships and matches package.json (MIT)', () => {
  assert.equal(pkg.license, 'MIT');
  assert.ok(existsSync(root('LICENSE')), 'LICENSE file exists');
  assert.match(readFileSync(root('LICENSE'), 'utf8'), /^MIT License/);
  assert.ok(pkg.files.includes('LICENSE'));
});

test('package: ESM and CJS consumers each get matching type declarations', () => {
  const dot = pkg.exports['.'];
  assert.equal(dot.import.types, './types/index.d.ts');
  assert.equal(dot.require.types, './types/index.d.cts');
  assert.equal(dot.require.default, './dist/bre.umd.cjs');
  assert.ok(pkg.files.includes('types/index.d.cts'));
  assert.ok(existsSync(root('scripts/copy-types.mjs')));
  assert.match(pkg.scripts.build, /copy-types\.mjs/);
});

test('package: published UMD/KaTeX builds do not point at sourcemaps that are not shipped (skips if not built)', () => {
  if (!existsSync(root('dist/bre.umd.js'))) return;
  const excluded = pkg.files.filter((f) => f.startsWith('!')).map((f) => f.slice(1));
  for (const f of ['dist/bre.umd.js', 'dist/bre.katex.umd.js']) {
    assert.ok(excluded.includes(f + '.map'), f + '.map is not published');
    assert.doesNotMatch(readFileSync(root(f), 'utf8'), /sourceMappingURL=/, f + ' has no dangling map comment');
  }
  // the ESM build ships its map, so its comment is fine
  assert.match(readFileSync(root('dist/bre.esm.js'), 'utf8'), /sourceMappingURL=bre\.esm\.js\.map/);
  assert.ok(existsSync(root('dist/bre.esm.js.map')));
});

test('package: CommonJS entry loads in plain Node and exposes the API (skips if not built)', async () => {
  if (!existsSync(root('dist/bre.umd.cjs'))) return;
  const { createRequire } = await import('node:module');
  const m = createRequire(import.meta.url)('../dist/bre.umd.cjs');
  for (const k of ['createEditor', 'registerBlock', 'transforms', 'migrateDocument']) assert.ok(k in m, k);
});
