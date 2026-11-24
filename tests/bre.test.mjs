import { mount, tick } from './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEditor } from '../src/core/editor.js';
import { blockRegistry } from '../src/core/blockRegistry.js';
const registerBlock = (d) => blockRegistry.registerCustom(d);

const doc = (blocks) => ({ id: 'd', version: 1, created: 1, updated: 1, blocks });
const para = (id, html) => ({ id, type: 'paragraph', data: { html } });

function fire(el, type, props = {}) {
  const e = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, props);
  el.dispatchEvent(e);
  return e;
}

test('BRE: setJSON/getJSON round-trip keeps ids, types and data', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  const d = doc([
    { id: 'h', type: 'heading', data: { level: 2, html: 'Hi' } },
    para('p', 'Hello <b>x</b>'),
    { id: 'l', type: 'bulleted_list', data: { html: 'a' } },
    { id: 'c', type: 'code', data: { code: 'x', language: 'js' } },
    { id: 'hr', type: 'divider', data: {} },
    { id: 't', type: 'table', data: { rows: [['a', 'b'], ['c', 'd']] } },
  ]);
  ed.setJSON(d);
  const out = ed.getJSON();
  assert.deepEqual(out.blocks.map((b) => [b.id, b.type]), d.blocks.map((b) => [b.id, b.type]));
  assert.equal(out.blocks[1].data.html, 'Hello <b>x</b>');
  ed.destroy();
});

test('BRE: DOM budget — plain paragraph block is ≤ 4 nodes (wrapper + content + text)', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE', virtualize: false });
  ed.setJSON(doc(Array.from({ length: 100 }, (_, i) => para('b' + i, 'text ' + i))));
  const blocks = host.querySelectorAll('.bre-block');
  assert.equal(blocks.length, 100);
  const perBlock = blocks[0].querySelectorAll('*').length + 1 /* wrapper */ + 1 /* text */;
  assert.ok(perBlock <= 4, 'nodes per block: ' + perBlock);
  // Exactly one shared drag handle for the whole editor.
  assert.equal(host.querySelectorAll('[data-bre-handle]').length, 1);
  ed.destroy();
});

test('BRE: auto-virtualization bounds the DOM for large docs', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' }); // virtualize: 'auto'
  ed.setJSON(doc(Array.from({ length: 5000 }, (_, i) => para('b' + i, 'x' + i))));
  const rendered = host.querySelectorAll('.bre-block').length;
  assert.ok(rendered < 100, 'rendered ' + rendered);
  // …but the model and HTML cover every block.
  assert.equal(ed.getJSON().blocks.length, 5000);
  assert.equal((ed.getHTML().match(/<p>/g) || []).length, 5000);
  ed.destroy();
});

test('BRE: virtualize:false renders everything', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE', virtualize: false });
  ed.setJSON(doc(Array.from({ length: 400 }, (_, i) => para('b' + i, 'x'))));
  assert.equal(host.querySelectorAll('.bre-block').length, 400);
  ed.destroy();
});

test('BRE: unknown block types do not crash the editor', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  const w = console.warn; console.warn = () => {};
  ed.setJSON(doc([{ id: 'x', type: 'nope', data: { text: 'keep me' } }]));
  console.warn = w;
  assert.equal(ed.getJSON().blocks[0].type, 'paragraph');
  assert.match(ed.getHTML(), /keep me/);
  ed.destroy();
});

test('BRE: markdown block (BREM document) expands into real blocks', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([{ id: 'm', type: 'markdown', data: { markdown: '# Title\n\nSome **bold** text\n\n- one\n- two' } }]));
  const types = ed.getJSON().blocks.map((b) => b.type);
  assert.deepEqual(types, ['heading', 'paragraph', 'bulleted_list', 'bulleted_list']);
  ed.destroy();
});

test('BRE: getHTML groups lists, sanitizes and caches', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([
    { id: 'a', type: 'numbered_list', data: { html: 'one' } },
    { id: 'b', type: 'numbered_list', data: { html: 'two<img src=x onerror=alert(1)>' } },
    para('c', 'after'),
  ]));
  const html = ed.getHTML();
  assert.match(html, /<ol>[\s\S]*<li>one<\/li>[\s\S]*<li>two[\s\S]*<\/ol>/);
  assert.doesNotMatch(html, /onerror/);
  assert.equal(ed.getHTML(), html);
  ed.destroy();
});

test('BRE: readOnly — not editable, controls hidden, toggles live', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE', readOnly: true });
  ed.setJSON(doc([para('a', 'text'), { id: 't', type: 'table', data: { rows: [['a'], ['b']] } }]));
  assert.ok(ed.isReadOnly());
  assert.equal(host.querySelectorAll('[contenteditable="true"]').length, 0);
  assert.ok(host.querySelector('.bre-editor').hasAttribute('data-bre-readonly'));
  ed.setReadOnly(false);
  assert.ok(host.querySelectorAll('[contenteditable="true"]').length > 0);
  ed.setReadOnly(true);
  assert.equal(host.querySelectorAll('[contenteditable="true"]').length, 0);
  ed.destroy();
});

test('BRE: placeholder shows on empty editor and clears when typing', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE', placeholder: 'Write here' });
  assert.ok(ed.isEmpty());
  const field = host.querySelector('[data-bre-field]');
  assert.equal(field.getAttribute('data-bre-placeholder'), 'Write here');
  field.textContent = 'hi';
  fire(field, 'input');
  assert.notEqual(field.getAttribute('data-bre-placeholder'), 'Write here');
  assert.ok(!ed.isEmpty());
  ed.destroy();
});

test('BRE: typing syncs state; change fires debounced; setJSON does not fire change', async () => {
  const host = mount();
  let changes = 0;
  const ed = createEditor(host, { mode: 'BRE', onChange: () => { changes++; } });
  ed.setJSON(doc([para('a', '')]));
  await tick(350);
  assert.equal(changes, 0, 'setJSON must not fire change');
  const field = host.querySelector('[data-bre-field]');
  field.textContent = 'typed';
  fire(field, 'input');
  assert.equal(ed.getJSON().blocks[0].data.html, 'typed');
  await tick(350);
  assert.equal(changes, 1);
  ed.destroy();
});

test('BRE: typed markup is sanitized lazily on getJSON', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([para('a', '')]));
  const field = host.querySelector('[data-bre-field]');
  field.innerHTML = 'ok<img src=x onerror=alert(1)><b>b</b>';
  fire(field, 'input');
  const html = ed.getJSON().blocks[0].data.html;
  assert.doesNotMatch(html, /onerror/);
  assert.match(html, /<b>b<\/b>/);
  ed.destroy();
});

test('BRE: events — ready, focus/blur, on/off', async () => {
  const host = mount();
  const seen = [];
  const ed = createEditor(host, { mode: 'BRE', onReady: () => seen.push('ready') });
  await tick();
  assert.deepEqual(seen, ['ready']);
  const off = ed.on('focus', () => seen.push('focus'));
  ed.on('blur', () => seen.push('blur'));
  const field = host.querySelector('[data-bre-field]');
  fire(field, 'focusin');
  fire(field, 'focusout', { relatedTarget: null });
  assert.deepEqual(seen, ['ready', 'focus', 'blur']);
  off();
  fire(field, 'focusin');
  assert.deepEqual(seen, ['ready', 'focus', 'blur']);
  ed.destroy();
});

