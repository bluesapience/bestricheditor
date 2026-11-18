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

// ── BREW: select / delete blocks ─────────────────────────────────────────────
const brewDoc = () => doc([
  { id: 'p1', type: 'paragraph', data: { html: 'before' } },
  { id: 'img', type: 'image', data: { src: 'https://example.com/a.png', alt: 'a', caption: '' } },
  { id: 'hr', type: 'divider', data: {} },
  { id: 'tbl', type: 'table', data: { rows: [['a', 'b'], ['c', 'd']] } },
  { id: 'p2', type: 'paragraph', data: { html: 'after' } },
]);
const brewTypes = (ed) => ed.getJSON().blocks.map((b) => b.type);
const ev = (el, type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, props);
  el.dispatchEvent(e);
  return e;
};

test('BREW: click selects media (no dialog); Backspace deletes it', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(brewDoc());
  const fig = host.querySelector('figure[data-bre-type="image"]');
  ev(fig.querySelector('img') || fig, 'click');
  assert.ok(fig.hasAttribute('data-bre-selected'), 'selected');
  assert.equal(host.querySelector('.bre-brew-media-dialog'), null, 'a click never opens the dialog');
  ev(fig, 'keydown', { key: 'Backspace' });
  await tick(5);
  assert.deepEqual(brewTypes(ed), ['paragraph', 'divider', 'table', 'paragraph']);
  ed.destroy();
});

test('BREW: divider click-select + Delete; Escape deselects; focusing elsewhere deselects', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(brewDoc());
  const hr = host.querySelector('.bre-brew-surface hr');
  ev(hr, 'click');
  assert.ok(hr.hasAttribute('data-bre-selected'));
  ev(hr, 'keydown', { key: 'Escape' });
  assert.ok(!hr.hasAttribute('data-bre-selected'));
  ev(hr, 'click');
  ev(host.querySelector('.bre-brew-surface p'), 'focusin');
  assert.ok(!hr.hasAttribute('data-bre-selected'));
  ev(hr, 'click');
  ev(hr, 'keydown', { key: 'Delete' });
  await tick(5);
  assert.deepEqual(brewTypes(ed), ['paragraph', 'image', 'table', 'paragraph']);
  ed.destroy();
});

test('BREW: "Delete table" button removes the whole table', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(brewDoc());
  const btn = host.querySelector('[data-bre-table-action="del-block"]');
  assert.ok(btn, 'button exists');
  assert.equal(btn.textContent, 'Delete table');
  ev(btn, 'click');
  await tick(5);
  assert.deepEqual(brewTypes(ed), ['paragraph', 'image', 'divider', 'paragraph']);
  ed.destroy();
});

test('BREW: double-click media opens the dialog with a Remove button that deletes it', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(brewDoc());
  const fig = host.querySelector('figure[data-bre-type="image"]');
  ev(fig, 'dblclick');
  const dialog = host.querySelector('.bre-brew-media-dialog');
  assert.ok(dialog, 'dialog opened');
  const remove = dialog.querySelector('.bre-brew-link-remove');
  assert.ok(remove, 'Remove button present');
  remove.click();
  await tick(5);
  assert.deepEqual(brewTypes(ed), ['paragraph', 'divider', 'table', 'paragraph']);
  ed.destroy();
});

test('BREW: Enter on a selected media block opens its dialog', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(brewDoc());
  const fig = host.querySelector('figure[data-bre-type="image"]');
  ev(fig, 'click');
  ev(fig, 'keydown', { key: 'Enter' });
  assert.ok(host.querySelector('.bre-brew-media-dialog'));
  ed.destroy();
});

test('BREW read-only: no selection, no dialog, no table controls', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW', readOnly: true });
  ed.setJSON(brewDoc());
  const fig = host.querySelector('figure[data-bre-type="image"]');
  ev(fig, 'click');
  ev(fig, 'dblclick');
  assert.equal(host.querySelectorAll('[data-bre-selected]').length, 0);
  assert.equal(host.querySelector('.bre-brew-media-dialog'), null);
  assert.ok(host.querySelector('.bre-table-controls').hidden);
  ed.destroy();
});

test('BREW: formula click opens an edit dialog (Remove deletes it)', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(doc([{ id: 'f', type: 'formula', data: { latex: 'x^2', displayMode: true } }]));
  const f = host.querySelector('[data-bre-type="formula"]');
  ev(f, 'click');
  const dlg = host.querySelector('.bre-brew-link-dialog');
  assert.ok(dlg, 'formula dialog opened (no window.prompt)');
  dlg.querySelector('.bre-brew-link-remove').click();
  await tick(5);
  assert.equal(brewTypes(ed).includes('formula'), false);
  ed.destroy();
});

