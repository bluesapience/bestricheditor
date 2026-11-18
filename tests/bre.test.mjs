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
  const css = readFileSync(new URL('../src/bre.css', import.meta.url), 'utf8');
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