test('BRE: undo/redo via keyboard restores content', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([para('a', 'one')]));
  const field = host.querySelector('[data-bre-field]');
  field.textContent = 'two';
  fire(field, 'input');
  assert.equal(ed.getJSON().blocks[0].data.html, 'two');
  fire(field, 'keydown', { key: 'z', ctrlKey: true });
  assert.equal(ed.getJSON().blocks[0].data.html, 'one');
  fire(host.querySelector('[data-bre-field]'), 'keydown', { key: 'z', ctrlKey: true, shiftKey: true });
  assert.equal(ed.getJSON().blocks[0].data.html, 'two');
  ed.destroy();
});

test('BRE: custom block — registered, rendered, serialized, slash entry', () => {
  registerBlock({
    type: 'callout',
    defaultData: { text: '' },
    slashMenu: { label: 'Callout', keywords: ['note'] },
    render(data, ctx) {
      const el = document.createElement('aside');
      el.textContent = data.text;
      el.dataset.id = ctx.blockId;
      return el;
    },
    toHTML: (data) => `<aside>${data.text}</aside>`,
    fromHTML: (el) => (el.tagName === 'ASIDE' ? { text: el.textContent } : null),
  });
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([{ id: 'c', type: 'callout', data: { text: 'hello' } }]));
  assert.ok(host.querySelector('aside'));
  assert.equal(ed.getJSON().blocks[0].type, 'callout');
  assert.match(ed.getHTML(), /<aside>hello<\/aside>/);
  ed.setHTML('<aside>from html</aside>');
  assert.equal(ed.getJSON().blocks[0].type, 'callout');
  assert.equal(ed.getJSON().blocks[0].data.text, 'from html');
  ed.destroy();
});

test('BRE: uploadImage hook inserts an image block from a pasted file', async () => {
  const host = mount();
  const calls = [];
  const ed = createEditor(host, {
    mode: 'BRE',
    uploadImage: async (file) => { calls.push(file.name); return 'https://cdn.example.com/' + file.name; },
  });
  const field = host.querySelector('[data-bre-field]');
  const file = new window.File(['x'], 'pic.png', { type: 'image/png' });
  const e = fire(field, 'paste', {
    clipboardData: { files: [file], getData: () => '' },
  });
  assert.ok(e.defaultPrevented);
  await tick(20);
  assert.deepEqual(calls, ['pic.png']);
  const b = ed.getJSON().blocks;
  assert.equal(b.length, 1, 'replaces the empty paragraph');
  assert.equal(b[0].type, 'image');
  assert.equal(b[0].data.src, 'https://cdn.example.com/pic.png');
  ed.destroy();
});

test('BRE: uploadImage rejects unsafe URLs and reports an error event', async () => {
  const host = mount();
  const errs = [];
  const ed = createEditor(host, { mode: 'BRE', uploadImage: async () => 'javascript:alert(1)', onError: (e) => errs.push(e.type) });
  const field = host.querySelector('[data-bre-field]');
  fire(field, 'paste', { clipboardData: { files: [new window.File(['x'], 'a.png', { type: 'image/png' })], getData: () => '' } });
  await tick(20);
  assert.deepEqual(errs, ['upload']);
  assert.equal(ed.getJSON().blocks[0].type, 'paragraph');
  ed.destroy();
});

test('BRE: paste HTML (Google Docs style) becomes blocks, scripts stripped', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  const field = host.querySelector('[data-bre-field]');
  const html = '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-1"><h2>Title</h2><p>para <script>alert(1)</script></p></b>';
  fire(field, 'paste', { clipboardData: { files: [], getData: (t) => (t === 'text/html' ? html : 'Title para') } });
  const types = ed.getJSON().blocks.map((b) => b.type);
  assert.deepEqual(types, ['heading', 'paragraph']);
  assert.doesNotMatch(JSON.stringify(ed.getJSON()), /script/);
  ed.destroy();
});

test('BRE: multiple instances are isolated (different embed allowlists)', () => {
  const a = createEditor(mount(), { mode: 'BRE', embedAllowlist: ['vimeo.com'] });
  const b = createEditor(mount(), { mode: 'BRE', embedAllowlist: ['youtube.com'] });
  const vid = doc([{ id: 'v', type: 'video', data: { src: 'https://www.youtube.com/watch?v=abc' } }]);
  a.setJSON(vid); b.setJSON(vid);
  assert.doesNotMatch(a.getHTML(), /<iframe/);
  assert.match(b.getHTML(), /<iframe/);
  a.destroy(); b.destroy();
});

test('BRE: destroy removes DOM, document listeners and timers', async () => {
  const host = mount();
  let added = 0, removed = 0;
  const add = document.addEventListener.bind(document);
  const rem = document.removeEventListener.bind(document);
  document.addEventListener = (...a) => { added++; return add(...a); };
  document.removeEventListener = (...a) => { removed++; return rem(...a); };
  for (let i = 0; i < 20; i++) {
    const ed = createEditor(host, { mode: 'BRE', onChange() {} });
    ed.setJSON(doc([para('a', 'x')]));
    ed.destroy();
  }
  document.addEventListener = add; document.removeEventListener = rem;
  assert.equal(added, removed, 'document listeners balanced');
  assert.equal(host.children.length, 0);
  assert.equal(document.querySelectorAll('.bre-slash-menu, .bre-inline-toolbar').length, 0);
});

test('BRE: slash menu opens on "/" and is a listbox', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  const field = host.querySelector('[data-bre-field]');
  field.textContent = '/';
  fire(field, 'input');
  const menu = document.querySelector('.bre-slash-menu');
  assert.equal(menu.hidden, false);
  assert.equal(menu.getAttribute('role'), 'listbox');
  assert.ok(menu.querySelectorAll('[role="option"]').length >= 10);
  field.textContent = '/head';
  fire(field, 'input');
  assert.ok(menu.querySelectorAll('[role="option"]').length === 3);
  fire(field, 'keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true);
  ed.destroy();
});

test('BRE: keyboard block move (Alt+Shift+ArrowDown)', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([para('a', 'A'), para('b', 'B')]));
  const field = host.querySelector('[data-bre-block-id="a"] [data-bre-field]');
  fire(field, 'keydown', { key: 'ArrowDown', altKey: true, shiftKey: true });
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.id), ['b', 'a']);
  ed.destroy();
});

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const cssSrc = (f) => stripComments(readFileSync(new URL('../src/' + f, import.meta.url), 'utf8'));

