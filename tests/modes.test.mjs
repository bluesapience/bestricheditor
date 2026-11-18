import { mount, tick } from './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../src/core/editor.js';

const doc = (blocks) => ({ id: 'd', version: 1, created: 1, updated: 1, blocks });

// Representative document covering the block types that have a Markdown/HTML form.
const FIXTURE = doc([
  { id: '1', type: 'heading', data: { level: 1, html: 'Title' } },
  { id: '2', type: 'heading', data: { level: 3, html: 'Sub' } },
  { id: '3', type: 'paragraph', data: { html: 'Hello <strong>bold</strong> and <em>italic</em> and <code>code</code> and <a href="https://example.com/">link</a>' } },
  { id: '4', type: 'bulleted_list', data: { html: 'bullet one' } },
  { id: '5', type: 'bulleted_list', data: { html: 'bullet two' } },
  { id: '6', type: 'numbered_list', data: { html: 'first' } },
  { id: '7', type: 'numbered_list', data: { html: 'second' } },
  { id: '8', type: 'quote', data: { html: 'a quote' } },
  { id: '9', type: 'code', data: { code: 'const x = 1;', language: 'js' } },
  { id: '10', type: 'divider', data: {} },
  { id: '11', type: 'table', data: { rows: [['H1', 'H2'], ['a', 'b']] } },
  { id: '12', type: 'image', data: { src: 'https://example.com/a.png', alt: 'pic', caption: '' } },
]);

const text = (b) => (b.data.html ?? b.data.text ?? b.data.code ?? '').replace(/<[^>]*>/g, '');

test('D9 regression: BRE document loaded into BREM no longer becomes empty', () => {
  const bre = createEditor(mount(), { mode: 'BRE' });
  bre.setJSON(FIXTURE);
  const brem = createEditor(mount(), { mode: 'BREM' });
  brem.setJSON(bre.getJSON());
  const md = brem.getJSON().blocks[0].data.markdown;
  assert.ok(md.length > 0, 'markdown is not empty');
  assert.match(md, /^# Title/m);
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /^- bullet one/m);
  assert.match(md, /^1\. first/m);
  assert.match(md, /^> a quote/m);
  assert.match(md, /```js\nconst x = 1;\n```/);
  assert.match(md, /^---/m);
  assert.match(md, /\| H1 \| H2 \|/);
  bre.destroy(); brem.destroy();
});

test('BRE → BREM → BRE preserves block types and text', () => {
  const bre = createEditor(mount(), { mode: 'BRE' });
  bre.setJSON(FIXTURE);
  const brem = createEditor(mount(), { mode: 'BREM' });
  brem.setJSON(bre.getJSON());
  const back = createEditor(mount(), { mode: 'BRE' });
  back.setJSON(brem.getJSON({ as: 'blocks' }));
  const a = FIXTURE.blocks;
  const b = back.getJSON().blocks;
  assert.deepEqual(b.map((x) => x.type), a.map((x) => x.type));
  assert.deepEqual(b.map(text), a.map(text));
  assert.equal(b[0].data.level, 1);
  assert.equal(b[1].data.level, 3);
  assert.equal(b[8].data.language, 'js');
  assert.deepEqual(b[10].data.rows, a[10].data.rows);
  assert.match(b[2].data.html, /<strong>bold<\/strong>/);
  assert.match(b[2].data.html, /href="https:\/\/example\.com\/"/);
  bre.destroy(); brem.destroy(); back.destroy();
});

test('BRE document loads into BREW and back without losing blocks', () => {
  const bre = createEditor(mount(), { mode: 'BRE' });
  bre.setJSON(FIXTURE);
  const brew = createEditor(mount(), { mode: 'BREW' });
  brew.setJSON(bre.getJSON());
  const out = brew.getJSON().blocks;
  assert.deepEqual(out.map((x) => x.type), FIXTURE.blocks.map((x) => x.type));
  assert.deepEqual(out.map(text), FIXTURE.blocks.map(text));
  bre.destroy(); brew.destroy();
});

test('BREM document loads into BRE and BREW as real blocks', () => {
  const brem = createEditor(mount(), { mode: 'BREM' });
  brem.setJSON(doc([{ id: 'm', type: 'markdown', data: { markdown: '## Hi\n\ntext **b**\n\n1. one\n2. two' } }]));
  const j = brem.getJSON();
  for (const mode of ['BRE', 'BREW']) {
    const ed = createEditor(mount(), { mode });
    ed.setJSON(j);
    assert.deepEqual(ed.getJSON().blocks.map((b) => b.type), ['heading', 'paragraph', 'numbered_list', 'numbered_list'], mode);
    ed.destroy();
  }
  brem.destroy();
});