test('BREW: captions under image/audio/video are editable inline and saved', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(doc([
    { id: 'i', type: 'image', data: { src: 'https://example.com/a.png', alt: '', caption: 'old' } },
    { id: 'v', type: 'video', data: { src: 'https://example.com/a.mp4', caption: '' } },
  ]));
  const caps = host.querySelectorAll('figcaption.bre-media-caption');
  assert.equal(caps.length, 2);
  for (const c of caps) assert.equal(c.getAttribute('contenteditable'), 'true');
  assert.ok(caps[1].getAttribute('data-bre-placeholder'), 'placeholder text for empty caption');
  // click in the caption must not select the block / open a dialog
  ev(caps[0], 'click');
  assert.equal(host.querySelectorAll('[data-bre-selected]').length, 0);
  // type into captions
  caps[0].textContent = 'A new caption';
  ev(caps[0], 'input');
  caps[1].textContent = 'Video caption';
  ev(caps[1], 'input');
  await tick(5);
  const blocks = ed.getJSON().blocks;
  assert.equal(blocks[0].data.caption, 'A new caption');
  assert.equal(blocks[1].data.caption, 'Video caption');
  assert.match(ed.getHTML(), /<figcaption>A new caption<\/figcaption>/);
  // Enter commits instead of inserting a line break
  const enter = ev(caps[0], 'keydown', { key: 'Enter' });
  assert.ok(enter.defaultPrevented);
  // read-only locks them
  ed.setReadOnly(true);
  for (const c of host.querySelectorAll('figcaption.bre-media-caption')) assert.equal(c.getAttribute('contenteditable'), 'false');
  ed.setReadOnly(false);
  for (const c of host.querySelectorAll('figcaption.bre-media-caption')) assert.equal(c.getAttribute('contenteditable'), 'true');
  ed.destroy();
});

test('BREW: dialogs open next to what they edit, not at the editor corner', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(brewDoc());
  const root = host.querySelector('.bre-editor');
  root.getBoundingClientRect = () => ({ top: 100, bottom: 900, left: 50, right: 850, width: 800, height: 800 });
  const fig = host.querySelector('figure[data-bre-type="image"]');
  fig.getBoundingClientRect = () => ({ top: 300, bottom: 420, left: 200, right: 500, width: 300, height: 120 });
  ev(fig, 'dblclick');
  const dlg = host.querySelector('.bre-brew-media-dialog');
  assert.ok(dlg);
  assert.equal(dlg.style.top, '200px', 'top-left corner on the image: 300 - 100');
  assert.equal(dlg.style.left, '150px', 'left edge on the image: 200 - 50');
  assert.equal(dlg.style.width, '300px', 'spans the block it edits (image is 300 wide)');
  dlg.querySelector('.bre-brew-link-cancel').click();
  // far-right anchors are clamped inside the editor
  fig.getBoundingClientRect = () => ({ top: 300, bottom: 420, left: 840, right: 900, width: 60, height: 120 });
  const origOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 280; } });
  ev(fig, 'dblclick');
  const dlg2 = host.querySelector('.bre-brew-media-dialog');
  assert.equal(dlg2.style.left, '520px', 'clamped: 800 - 280');
  if (origOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOffsetWidth);
  else delete HTMLElement.prototype.offsetWidth;
  ed.destroy();
});

test('BREW: every media block has Edit / Remove buttons (works for iframe video, audio, image)', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(doc([
    { id: 'i', type: 'image', data: { src: 'https://example.com/a.png', alt: '', caption: '' } },
    { id: 'a', type: 'audio', data: { src: 'https://example.com/a.mp3', caption: '' } },
    { id: 'v', type: 'video', data: { src: 'https://www.youtube.com/watch?v=abcdefghijk', caption: '' } },
    { id: 'm', type: 'video', data: { src: 'https://example.com/a.mp4', caption: '' } },
  ]));
  const figs = host.querySelectorAll('figure[data-bre-type]');
  assert.equal(figs.length, 4);
  assert.ok(figs[2].querySelector('iframe'), 'youtube is an iframe (clicks never reach the page)');
  for (const f of figs) {
    assert.ok(f.querySelector('[data-bre-media-action="edit"]'), f.getAttribute('data-bre-type') + ' has Edit');
    assert.ok(f.querySelector('[data-bre-media-action="remove"]'));
  }
  // Edit button opens the dialog for the iframe video; Remove deletes it
  ev(figs[2].querySelector('[data-bre-media-action="edit"]'), 'click');
  assert.ok(host.querySelector('.bre-brew-media-dialog'), 'edit opens the dialog');
  host.querySelector('.bre-brew-link-cancel').click();
  ev(figs[2].querySelector('[data-bre-media-action="remove"]'), 'click');
  ev(figs[1].querySelector('[data-bre-media-action="remove"]'), 'click');
  await tick(5);
  assert.deepEqual(brewTypes(ed), ['image', 'video']);
  // the buttons never leak into the saved document or exported HTML
  assert.doesNotMatch(ed.getHTML(), /button|bre-media-controls/);
  assert.doesNotMatch(JSON.stringify(ed.getJSON()), /button|bre-media-controls/);
  // read-only hides them
  ed.setReadOnly(true);
  for (const c of host.querySelectorAll('.bre-media-controls')) assert.ok(c.hidden);
  ed.destroy();
});