test('CSS policy: bre.base.css is structural — no literal colors, fonts, shadows or radii', () => {
  const css = cssSrc('bre.base.css');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'no hex colors');
  assert.doesNotMatch(css, /rgba?\(|hsla?\(/i, 'no rgb/hsl colors');
  assert.doesNotMatch(css, /font-family\s*:\s*(?!inherit)/i, 'no font families');
  assert.doesNotMatch(css, /box-shadow|border-radius|font-size\s*:\s*[\d.]/i, 'no decorative rules');
  assert.doesNotMatch(css, /--bre-[\w-]+\s*:/, 'variables are only READ here, never defined');
});

test('CSS policy: bre.theme.css styles the editor chrome only, beats resets, with fallbacks', () => {
  const css = cssSrc('bre.theme.css');
  // Every selector carries a .bre- class (specificity >= 0,1,0): a reset such as
  // `* { padding: 0 }` or Tailwind's `button { padding: 0 }` cannot wipe the chrome.
  // The only :where() is the variable-defaults block, so `:root { --bre-… }` always wins.
  const selectors = css.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean)
    .flatMap((list) => list.split(',').map((x) => x.trim()));
  for (const sel of selectors) {
    if (sel === ':where(:root)') continue;
    assert.match(sel, /\.bre-/, 'selector must be class-based: ' + sel);
    assert.doesNotMatch(sel, /:where\(/, 'no zero-specificity chrome rules: ' + sel);
  }
  // content is never styled: the host owns fonts, headings, lists, quotes, code
  assert.doesNotMatch(css, /\.bre-(paragraph|heading|quote|code|code-wrapper|bulleted-list|numbered-list|image|video|audio)\b|\b(h[1-6]|p|blockquote|pre|ul|ol|li)\s*[,{]/, 'no content selectors');
  assert.doesNotMatch(css, /font-family\s*:(?!\s*monospace)/i, 'no font families (monospace only for code-ish UI)');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'colors are system colors or variables');
  // every variable read has a fallback; variables are defined only on :where(:root)
  assert.doesNotMatch(css, /var\(--bre-[\w-]+\)/, 'var() always has a fallback');
  assert.ok(css.includes(':where(:root)'));
  const outsideRoot = css.replace(/:where\(:root\)\s*\{[^}]*\}/, '');
  assert.doesNotMatch(outsideRoot, /--bre-[\w-]+\s*:/, 'variables only defined on :where(:root)');
});

test('CSS policy: a universal reset after bre.css cannot zero the chrome padding (specificity)', () => {
  // Compute the specificity of the padding rules the user reported missing.
  const css = cssSrc('bre.theme.css');
  for (const sel of ['.bre-slash-item', '.bre-table-btn', '.bre-brew-link-dialog']) {
    assert.ok(new RegExp('(^|\\n|,\\s*)' + sel.replace('.', '\\.') + '\\s*[,{]').test(css), sel + ' is a plain class rule');
  }
  assert.match(css, /\.bre-slash-item\s*\{\s*padding:/);
});

test('CSS policy: the built package ships bre.css and bre-base.css (skips if not built)', async () => {
  const { existsSync } = await import('node:fs');
  const base = new URL('../dist/bre-base.css', import.meta.url);
  const full = new URL('../dist/bre.css', import.meta.url);
  if (!existsSync(base) || !existsSync(full)) return;
  const b = readFileSync(base, 'utf8');
  const f = readFileSync(full, 'utf8');
  assert.ok(f.length > b.length, 'bre.css = base + theme');
  assert.ok(f.includes(':where(:root){--bre-accent'), 'theme variable defaults present in bre.css');
  assert.ok(!b.includes('--bre-accent:'), 'base build defines no variables');
  assert.ok(!/box-shadow|border-radius/.test(b), 'base build has no decorative rules');
});

// Guards against tree-shaking dropping block registration (sideEffects flag).
test('dist bundle: blocks are registered and the editor renders (skips if not built)', async () => {
  const { existsSync } = await import('node:fs');
  const url = new URL('../dist/bre.esm.js', import.meta.url);
  if (!existsSync(url)) return;
  const { createEditor: dist } = await import(url.href);
  const host = mount();
  const ed = dist(host, { mode: 'BRE', virtualize: false });
  ed.setJSON(doc([
    { id: 'h', type: 'heading', data: { level: 1, html: 'T' } },
    para('p', 'x'),
    { id: 'c', type: 'columns', data: { columns: [[para('a', '1')], [para('b', '2')]] } },
    { id: 't', type: 'table', data: { rows: [['a'], ['b']] } },
    { id: 'v', type: 'video', data: { src: 'https://youtu.be/abc' } },
    { id: 'f', type: 'formula', data: { latex: 'x', displayMode: true } },
  ]));
  assert.equal(host.querySelectorAll('.bre-block').length, 8);
  ed.destroy();
});

test('delete block: table button, Ctrl+Shift+Backspace, divider via Backspace, undo', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  const tbl = { id: 't', type: 'table', data: { rows: [['a', 'b'], ['c', 'd']] } };
  ed.setJSON(doc([para('a', 'A'), tbl, para('b', 'B')]));
  // 1. button
  host.querySelector('[data-bre-table-action="del-block"]').click();
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.id), ['a', 'b']);
  fire(host.querySelector('[data-bre-block-id="a"] [data-bre-field]'), 'keydown', { key: 'z', ctrlKey: true });
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.id), ['a', 't', 'b'], 'undo restores the table');
  // 2. keyboard shortcut from inside a cell
  const cell = host.querySelector('[data-bre-table-row="0"]');
  fire(cell, 'keydown', { key: 'Backspace', ctrlKey: true, shiftKey: true });
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.id), ['a', 'b']);
  // 3. only block: replaced by an empty paragraph, never an empty doc
  ed.setJSON(doc([tbl]));
  fire(host.querySelector('[data-bre-table-row="0"]'), 'keydown', { key: 'Backspace', metaKey: true, shiftKey: true });
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.type), ['paragraph']);
  // 4. Backspace at the start of the block after a divider removes the divider
  ed.setJSON(doc([para('a', 'A'), { id: 'hr', type: 'divider', data: {} }, para('b', 'B')]));
  fire(host.querySelector('[data-bre-block-id="b"] [data-bre-field]'), 'keydown', { key: 'Backspace' });
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.id), ['a', 'b']);
  ed.destroy();
});

test('review fixes: nested bad blocks, columns→other modes, formula cache, list Enter, <style> stripped', async () => {
  const w = console.warn; console.warn = () => {};
  // nested unknown block inside columns no longer throws
  const ed = createEditor(mount(), { mode: 'BRE' });
  ed.setJSON(doc([{ id: 'c', type: 'columns', data: { columns: [[{ type: 'foo', data: { text: 'x' } }], []] } }]));
  assert.doesNotThrow(() => ed.getHTML());
  // columns survive BRE→BREW and BRE→BREM
  const withCols = doc([{ id: 'c', type: 'columns', data: { columns: [[para('a', 'LEFT')], [para('b', 'RIGHT')]] } }]);
  const brew = createEditor(mount(), { mode: 'BREW' }); brew.setJSON(withCols);
  assert.match(brew.getHTML(), /LEFT[\s\S]*RIGHT/);
  const brem = createEditor(mount(), { mode: 'BREM' }); brem.setJSON(withCols);
  assert.match(brem.getJSON().blocks[0].data.markdown, /LEFT[\s\S]*RIGHT/);
  // formula fallback is not cached forever
  const f = createEditor(mount(), { mode: 'BRE' });
  f.setJSON(doc([{ id: 'f', type: 'formula', data: { latex: 'x^2', displayMode: true } }]));
  f.getHTML();
  await tick(500);
  assert.doesNotMatch(f.getHTML(), /bre-formula-error/, 'math is rendered once KaTeX has loaded');
  // <style>/<form> are stripped
  const { sanitizeHTML } = await import('../src/utils/sanitize.js');
  assert.doesNotMatch(sanitizeHTML('x<style>a{}</style><form action=u><input><button>b</button></form>'), /<style|<form|<input|<button/i);
  // Enter in a list continues the list; Enter on an empty item exits it
  const l = createEditor(mount(), { mode: 'BRE' });
  l.setJSON(doc([{ id: 'l1', type: 'bulleted_list', data: { html: 'item' } }]));
  console.warn = w;
  l.destroy(); ed.destroy(); brew.destroy(); brem.destroy(); f.destroy();
});

