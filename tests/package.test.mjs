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

test('base CSS indents BREW and BREM lists so markers stay inside the editor under a CSS reset', () => {
  const css = readFileSync(root('src/bre.base.css'), 'utf8');
  const header = readFileSync(root('src/bre.theme.css'), 'utf8');
  const rule = css.match(/([^{}]*\bul\b[^{}]*)\{([^}]*)\}/g) || [];
  const hit = rule.find((r) => r.includes('.bre-brew-surface ul') && r.includes('.bre-brew-surface ol') &&
    r.includes('.bre-brem-preview ul') && r.includes('.bre-brem-preview ol'));
  assert.ok(hit, 'one rule covers ul and ol in the BREW surface and the BREM preview');
  assert.match(hit, /padding-inline-start:\s*var\(--bre-list-indent,\s*2em\)/);
  assert.match(header, /--bre-list-indent\s/, 'the variable is documented in the theme header');
});

test('base CSS: BRE numbered items draw their own counter, so the default list marker is switched off', () => {
  const css = readFileSync(root('src/bre.base.css'), 'utf8');
  const rule = (css.match(/\.bre-numbered-list\s*\{[^}]*\}/g) || []).join('\n');
  assert.match(rule, /list-style(-type)?:\s*none/, 'a bare <li> would otherwise show a bullet next to "1."');
  assert.match(css, /\.bre-numbered-list::before\s*\{[^}]*counter\(bre-numbered\)/, 'the counter marker stays');
});

test('base CSS: BRE lists use the same hanging-marker layout as BREW/BREM lists', () => {
  const css = readFileSync(root('src/bre.base.css'), 'utf8');
  const block = (sel) => (css.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(,[^{]*)?\\{[^}]*\\}', 'g')) || []).join('\n');
  const both = css.match(/\.bre-bulleted-list,\s*\.bre-numbered-list\s*\{[^}]*\}/);
  assert.ok(both, 'one rule indents both list item types');
  assert.match(both[0], /margin-inline-start:\s*var\(--bre-list-indent,\s*2em\)/, 'same indent variable as BREW/BREM');
  assert.match(both[0], /position:\s*relative/);
  assert.doesNotMatch(css, /list-style-position:\s*inside/, 'markers hang outside like native lists');
  const before = css.match(/\.bre-numbered-list::before\s*\{[^}]*\}/);
  assert.ok(before, 'numbered items draw their marker with ::before');
  assert.match(before[0], /counter\(bre-numbered\)\s*'\. '/, 'same "1. " text as a native marker');
  assert.match(before[0], /position:\s*absolute/);
  assert.match(before[0], /inset-inline-end:\s*100%/, 'hangs to the left of the text');
  assert.match(before[0], /white-space:\s*pre/, 'keeps the gap after the dot');
});
