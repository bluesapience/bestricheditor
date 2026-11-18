import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateId } from '../src/utils/id.js';
import { migrateDocument, CURRENT_VERSION } from '../src/core/migrate.js';
import { createState } from '../src/core/state.js';
import { sanitizeHTML, sanitizeURL } from '../src/utils/sanitize.js';
import { htmlToBlocks } from '../src/utils/htmlToBlocks.js';
import { debounce } from '../src/utils/debounce.js';

test('generateId: 1,000,000 ids are unique', () => {
  const seen = new Set();
  for (let i = 0; i < 1_000_000; i++) seen.add(generateId());
  assert.equal(seen.size, 1_000_000);
});

test('generateId: valid attribute/selector token', () => {
  assert.match(generateId(), /^b[a-z0-9]+$/);
});

test('migrate: fills missing fields without mutating the input', () => {
  const input = { blocks: [{ type: 'paragraph' }] };
  const frozen = JSON.stringify(input);
  const out = migrateDocument(input);
  assert.equal(JSON.stringify(input), frozen);
  assert.equal(out.version, CURRENT_VERSION);
  assert.equal(typeof out.id, 'string');
  assert.equal(typeof out.blocks[0].id, 'string');
  assert.deepEqual(out.blocks[0].data, {});
});

test('migrate: current-version doc keeps block identity (cheap)', () => {
  const doc = { id: 'd', version: 1, created: 1, updated: 1, blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' } }] };
  const out = migrateDocument(doc);
  assert.equal(out.blocks, doc.blocks);
});

test('migrate: newer version loads best-effort', () => {
  const warn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  const out = migrateDocument({ id: 'd', version: 99, blocks: [] });
  console.warn = warn;
  assert.ok(warned);
  assert.equal(out.version, 99);
});

test('state: undo/redo restore blocks and share structure', () => {
  const st = createState();
  st.addBlock({ id: 'a', type: 'paragraph', data: { html: 'one' } });
  st.addBlock({ id: 'b', type: 'paragraph', data: { html: 'two' } });
  const bBefore = st.getBlock('b');
  st.saveUndoSnapshot();
  st.updateBlockData('a', { html: 'ONE' });
  assert.equal(st.getBlock('a').data.html, 'ONE');
  assert.equal(st.getBlock('b'), bBefore, 'untouched blocks keep identity');
  assert.ok(st.undo());
  assert.equal(st.getBlock('a').data.html, 'one');
  assert.ok(st.redo());
  assert.equal(st.getBlock('a').data.html, 'ONE');
});

test('state: index cache stays correct across structural edits', () => {
  const st = createState();
  for (const id of ['a', 'b', 'c']) st.addBlock({ id, type: 'paragraph', data: {} });
  st.removeBlock('a');
  assert.deepEqual(st.getBlocks().map((b) => b.id), ['b', 'c']);
  assert.equal(st.getBlockIndex('b'), 0);
  assert.equal(st.getBlockIndex('c'), 1);
  assert.equal(st.getBlockIndex('a'), -1);
  st.moveBlock(0, 1);
  assert.deepEqual(st.getBlocks().map((b) => b.id), ['c', 'b']);
  assert.equal(st.getBlockIndex('b'), 1);
  st.addBlock({ id: 'd', type: 'paragraph', data: {} }, 'c');
  assert.deepEqual(st.getBlocks().map((b) => b.id), ['c', 'd', 'b']);
  assert.equal(st.getBlockIndex('b'), 2);
});

test('state: typing on 5000 blocks stays fast', () => {
  const st = createState();
  st.setDoc({ blocks: Array.from({ length: 5000 }, (_, i) => ({ id: 'b' + i, type: 'paragraph', data: { html: 'x' } })) });
  const t = performance.now();
  for (let i = 0; i < 1000; i++) st.updateBlockData('b4999', { html: 'x' + i });
  const per = (performance.now() - t) / 1000;
  assert.ok(per < 0.5, `update took ${per.toFixed(3)} ms/op`);
});

test('sanitize: XSS payloads are neutralised', () => {
  const payloads = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '<a href="javascript:alert(1)">x</a>',
    '<svg onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<div style="background:url(javascript:alert(1))">x</div>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  ];
  for (const p of payloads) {
    const out = sanitizeHTML(p);
    assert.doesNotMatch(out, /onerror|onload|<script|javascript:/i, p + ' → ' + out);
  }
});

test('sanitize: plain text takes the fast path unchanged', () => {
  assert.equal(sanitizeHTML('a &lt;b&gt; c'), 'a &lt;b&gt; c');
});

test('sanitizeURL: rejects javascript: and data:', () => {
  assert.equal(sanitizeURL('javascript:alert(1)'), '');
  assert.equal(sanitizeURL(' JaVaScRiPt:alert(1)'), '');
  assert.equal(sanitizeURL('data:text/html,<script>'), '');
  assert.equal(sanitizeURL('https://example.com/a'), 'https://example.com/a');
});

test('htmlToBlocks: headings, lists (nested flattened), code language, tables', () => {
  const blocks = htmlToBlocks(
    '<h2>Title</h2><p>Hello <b>world</b></p><ul><li>a<ul><li>b</li></ul></li></ul>' +
    '<pre><code class="language-js">let x</code></pre><table><tr><th>h</th></tr><tr><td>c</td><td>d</td></tr></table><hr>'
  );
  assert.deepEqual(blocks.map((b) => b.type),
    ['heading', 'paragraph', 'bulleted_list', 'bulleted_list', 'code', 'table', 'divider']);
  assert.equal(blocks[0].data.level, 2);
  assert.match(blocks[1].data.html, /<b>world<\/b>/);
  assert.equal(blocks[4].data.language, 'js');
  assert.deepEqual(blocks[5].data.rows, [['h', ''], ['c', 'd']]);
});

test('htmlToBlocks: Google-Docs style wrapper is unwrapped, XSS stripped', () => {
  const blocks = htmlToBlocks(
    '<b style="font-weight:normal" id="docs-internal-guid-1"><p>one</p><p>two<img src=x onerror=alert(1)></p></b>'
  );
  assert.equal(blocks.length, 2);
  assert.doesNotMatch(JSON.stringify(blocks), /onerror/);
});

test('htmlToBlocks: inline runs at top level group into one paragraph', () => {
  const blocks = htmlToBlocks('Hello <b>big</b> world');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'paragraph');
});

test('debounce: cancel and flush', async () => {
  let n = 0;
  const d = debounce(() => { n++; }, 10);
  d(); d.cancel();
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(n, 0);
  d(); d.flush();
  assert.equal(n, 1);
});