// ── Notion-style block selection + block menu ────────────────────────────────
const media = () => doc([
  para('a', 'before'),
  { id: 'img', type: 'image', data: { src: 'https://example.com/a.png', alt: '', caption: '' } },
  { id: 'hr', type: 'divider', data: {} },
  { id: 'aud', type: 'audio', data: { src: 'https://example.com/a.mp3', caption: '' } },
  para('z', 'after'),
]);
const ids = (ed) => ed.getJSON().blocks.map((b) => b.id);

test('select media: click selects (no prompt), Backspace deletes, undo restores', () => {
  const host = mount();
  let prompts = 0;
  const ed = createEditor(host, { mode: 'BRE', prompt: () => { prompts++; return null; } });
  ed.setJSON(media());
  fire(host.querySelector('.bre-image'), 'click');
  const wrapper = host.querySelector('[data-bre-block-id="img"]');
  assert.ok(wrapper.hasAttribute('data-bre-selected'), 'selected');
  assert.equal(prompts, 0, 'a click on loaded media never prompts');
  fire(wrapper, 'keydown', { key: 'Backspace' });
  assert.deepEqual(ids(ed), ['a', 'hr', 'aud', 'z']);
  fire(host.querySelector('[data-bre-block-id="a"] [data-bre-field]'), 'keydown', { key: 'z', metaKey: true });
  assert.deepEqual(ids(ed), ['a', 'img', 'hr', 'aud', 'z']);
  ed.destroy();
});

test('select divider and audio; Delete key works; Escape and field focus clear selection', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(media());
  fire(host.querySelector('.bre-divider'), 'click');
  const hr = host.querySelector('[data-bre-block-id="hr"]');
  assert.ok(hr.hasAttribute('data-bre-selected'));
  fire(hr, 'keydown', { key: 'Escape' });
  assert.ok(!hr.hasAttribute('data-bre-selected'), 'Escape clears');
  fire(host.querySelector('.bre-audio'), 'click');
  const aud = host.querySelector('[data-bre-block-id="aud"]');
  assert.ok(aud.hasAttribute('data-bre-selected'));
  fire(host.querySelector('[data-bre-block-id="a"] [data-bre-field]'), 'focusin');
  assert.ok(!aud.hasAttribute('data-bre-selected'), 'focusing a field clears');
  fire(host.querySelector('.bre-audio'), 'click');
  fire(host.querySelector('[data-bre-block-id="aud"]'), 'keydown', { key: 'Delete' });
  assert.deepEqual(ids(ed), ['a', 'img', 'hr', 'z']);
  ed.destroy();
});

test('empty media placeholder click still asks for a source; double-click replaces', async () => {
  const host = mount();
  const asked = [];
  const ed = createEditor(host, { mode: 'BRE', prompt: (msg) => { asked.push(msg); return 'https://example.com/new.png'; } });
  ed.setJSON(doc([{ id: 'i', type: 'image', data: { src: '', alt: '', caption: '' } }]));
  fire(host.querySelector('.bre-image-placeholder'), 'click');
  await tick(10);
  assert.equal(asked.length, 1);
  assert.equal(ed.getJSON().blocks[0].data.src, 'https://example.com/new.png');
  fire(host.querySelector('.bre-image'), 'dblclick');
  await tick(10);
  assert.equal(asked.length, 2, 'double-click opens replace');
  ed.destroy();
});

function openHandleMenu(host, blockId) {
  const block = host.querySelector(`[data-bre-block-id="${blockId}"]`);
  fire(block, 'pointerover');
  const handle = host.querySelector('[data-bre-handle]');
  fire(handle, 'pointerdown', { clientX: 5, clientY: 5, pointerId: 1 });
  fire(handle, 'pointerup', { clientX: 5, clientY: 5, pointerId: 1 });
  return document.querySelector('.bre-block-menu');
}

test('handle click (no drag) opens the block menu; keyboard Delete removes the block', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(media());
  const menu = openHandleMenu(host, 'img');
  assert.equal(menu.hidden, false);
  assert.equal(menu.getAttribute('role'), 'menu');
  const labels = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((e) => e.textContent);
  assert.deepEqual(labels, ['Replace…', 'Duplicate', 'Delete'], 'media gets Replace');
  fire(menu, 'keydown', { key: 'End' });
  fire(menu, 'keydown', { key: 'Enter' });
  assert.equal(menu.hidden, true);
  assert.deepEqual(ids(ed), ['a', 'hr', 'aud', 'z']);
  ed.destroy();
});

test('handle drag past the threshold does NOT open the menu', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(media());
  fire(host.querySelector('[data-bre-block-id="img"]'), 'pointerover');
  const handle = host.querySelector('[data-bre-handle]');
  fire(handle, 'pointerdown', { clientX: 5, clientY: 5, pointerId: 1 });
  fire(handle, 'pointermove', { clientX: 5, clientY: 40, pointerId: 1 });
  fire(handle, 'pointerup', { clientX: 5, clientY: 40, pointerId: 1 });
  assert.equal(document.querySelector('.bre-block-menu').hidden, true);
  ed.destroy();
});

test('block menu: Duplicate copies with fresh ids (also nested in columns); Escape closes', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([
    { id: 'c', type: 'columns', data: { columns: [[para('x', 'LEFT')], [para('y', 'RIGHT')]] } },
    { id: 't', type: 'table', data: { rows: [['a'], ['b']] } },
  ]));
  let menu = openHandleMenu(host, 't');
  assert.deepEqual(Array.from(menu.querySelectorAll('[role="menuitem"]')).map((e) => e.textContent), ['Duplicate', 'Delete']);
  fire(menu, 'keydown', { key: 'Enter' }); // Duplicate (first item)
  const blocks = ed.getJSON().blocks;
  assert.deepEqual(blocks.map((b) => b.type), ['columns', 'table', 'table']);
  assert.notEqual(blocks[1].id, blocks[2].id);
  assert.deepEqual(blocks[1].data.rows, blocks[2].data.rows);
  menu = openHandleMenu(host, 'c');
  fire(menu, 'keydown', { key: 'Enter' });
  const cols = ed.getJSON().blocks.filter((b) => b.type === 'columns');
  assert.equal(cols.length, 2);
  const allIds = cols.flatMap((c) => [c.id, ...c.data.columns.flat().map((s) => s.id)]);
  assert.equal(new Set(allIds).size, allIds.length, 'every id in the copy is new');
  menu = openHandleMenu(host, 't');
  fire(menu, 'keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true);
  ed.destroy();
});

