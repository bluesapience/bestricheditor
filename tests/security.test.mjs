import { mount, tick } from './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEditor } from '../src/core/editor.js';
import { sanitizeHTML } from '../src/utils/sanitize.js';

const doc = (blocks) => ({ id: 'd', version: 1, created: 1, updated: 1, blocks });
const para = (id, html) => ({ id, type: 'paragraph', data: { html } });

test('DOM clobbering: id/name never survive (they would shadow window.BRE_KATEX_URL etc.)', () => {
  const payloads = [
    '<a id="BRE_KATEX_URL" href="https://evil.example/x.js">x</a>',
    '<img name="__BRE_KATEX__" src="https://e.com/a.png">',
    '<form name="x"><input id="y"></form>',
  ];
  for (const p of payloads) {
    for (const opts of [{}, { allowMedia: true }, { allowKaTeX: true }, { allowKaTeX: true, allowMedia: true }]) {
      const out = sanitizeHTML(p, opts);
      assert.doesNotMatch(out, /\b(id|name)="(?!user-content-)/i, p + ' ' + JSON.stringify(opts) + ' -> ' + out);
    }
  }
});

test('KaTeX loader only accepts string URLs / real katex objects (UMD clobbering guard)', () => {
  const src = readFileSync(new URL('../src/utils/katex-lazy.js', import.meta.url), 'utf8');
  assert.match(src, /typeof raw === 'string'/, 'URL override must be a string');
  assert.match(src, /typeof k\.renderToString === 'function'/, '__BRE_KATEX__ must look like katex');
});

test('BREW batch sanitising: unclosed tags in one block never leak into the next', async () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BREW' });
  ed.setJSON(doc([
    para('a', '<a href="http://a.com">link'),
    para('b', '<b>bold'),
    para('c', 'plain 3'),
    para('d', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'),
    para('e', '<form action="http://e.com"><input name=x></form>tail'),
  ]));
  const html = ed.getHTML();
  const ps = html.split('\n');
  assert.equal(ps.length, 5, html);
  assert.match(ps[0], /^<p><a href="http:\/\/a\.com">link<\/a><\/p>$/);
  assert.equal(ps[1], '<p><b>bold</b></p>', 'no <a> inherited from the previous block');
  assert.equal(ps[2], '<p>plain 3</p>');
  assert.doesNotMatch(html, /onerror|<form|<input/i);
  ed.destroy();
});

test('loaded documents: media src must pass the URL policy (BRE, BREW)', () => {
  const evil = doc([
    { id: 'i', type: 'image', data: { src: 'javascript:alert(1)' } },
    { id: 'v', type: 'video', data: { src: 'data:text/html,<script>alert(1)</script>' } },
    { id: 'a', type: 'audio', data: { src: ' JaVaScRiPt:alert(1)' } },
    { id: 'ok', type: 'image', data: { src: 'https://example.com/ok.png' } },
  ]);
  for (const mode of ['BRE', 'BREW']) {
    const host = mount();
    const ed = createEditor(host, { mode });
    ed.setJSON(evil);
    const blocks = ed.getJSON().blocks;
    assert.equal(blocks[0].data.src, '', mode + ' image');
    assert.equal(blocks[1].data.src, '', mode + ' video');
    assert.equal(blocks[2].data.src, '', mode + ' audio');
    assert.equal(blocks[3].data.src, 'https://example.com/ok.png', mode + ' valid src kept');
    assert.doesNotMatch(host.innerHTML, /src="(javascript|data):/i, mode + ' DOM');
    ed.destroy();
  }
});

test('loaded documents: hostile block ids are replaced, never injected or truncated into collisions', () => {
  for (const mode of ['BRE', 'BREW']) {
    const host = mount();
    const ed = createEditor(host, { mode });
    ed.setJSON(doc([
      para('a" onfocus="alert(1)" autofocus x="', 'one'),
      para('v"><b>', 'two'),
      para('good-id_1', 'three'),
    ]));
    const ids = ed.getJSON().blocks.map((b) => b.id);
    assert.equal(new Set(ids).size, 3, mode + ' ids unique: ' + ids);
    assert.ok(ids.every((id) => /^[\w.:-]{1,128}$/.test(id)), mode + ' ' + ids);
    assert.equal(ids[2], 'good-id_1', 'safe ids are kept');
    assert.doesNotMatch(host.innerHTML, /onfocus|autofocus/i);
    ed.destroy();
  }
});

test('sanitize hook is removed even if DOMPurify throws (shared instance stays clean)', async () => {
  const { default: DOMPurify } = await import('dompurify');
  const realSanitize = DOMPurify.sanitize;
  let hooksAdded = 0, hooksRemoved = 0;
  const add = DOMPurify.addHook.bind(DOMPurify);
  const rem = DOMPurify.removeHook.bind(DOMPurify);
  DOMPurify.addHook = (...a) => { hooksAdded++; return add(...a); };
  DOMPurify.removeHook = (...a) => { hooksRemoved++; return rem(...a); };
  DOMPurify.sanitize = () => { throw new Error('boom'); };
  assert.throws(() => sanitizeHTML('<b>x</b>', { allowKaTeX: true }), /boom/);
  DOMPurify.sanitize = realSanitize;
  DOMPurify.addHook = add;
  DOMPurify.removeHook = rem;
  assert.equal(hooksAdded, hooksRemoved, 'hook balanced');
});