// ── BREW: adding a line after a non-text last block ──────────────────────────
test('BREW: clicking empty space below a non-text last block adds a paragraph', async () => {
  for (const last of [
    { id: 'i', type: 'image', data: { src: 'https://example.com/a.png', alt: '', caption: '' } },
    { id: 't', type: 'table', data: { rows: [['a'], ['b']] } },
    { id: 'h', type: 'divider', data: {} },
    { id: 'c', type: 'code', data: { code: 'x', language: '' } },
  ]) {
    const host = mount();
    const ed = createEditor(host, { mode: 'BREW' });
    ed.setJSON(doc([{ id: 'p', type: 'paragraph', data: { html: 'text' } }, last]));
    const surface = host.querySelector('.bre-brew-surface');
    ev(surface, 'click'); // target === surface: the blank area
    await tick(5);
    const types = brewTypes(ed);
    assert.deepEqual(types, ['paragraph', last.type, 'paragraph'], last.type + ' → new trailing paragraph');
    assert.equal(surface.lastElementChild.nodeName, 'P');
    ed.destroy();
  }
});

test('BREW: clicking below a text last block does not pile up empty paragraphs', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(doc([{ id: 'p', type: 'paragraph', data: { html: 'text' } }]));
  const surface = host.querySelector('.bre-brew-surface');
  for (let i = 0; i < 3; i++) ev(surface, 'click');
  await tick(5);
  assert.deepEqual(brewTypes(ed), ['paragraph']);
  ed.destroy();
});

test('BREW: ArrowDown on a selected last block creates the next line; between blocks it selects/moves', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(doc([
    { id: 'p', type: 'paragraph', data: { html: 'top' } },
    { id: 'i', type: 'image', data: { src: 'https://example.com/a.png', alt: '', caption: '' } },
    { id: 'h', type: 'divider', data: {} },
  ]));
  const surface = host.querySelector('.bre-brew-surface');
  const fig = surface.querySelector('figure');
  ev(fig, 'click');
  ev(fig, 'keydown', { key: 'ArrowDown' }); // next is the divider (non-text): selects it
  const hr = surface.querySelector('hr');
  assert.ok(hr.hasAttribute('data-bre-selected'));
  ev(hr, 'keydown', { key: 'ArrowDown' }); // divider is last: new paragraph
  await tick(5);
  assert.deepEqual(brewTypes(ed), ['paragraph', 'image', 'divider', 'paragraph']);
  ed.destroy();
});

test('BREW: media controls float on the top-left while selected/hovered (CSS contract)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/bre.css', import.meta.url), 'utf8');
  assert.match(css, /\.bre-media-controls\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0;[^}]*inset-inline-start:\s*0/);
  assert.match(css, /figure\[data-bre-selected\] \.bre-media-controls:not\(\[hidden\]\)/);
  assert.match(css, /figure:hover \.bre-media-controls:not\(\[hidden\]\)/);
  assert.match(css, /\.bre-media-controls\s*\{\s*display:\s*none/);
});

test('BREW: formula dialog sits just below its line and spans the block width', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(doc([{ id: 'f', type: 'formula', data: { latex: 'x^2', displayMode: true } }]));
  host.querySelector('.bre-editor').getBoundingClientRect = () => ({ top: 100, bottom: 900, left: 50, right: 850, width: 800, height: 800 });
  const f = host.querySelector('[data-bre-type=\"formula\"]');
  const block = f.closest('p') || f;
  block.getBoundingClientRect = () => ({ top: 160, bottom: 200, left: 50, right: 850, width: 800, height: 40 });
  f.getBoundingClientRect = () => ({ top: 170, bottom: 190, left: 300, right: 340, width: 40, height: 20 });
  ev(f, 'click');
  const dlg = host.querySelector('.bre-brew-link-dialog');
  assert.ok(dlg);
  assert.equal(dlg.style.width, '800px', 'block width, not the tiny formula width');
  assert.equal(dlg.style.top, '106px', 'just below the line: block bottom 200 - root top 100 + 6');
  assert.equal(dlg.style.left, '0px');
  ed.destroy();
});