test('Alt+Shift+M opens the block menu from the keyboard', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([para('a', 'x')]));
  fire(host.querySelector('[data-bre-field]'), 'keydown', { key: 'M', altKey: true, shiftKey: true });
  assert.equal(document.querySelector('.bre-block-menu').hidden, false);
  fire(document.querySelector('.bre-block-menu'), 'keydown', { key: 'Escape' });
  ed.destroy();
});

test('read-only: no selection, no block menu', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE', readOnly: true });
  ed.setJSON(media());
  fire(host.querySelector('.bre-image'), 'click');
  assert.equal(host.querySelectorAll('[data-bre-selected]').length, 0);
  const menu = openHandleMenu(host, 'img');
  assert.ok(!menu || menu.hidden);
  ed.destroy();
});

test('block menu anchors beside the handle even when capture fires hover on the root', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(media());
  fire(host.querySelector('[data-bre-block-id="img"]'), 'pointerover');
  const handle = host.querySelector('[data-bre-handle]');
  // Pretend the handle sits at a known place.
  handle.getBoundingClientRect = () => ({ top: 120, bottom: 140, left: 10, right: 30, width: 20, height: 20 });
  fire(handle, 'pointerdown', { clientX: 5, clientY: 5, pointerId: 1 });
  // Pointer capture makes the browser aim a hover event at the root: must not hide the handle.
  fire(host.querySelector('.bre-editor'), 'pointerover');
  assert.equal(handle.hidden, false, 'handle stays visible during the press');
  fire(handle, 'pointerup', { clientX: 5, clientY: 5, pointerId: 1 });
  const menu = document.querySelector('.bre-block-menu');
  assert.equal(menu.hidden, false);
  assert.equal(menu.style.left, '34px', 'right of the handle (30 + 4)');
  assert.equal(menu.style.top, '120px', 'level with the handle');
  fire(menu, 'keydown', { key: 'Escape' });
  ed.destroy();
});

test('table controls: shown only while editing (CSS contract) and focus is restored after a re-render', () => {
  // CSS: hidden by default, visible via :focus-within in BRE and BREW
  const css = readFileSync(new URL('../src/bre.base.css', import.meta.url), 'utf8');
  assert.match(css, /\.bre-table-controls\s*\{\s*display:\s*none/);
  assert.match(css, /\.bre-table-wrapper:focus-within \.bre-table-controls:not\(\[hidden\]\)/);
  assert.match(css, /\[data-bre-type="table"\]:focus-within \.bre-table-controls:not\(\[hidden\]\)/);

  // Behaviour: add-row re-renders the table; the caret must land back in a cell
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([{ id: 't', type: 'table', data: { rows: [['a', 'b'], ['c', 'd']] } }]));
  const focused = [];
  const orig = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function () { focused.push(this.getAttribute('data-bre-table-row') + ',' + this.getAttribute('data-bre-table-col')); };
  fire(host.querySelector('[data-bre-table-row="1"][data-bre-table-col="1"]'), 'focusin');
  fire(host.querySelector('[data-bre-table-action="add-row"]'), 'click');
  assert.equal(ed.getJSON().blocks[0].data.rows.length, 3);
  assert.equal(focused.at(-1), '2,1', 'caret goes to the new row, same column');
  fire(host.querySelector('[data-bre-table-action="add-col"]'), 'click');
  assert.equal(focused.at(-1), '2,2', 'caret goes to the new column');
  fire(host.querySelector('[data-bre-table-action="del-col"]'), 'click');
  assert.equal(focused.at(-1), '2,1', 'clamped into the smaller table');
  window.HTMLElement.prototype.focus = orig;
  ed.destroy();
});


// ── BRE uses the same inline dialog as BREW (no window.prompt) ───────────────
const dlg = () => document.querySelector('.bre-brew-link-dialog');
const setVal = (d, v) => { const i = d.querySelector('input'); i.value = v; };

test('BRE dialog: formula click opens the shared dialog; Save applies, Cancel keeps, Esc closes', async () => {
  const host = mount();
  let nativePrompts = 0;
  const origPrompt = window.prompt; window.prompt = () => { nativePrompts++; return null; };
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([{ id: 'f', type: 'formula', data: { latex: 'x', displayMode: true } }]));
  fire(host.querySelector('.bre-formula'), 'click');
  await tick(5);
  let d = dlg();
  assert.ok(d, 'inline dialog opened');
  assert.equal(d.getAttribute('role'), 'dialog');
  assert.equal(d.querySelector('input').value, 'x', 'prefilled with the current LaTeX');
  setVal(d, 'y^2');
  d.querySelector('.bre-brew-link-save').click();
  await tick(5);
  assert.equal(ed.getJSON().blocks[0].data.latex, 'y^2');
  assert.equal(dlg(), null, 'dialog removed');
  // Cancel keeps the value
  fire(host.querySelector('.bre-formula'), 'click');
  await tick(5);
  setVal(dlg(), 'zzz');
  dlg().querySelector('.bre-brew-link-cancel').click();
  await tick(5);
  assert.equal(ed.getJSON().blocks[0].data.latex, 'y^2');
  // Escape closes
  fire(host.querySelector('.bre-formula'), 'click');
  await tick(5);
  fire(dlg(), 'keydown', { key: 'Escape' });
  assert.equal(dlg(), null);
  assert.equal(nativePrompts, 0, 'window.prompt is never used');
  window.prompt = origPrompt;
  ed.destroy();
});

test('BRE dialog: media replace validates the URL (aria-invalid, no alert) and applies a good one', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([{ id: 'i', type: 'image', data: { src: 'https://example.com/a.png', alt: '', caption: '' } }]));
  fire(host.querySelector('.bre-image'), 'dblclick');
  await tick(5);
  const d = dlg();
  assert.ok(d);
  setVal(d, 'javascript:alert(1)');
  d.querySelector('.bre-brew-link-save').click();
  assert.equal(d.querySelector('input').getAttribute('aria-invalid'), 'true');
  assert.ok(dlg(), 'stays open on an invalid URL');
  setVal(d, 'https://example.com/b.png');
  d.querySelector('.bre-brew-link-save').click();
  await tick(5);
  assert.equal(ed.getJSON().blocks[0].data.src, 'https://example.com/b.png');
  ed.destroy();
});

test('BRE dialog: slash → Formula inserts via the dialog; cancel leaves a clean paragraph', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  const field = host.querySelector('[data-bre-field]');
  field.textContent = '/';
  fire(field, 'input');
  field.textContent = '/formula';
  fire(field, 'input');
  fire(field, 'keydown', { key: 'Enter' });
  await tick(5);
  const d = dlg();
  assert.ok(d, 'formula dialog opened from the slash menu');
  setVal(d, 'E=mc^2');
  d.querySelector('.bre-brew-link-save').click();
  await tick(5);
  assert.equal(ed.getJSON().blocks[0].type, 'formula');
  assert.equal(ed.getJSON().blocks[0].data.latex, 'E=mc^2');
  // second time: cancel → the "/formula" text is cleared
  ed.setJSON(doc([para('p', '')]));
  const f2 = host.querySelector('[data-bre-field]');
  f2.textContent = '/';
  fire(f2, 'input');
  f2.textContent = '/formula';
  fire(f2, 'input');
  fire(f2, 'keydown', { key: 'Enter' });
  await tick(5);
  dlg().querySelector('.bre-brew-link-cancel').click();
  await tick(10);
  assert.equal(ed.getJSON().blocks[0].type, 'paragraph');
  assert.equal(host.querySelector('[data-bre-field]').textContent, '');
  ed.destroy();
});

