import { mount, tick } from './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
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

test('BRE: no hard-coded styling — stylesheet source has no colors/fonts/vars', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/bre.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'no hex colors');
  assert.doesNotMatch(css, /rgba?\(|hsla?\(/i, 'no rgb/hsl colors');
  assert.doesNotMatch(css, /--bre-color|--bre-font|--bre-radius/, 'no theme variables');
  assert.doesNotMatch(css, /font-family\s*:\s*(?!inherit)/i, 'no font families');
  assert.doesNotMatch(css, /box-shadow|border-radius|font-size\s*:\s*[\d.]/i, 'no decorative rules');
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