test('all modes share the editor API surface', () => {
  for (const mode of ['BRE', 'BREM', 'BREW']) {
    const ed = createEditor(mount(), { mode });
    for (const fn of ['getJSON', 'setJSON', 'getHTML', 'setHTML', 'destroy', 'setReadOnly', 'isReadOnly', 'focus', 'blur', 'isEmpty', 'on', 'off']) {
      assert.equal(typeof ed[fn], 'function', `${mode}.${fn}`);
    }
    ed.destroy();
  }
});

test('all modes: readOnly option + setReadOnly, no change on programmatic set', async () => {
  for (const mode of ['BRE', 'BREM', 'BREW']) {
    let changes = 0;
    const host = mount();
    const ed = createEditor(host, { mode, readOnly: true, onChange: () => { changes++; } });
    assert.ok(ed.isReadOnly(), mode);
    ed.setJSON(doc([{ id: 'a', type: 'paragraph', data: { html: 'x' } }]));
    await tick(350);
    assert.equal(changes, 0, mode + ' setJSON must not fire change');
    assert.equal(host.querySelectorAll('textarea:not([readonly]):not([hidden]), [contenteditable="true"]').length, 0, mode + ' not editable');
    ed.setReadOnly(false);
    assert.ok(!ed.isReadOnly(), mode);
    ed.destroy();
  }
});

test('all modes: ready event fires with the editor', async () => {
  for (const mode of ['BRE', 'BREM', 'BREW']) {
    let got = null;
    const ed = createEditor(mount(), { mode, onReady: (e) => { got = e; } });
    await tick();
    assert.ok(got, mode);
    ed.destroy();
  }
});

test('all modes: destroy leaves no DOM behind', () => {
  for (const mode of ['BRE', 'BREM', 'BREW']) {
    const host = mount();
    const ed = createEditor(host, { mode });
    ed.destroy();
    assert.equal(host.children.length, 0, mode);
  }
});

test('BREW: hostile HTML is neutralised on setHTML/getHTML', () => {
  const ed = createEditor(mount(), { mode: 'BREW' });
  ed.setHTML('<p>ok<img src=x onerror=alert(1)></p><script>alert(1)</script><a href="javascript:alert(1)">x</a>');
  const html = ed.getHTML();
  assert.doesNotMatch(html, /onerror|<script|javascript:/i);
  ed.destroy();
});

test('BREM: preview is sanitized', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREM' });
  ed.setJSON(doc([{ id: 'm', type: 'markdown', data: { markdown: '<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n<script>alert(1)</script>' } }]));
  const preview = host.querySelector('.bre-brem-preview');
  assert.equal(preview.querySelectorAll('script, img, iframe, [onerror], [onclick]').length, 0, 'no live hostile elements');
  assert.equal(preview.querySelectorAll('a[href^="javascript:" i]').length, 0);
  ed.destroy();
});

test('i18n: messages override UI strings', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE', messages: { placeholder: 'Escribe aquí', editorLabel: 'Editor' } });
  assert.equal(host.querySelector('[data-bre-field]').getAttribute('data-bre-placeholder'), 'Escribe aquí');
  assert.equal(host.querySelector('.bre-editor').getAttribute('aria-label'), 'Editor');
  ed.destroy();
});

test('i18n: dir option sets direction', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE', dir: 'rtl' });
  assert.equal(host.querySelector('.bre-editor').getAttribute('dir'), 'rtl');
  ed.destroy();
});

test('embedAllowlist is honored by BREM and BREW output', () => {
  const vid = doc([{ id: 'v', type: 'video', data: { src: 'https://www.youtube.com/watch?v=abcdefghijk' } }]);
  for (const mode of ['BREM', 'BREW']) {
    const allowed = createEditor(mount(), { mode, embedAllowlist: ['youtube.com'] });
    allowed.setJSON(vid);
    assert.match(allowed.getHTML(), /<iframe/, mode + ' allows youtube');
    const blocked = createEditor(mount(), { mode, embedAllowlist: [] });
    blocked.setJSON(vid);
    assert.doesNotMatch(blocked.getHTML(), /<iframe/, mode + ' blocks when not allowlisted');
    allowed.destroy(); blocked.destroy();
  }
});

test('BREW: typing into a bare text node gets wrapped in a paragraph', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  const surface = host.querySelector('.bre-brew-surface');
  surface.appendChild(document.createTextNode('typed on a bare line'));
  surface.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(surface.firstElementChild.nodeName, 'P');
  assert.equal(surface.firstElementChild.textContent, 'typed on a bare line');
  ed.destroy();
});