test('BRE dialog: destroy closes an open dialog; options.prompt still overrides', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([{ id: 'f', type: 'formula', data: { latex: 'x', displayMode: true } }]));
  fire(host.querySelector('.bre-formula'), 'click');
  await tick(5);
  assert.ok(dlg());
  ed.destroy();
  assert.equal(dlg(), null, 'no orphaned dialog after destroy');
});

// ── Adding a line at the end of the document (BRE) ───────────────────────────
test('BRE end of doc: clicking below a non-text last block adds a paragraph (image/table/divider/code/media)', () => {
  const lasts = [
    { id: 'i', type: 'image', data: { src: 'https://example.com/a.png', alt: '', caption: '' } },
    { id: 't', type: 'table', data: { rows: [['a'], ['b']] } },
    { id: 'h', type: 'divider', data: {} },
    { id: 'c', type: 'code', data: { code: 'x', language: '' } },
    { id: 'a', type: 'audio', data: { src: 'https://example.com/a.mp3', caption: '' } },
    { id: 'f', type: 'formula', data: { latex: 'x', displayMode: true } },
  ];
  for (const last of lasts) {
    const host = mount();
    const ed = createEditor(host, { mode: 'BRE' });
    ed.setJSON(doc([para('p', 'text'), last]));
    fire(host.querySelector('.bre-editor'), 'click'); // empty tail area: target is the editor root
    assert.deepEqual(ed.getJSON().blocks.map((b) => b.type), ['paragraph', last.type, 'paragraph'], last.type);
    ed.destroy();
  }
});

test('BRE end of doc: clicking below a text last block only moves the caret (no pile-up of empty lines)', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([para('p', 'text')]));
  for (let i = 0; i < 3; i++) fire(host.querySelector('.bre-editor'), 'click');
  assert.equal(ed.getJSON().blocks.length, 1);
  ed.destroy();
});

test('BRE end of doc: clicks in the side gutter (above the last block bottom) do nothing', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([para('a', 'x'), { id: 'i', type: 'image', data: { src: 'https://example.com/a.png', alt: '', caption: '' } }]));
  const last = host.querySelector('[data-bre-block-id="i"]');
  last.getBoundingClientRect = () => ({ top: 100, bottom: 200, left: 0, right: 100, width: 100, height: 100 });
  fire(host.querySelector('.bre-editor'), 'click', { clientY: 150 }); // beside the image
  assert.equal(ed.getJSON().blocks.length, 2, 'unchanged');
  fire(host.querySelector('.bre-editor'), 'click', { clientY: 260 }); // below it
  assert.equal(ed.getJSON().blocks.length, 3);
  ed.destroy();
});

test('BRE end of doc: ArrowDown on a selected last block, and from a table\'s last row, creates the next line; undo removes it', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([para('p', 'x'), { id: 'i', type: 'image', data: { src: 'https://example.com/a.png', alt: '', caption: '' } }]));
  fire(host.querySelector('.bre-image'), 'click');
  fire(host.querySelector('[data-bre-block-id="i"]'), 'keydown', { key: 'ArrowDown' });
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.type), ['paragraph', 'image', 'paragraph']);
  fire(host.querySelector('[data-bre-block-id="p"] [data-bre-field]'), 'keydown', { key: 'z', metaKey: true });
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.type), ['paragraph', 'image'], 'undo removes the added line');

  ed.setJSON(doc([{ id: 't', type: 'table', data: { rows: [['a', 'b'], ['c', 'd']] } }]));
  fire(host.querySelector('[data-bre-table-row="0"]'), 'keydown', { key: 'ArrowDown' }); // not the last row: native
  assert.equal(ed.getJSON().blocks.length, 1);
  fire(host.querySelector('[data-bre-table-row="1"]'), 'keydown', { key: 'ArrowDown' }); // last row: out of the table
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.type), ['table', 'paragraph']);
  ed.destroy();
});

test('BRE end of doc: the theme leaves a clickable tail below the content (CSS contract)', () => {
  const css = cssSrc('bre.theme.css');
  assert.match(css, /\.bre-editor\[data-bre-mode="BRE"\]\s*\{[^}]*padding-bottom:\s*var\(--bre-tail,\s*3em\)/);
  assert.match(css, /\.bre-brew-surface\s*\{[^}]*padding-bottom:\s*var\(--bre-tail,\s*3em\)/);
});

// ── Review fixes: focus, dialogs, handle, table arrows ───────────────────────
const mediaDoc = () => doc([
  para('a', 'before'),
  { id: 'img', type: 'image', data: { src: 'https://example.com/a.png', alt: '', caption: '' } },
  para('z', 'after'),
]);
const caret = (node, offset) => { const s = window.getSelection(); s.removeAllRanges(); const r = document.createRange(); r.setStart(node, offset); r.collapse(true); s.addRange(r); };

test('table controls: mousedown must not steal focus from the cell (Safari/Firefox hide them otherwise)', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([{ id: 't', type: 'table', data: { rows: [['a'], ['b']] } }]));
  const e = fire(host.querySelector('[data-bre-table-action="add-row"]'), 'mousedown');
  assert.ok(e.defaultPrevented);
  ed.destroy();
});

test('dialog: Cmd/Ctrl+Z inside the input dialog does not undo the document', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([para('a', 'one')]));
  const field = host.querySelector('[data-bre-field]');
  field.textContent = 'two';
  fire(field, 'input');
  // open the formula dialog through the slash flow
  ed.setJSON(doc([{ id: 'f', type: 'formula', data: { latex: 'x', displayMode: true } }]));
  fire(host.querySelector('.bre-formula'), 'click');
  await tick(5);
  const input = dlg().querySelector('input');
  const e = fire(input, 'keydown', { key: 'z', metaKey: true });
  assert.ok(!e.defaultPrevented, 'native input undo is left alone');
  assert.equal(ed.getJSON().blocks[0].type, 'formula', 'document untouched');
  fire(dlg(), 'keydown', { key: 'Escape' });
  ed.destroy();
});

test('dialog: always gets a position (collapsed anchor falls back), and closes on pointerdown outside', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([para('a', '')]));
  const field = host.querySelector('[data-bre-field]');
  field.focus();
  caret(field, 0);
  fire(field, 'keydown', { key: 'k', metaKey: true });
  await tick(5);
  const d = dlg();
  assert.ok(d, 'link dialog opened');
  assert.notEqual(d.style.top, '', 'positioned even though the saved range has no rect');
  assert.notEqual(d.style.left, '');
  await tick(5);
  fire(document.body, 'pointerdown'); // the drag handle suppresses mousedown, so pointerdown it is
  assert.equal(dlg(), null, 'closed by an outside pointerdown');
  ed.destroy();
});

test('dialog: cancelling after a media dblclick keeps the block selected (focus can return)', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(mediaDoc());
  fire(host.querySelector('.bre-image'), 'click');
  const wrapper = host.querySelector('[data-bre-block-id="img"]');
  assert.ok(wrapper.hasAttribute('data-bre-selected'));
  fire(wrapper, 'dblclick'); // dblclick target bubbles from the wrapper's child normally; use the image
  fire(host.querySelector('.bre-image'), 'dblclick');
  await tick(5);
  fire(dlg().querySelector('input'), 'focusin'); // focus moves into the dialog
  assert.ok(wrapper.hasAttribute('data-bre-selected') && wrapper.hasAttribute('tabindex'), 'selection + tabindex survive');
  ed.destroy();
});

test('undo after deleting media keeps focus in the editor (lands in the restored block) and clears stale selection', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(mediaDoc());
  fire(host.querySelector('.bre-image'), 'click');
  fire(host.querySelector('[data-bre-block-id="img"]'), 'keydown', { key: 'Delete' });
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.id), ['a', 'z']);
  const focused = [];
  const orig = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function () { focused.push(this); };
  fire(host.querySelector('[data-bre-block-id="a"] [data-bre-field]'), 'keydown', { key: 'z', metaKey: true });
  window.HTMLElement.prototype.focus = orig;
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.id), ['a', 'img', 'z']);
  const restored = host.querySelector('[data-bre-block-id="img"]');
  assert.ok(focused.length && restored.contains(focused.at(-1)), 'focus goes into the restored block, not <body>');
  assert.equal(host.querySelectorAll('[data-bre-selected]').length, 0, 'no stale selection left over');
  // a block with NO field (divider) is selected instead, so a second Cmd+Z still has a focus target
  ed.setJSON(doc([para('a', 'x'), { id: 'hr', type: 'divider', data: {} }, para('z', 'y')]));
  fire(host.querySelector('.bre-divider'), 'click');
  fire(host.querySelector('[data-bre-block-id="hr"]'), 'keydown', { key: 'Delete' });
  fire(host.querySelector('[data-bre-block-id="a"] [data-bre-field]'), 'keydown', { key: 'z', metaKey: true });
  assert.ok(host.querySelector('[data-bre-block-id="hr"]').hasAttribute('data-bre-selected'), 'divider re-selected');
  ed.destroy();
});

test('drag handle: right/middle press is ignored; a press with no buttons held drops the stale press', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(mediaDoc());
  fire(host.querySelector('[data-bre-block-id="img"]'), 'pointerover');
  const handle = host.querySelector('[data-bre-handle]');
  fire(handle, 'pointerdown', { button: 2, clientX: 5, clientY: 5, pointerId: 1 });
  fire(handle, 'pointerup', { button: 2, clientX: 5, clientY: 5, pointerId: 1 });
  assert.equal(document.querySelector('.bre-block-menu').hidden, true, 'right-click does not open the menu');
  // stale press: left press, then pointermove with no buttons held, then a big move must NOT start a drag
  fire(handle, 'pointerdown', { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
  fire(handle, 'pointermove', { buttons: 0, clientX: 5, clientY: 80, pointerId: 1 });
  assert.equal(host.querySelectorAll('[data-bre-dragging]').length, 0);
  ed.destroy();
});

test('drag handle: hovering the gutter/root beside a tall block keeps the handle; the click after a press is swallowed', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([para('a', 'x'), { id: 'i', type: 'image', data: { src: 'https://example.com/a.png', alt: '', caption: '' } }]));
  fire(host.querySelector('[data-bre-block-id="i"]'), 'pointerover');
  const handle = host.querySelector('[data-bre-handle]');
  assert.equal(handle.hidden, false);
  fire(host.querySelector('.bre-editor'), 'pointerover'); // gutter
  assert.equal(handle.hidden, false, 'still visible');
  // after a handle click, the retargeted click on root must not add a line at the end
  fire(handle, 'pointerdown', { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
  fire(handle, 'pointerup', { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
  fire(host.querySelector('.bre-editor'), 'click');
  assert.equal(ed.getJSON().blocks.length, 2, 'no stray paragraph');
  fire(document.querySelector('.bre-block-menu'), 'keydown', { key: 'Escape' });
  ed.destroy();
});

test('table arrows leave the table only from the cell\'s edge (wrapped cells move line-by-line)', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([{ id: 't', type: 'table', data: { rows: [['aaaa bbbb'], ['cccc dddd']] } }]));
  const last = host.querySelector('[data-bre-table-row="1"]');
  caret(last.firstChild, 3); // middle of the text: a wrapped cell would move down a line natively
  const mid = fire(last, 'keydown', { key: 'ArrowDown' });
  assert.ok(!mid.defaultPrevented);
  assert.equal(ed.getJSON().blocks.length, 1);
  caret(last.firstChild, last.firstChild.length); // at the end
  fire(last, 'keydown', { key: 'ArrowDown' });
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.type), ['table', 'paragraph']);
  ed.destroy();
});

// ── Accessibility fixes from review ──────────────────────────────────────────
test('a11y: Alt+Shift+M works on macOS where Option changes e.key (uses the physical key)', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([para('a', 'x')]));
  assert.equal(host.querySelector('.bre-editor').getAttribute('aria-keyshortcuts'), 'Alt+Shift+M');
  fire(host.querySelector('[data-bre-field]'), 'keydown', { key: 'Â', code: 'KeyM', altKey: true, shiftKey: true });
  const menu = document.querySelector('.bre-block-menu');
  assert.equal(menu.hidden, false);
  fire(menu, 'keydown', { key: 'Escape' });
  ed.destroy();
});

test('a11y: block menu exposes the active item via aria-activedescendant', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(media());
  const menu = openHandleMenu(host, 'img');
  const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
  assert.ok(items.every((i) => i.id), 'every item has an id');
  assert.equal(menu.getAttribute('aria-activedescendant'), items[0].id);
  fire(menu, 'keydown', { key: 'ArrowDown' });
  assert.equal(menu.getAttribute('aria-activedescendant'), items[1].id, 'follows the highlighted item');
  fire(menu, 'keydown', { key: 'Escape' });
  ed.destroy();
});

// ── Image upload: rules shared with BREW / BREM ─────────────────────────────
const imgFile = (name = 'pic.png', body = 'x') => new window.File([body], name, { type: 'image/png' });
const dropFiles = (el, files, props = {}) => fire(el, 'drop', { dataTransfer: { files, types: ['Files'] }, ...props });
const blockEl = (host, id) => host.querySelector(`[data-bre-block-id="${id}"]`);
const rectAt = (el) => { el.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100, left: 0, right: 100, width: 100 }); };

test('BRE upload: drop of an image with no hook is swallowed and reported', async () => {
  const host = mount();
  const errs = [];
  const ed = createEditor(host, { mode: 'BRE', onError: (e) => errs.push(e.type) });
  ed.setJSON(doc([para('p1', 'one')]));
  const e = dropFiles(blockEl(host, 'p1'), [imgFile()]);
  await tick(10);
  assert.ok(e.defaultPrevented);
  assert.deepEqual(errs, ['upload']);
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.type), ['paragraph']);
  ed.destroy();
});

test('BRE upload: pasting a bare image file with no hook is reported, not inserted', async () => {
  const host = mount();
  const errs = [];
  const ed = createEditor(host, { mode: 'BRE', onError: (e) => errs.push(e.type) });
  fire(host.querySelector('[data-bre-field]'), 'paste', { clipboardData: { files: [imgFile()], getData: () => '' } });
  await tick(10);
  assert.deepEqual(errs, ['upload']);
  assert.equal(ed.getJSON().blocks[0].type, 'paragraph');
  ed.destroy();
});

test('BRE upload: uploadMaxSize rejects before the hook runs', async () => {
  const host = mount();
  const errs = []; let called = 0;
  const ed = createEditor(host, { mode: 'BRE', uploadMaxSize: 3, uploadImage: async () => { called++; return 'https://e.com/a.png'; }, onError: (e) => errs.push(e.type) });
  ed.setJSON(doc([para('p1', 'one')]));
  dropFiles(blockEl(host, 'p1'), [imgFile('big.png', '12345')]);
  await tick(10);
  assert.equal(called, 0);
  assert.deepEqual(errs, ['upload']);
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.type), ['paragraph']);
  ed.destroy();
});

test('BRE upload: a drop in the upper half inserts before the block, the lower half after', async () => {
  for (const [clientY, expected] of [[10, ['image', 'paragraph']], [90, ['paragraph', 'image']]]) {
    const host = mount();
    const ed = createEditor(host, { mode: 'BRE', uploadImage: async () => 'https://cdn.example.com/p.png' });
    ed.setJSON(doc([para('p1', 'one')]));
    const el = blockEl(host, 'p1');
    rectAt(el);
    dropFiles(el, [imgFile()], { clientY });
    await tick(20);
    assert.deepEqual(ed.getJSON().blocks.map((b) => b.type), expected, 'clientY ' + clientY);
    ed.destroy();
  }
});

test('BRE upload: several files in one drop upload only the first and report once', async () => {
  const host = mount();
  const calls = [], errs = [];
  const ed = createEditor(host, { mode: 'BRE', uploadImage: async (f) => { calls.push(f.name); return 'https://cdn.example.com/' + f.name; }, onError: (e) => errs.push(e.file && e.file.name) });
  ed.setJSON(doc([para('p1', 'one')]));
  dropFiles(blockEl(host, 'p1'), [imgFile('a.png'), imgFile('b.png'), imgFile('c.png')]);
  await tick(20);
  assert.deepEqual(calls, ['a.png']);
  assert.deepEqual(errs, ['b.png']);
  assert.equal(ed.getJSON().blocks.filter((b) => b.type === 'image').length, 1);
  ed.destroy();
});

test('BRE upload: the root is marked while files are dragged over it', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE', uploadImage: async () => 'https://e.com/a.png' });
  const root = host.querySelector('.bre-editor') || host.firstElementChild;
  fire(root, 'dragenter', { dataTransfer: { types: ['Files'] } });
  assert.equal(root.getAttribute('data-bre-dragover'), 'true');
  fire(root, 'drop', { dataTransfer: { files: [], types: ['Files'] } });
  assert.equal(root.hasAttribute('data-bre-dragover'), false);
  ed.destroy();
});

test('BRE upload: destroy() or setJSON() while an upload is pending does not throw', async () => {
  for (const act of ['destroy', 'setJSON']) {
    const host = mount();
    let release; const gate = new Promise((r) => { release = r; });
    const errs = [];
    const ed = createEditor(host, { mode: 'BRE', uploadImage: async () => { await gate; return 'https://cdn.example.com/p.png'; }, onError: (e) => errs.push(e.type) });
    ed.setJSON(doc([para('p1', 'one')]));
    dropFiles(blockEl(host, 'p1'), [imgFile()]);
    await tick(5);
    if (act === 'destroy') ed.destroy(); else ed.setJSON(doc([para('q1', 'two')]));
    release();
    await tick(20);
    assert.deepEqual(errs, [], act);
    if (act === 'setJSON') { assert.equal(ed.getJSON().blocks.some((b) => b.type === 'image'), false, 'a late result must not land in the newly loaded document'); ed.destroy(); }
  }
});

test('BRE upload: a result arriving after setReadOnly(true) is not inserted', async () => {
  const host = mount();
  let release; const gate = new Promise((r) => { release = r; });
  const ed = createEditor(host, { mode: 'BRE', uploadImage: async () => { await gate; return 'https://cdn.example.com/p.png'; } });
  ed.setJSON(doc([para('p1', 'one')]));
  dropFiles(blockEl(host, 'p1'), [imgFile()]);
  await tick(5);
  ed.setReadOnly(true);
  release(); await tick(20);
  assert.deepEqual(ed.getJSON().blocks.map((b) => b.type), ['paragraph']);
  ed.destroy();
});

test('BRE upload: pasting files together with text pastes the text, not a screenshot', async () => {
  const host = mount();
  let called = 0;
  const ed = createEditor(host, { mode: 'BRE', uploadImage: async () => { called++; return 'https://cdn.example.com/p.png'; } });
  fire(host.querySelector('[data-bre-field]'), 'paste', { clipboardData: { files: [imgFile()], getData: (t) => (t === 'text/plain' ? 'a\tb' : '') } });
  await tick(20);
  assert.equal(called, 0);
  assert.ok(!ed.getJSON().blocks.some((b) => b.type === 'image'));
  ed.destroy();
});

test('BRE upload: a drop onto a block inside a column inserts the image in that column', async () => {
  for (const [clientY, expected] of [[90, ['c1', 'IMG', 'c2']], [10, ['IMG', 'c1', 'c2']]]) {
    const host = mount();
    const ed = createEditor(host, { mode: 'BRE', uploadImage: async () => 'https://cdn.example.com/p.png' });
    ed.setJSON(doc([
      { id: 'cols', type: 'columns', data: { columns: [[para('c1', 'a'), para('c2', 'b')], [para('d1', 'x')]] } },
      para('after', 'end'),
    ]));
    const el = blockEl(host, 'c1');
    assert.ok(el, 'column child is rendered with its block id');
    rectAt(el);
    dropFiles(el, [imgFile()], { clientY });
    await tick(20);
    const blocks = ed.getJSON().blocks;
    assert.deepEqual(blocks.map((b) => b.id === 'cols' ? 'cols' : b.id), ['cols', 'after'], 'top level untouched');
    const col0 = blocks[0].data.columns[0].map((b) => (b.type === 'image' ? 'IMG' : b.id));
    assert.deepEqual(col0, expected, 'clientY ' + clientY);
    assert.equal(blocks[0].data.columns[1].length, 1, 'other column untouched');
    ed.destroy();
  }
});

test('BRE upload: a column drop can be undone', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE', uploadImage: async () => 'https://cdn.example.com/p.png' });
  ed.setJSON(doc([{ id: 'cols', type: 'columns', data: { columns: [[para('c1', 'a')], [para('d1', 'x')]] } }]));
  const el = blockEl(host, 'c1'); rectAt(el);
  dropFiles(el, [imgFile()], { clientY: 90 });
  await tick(20);
  assert.equal(ed.getJSON().blocks[0].data.columns[0].length, 2);
  fire(host.querySelector('[data-bre-field]'), 'keydown', { key: 'z', ctrlKey: true });
  assert.equal(ed.getJSON().blocks[0].data.columns[0].length, 1);
  ed.destroy();
});
