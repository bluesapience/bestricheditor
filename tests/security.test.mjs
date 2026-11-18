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

// ── data: URIs are never allowed in HTML ─────────────────────────────────────
test('data: URIs are stripped everywhere in sanitized HTML (img, video, poster, a, svg image)', () => {
  const payloads = [
    '<img src="data:image/png;base64,AAAA">',
    '<img src=" \tDATA:image/svg+xml,<svg onload=alert(1)>">',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<video poster="data:image/gif;base64,R0lG" src="data:video/mp4;base64,AA"></video>',
    '<img srcset="data:image/png;base64,AA 1x, https://example.com/a.png 2x">',
    '<svg><image href="data:image/svg+xml,<svg onload=alert(1)>"/></svg>',
  ];
  for (const p of payloads) {
    for (const opts of [{}, { allowMedia: true }, { allowKaTeX: true }, { allowKaTeX: true, allowMedia: true }]) {
      const out = sanitizeHTML(p, opts);
      assert.doesNotMatch(out, /data:/i, p + ' ' + JSON.stringify(opts) + ' -> ' + out);
    }
  }
  // http(s) and relative URLs are untouched
  assert.match(sanitizeHTML('<img src="https://example.com/a.png"><img src="/rel.png">'), /https:\/\/example\.com\/a\.png[\s\S]*\/rel\.png/);
});

test('data: URIs: pasted HTML, BRE/BREW getHTML and getJSON never carry them', async () => {
  const { htmlToBlocks } = await import('../src/utils/htmlToBlocks.js');
  const pasted = htmlToBlocks('<p>x<img src="data:image/png;base64,AAAA"></p><img src="data:image/png;base64,BBBB">');
  assert.doesNotMatch(JSON.stringify(pasted), /data:/i);
  for (const mode of ['BRE', 'BREW']) {
    const ed = createEditor(mount(), { mode });
    ed.setJSON(doc([para('a', 'hi<img src="data:image/png;base64,AAAA"><a href="data:text/html,x">l</a>')]));
    assert.doesNotMatch(ed.getHTML(), /data:/i, mode + ' getHTML');
    assert.doesNotMatch(JSON.stringify(ed.getJSON()), /data:/i, mode + ' getJSON');
    ed.destroy();
  }
});

// ── getJSON()/onChange are sanitized (the host may render them) ──────────────
const HOSTILE = 'hi<img src=x onerror=alert(1)><svg><desc><img src=x onerror=1></desc></svg><a href="javascript:alert(1)">l</a><style>.a{}</style>';

test('getJSON(): html fields are sanitized, including nested column blocks and typed edits', () => {
  const host = mount();
  const ed = createEditor(host, { mode: 'BRE' });
  ed.setJSON(doc([
    para('a', HOSTILE),
    { id: 'c', type: 'columns', data: { columns: [[para('x', HOSTILE)], [para('y', 'clean <b>bold</b>')]] } },
    { id: 'h', type: 'heading', data: { level: 2, html: HOSTILE } },
  ]));
  const json = JSON.stringify(ed.getJSON());
  assert.doesNotMatch(json, /onerror|javascript:|<style|<svg/i, json);
  assert.match(json, /hi/, 'text survives');
  assert.match(json, /<b>bold<\/b>/, 'harmless markup survives');
  // typed edits too
  const field = host.querySelector('[data-bre-field]');
  field.innerHTML = HOSTILE;
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.doesNotMatch(JSON.stringify(ed.getJSON()), /onerror|javascript:|<style/i);
  ed.destroy();
});

test('getJSON(): same object back when nothing changed (no repeated work), new object only after an edit', () => {
  const ed = createEditor(mount(), { mode: 'BRE' });
  ed.setJSON(doc([para('a', HOSTILE), para('b', 'plain')]));
  const first = ed.getJSON();
  const second = ed.getJSON();
  assert.equal(second, first, 'stable identity: cleaned once, cached');
  assert.equal(second.blocks[1], first.blocks[1]);
  ed.destroy();
});

test('getJSON(): stays fast on a big document of simple markup (no DOMPurify for <b>/<i>/plain text)', () => {
  const ed = createEditor(mount(), { mode: 'BRE' });
  ed.setJSON(doc(Array.from({ length: 5000 }, (_, i) => para('b' + i, i % 2 ? 'x <b>' + i + '</b> y' : 'plain ' + i))));
  const t = performance.now();
  const j = ed.getJSON();
  const ms = performance.now() - t;
  assert.equal(j.blocks.length, 5000);
  assert.ok(ms < 150, 'first getJSON took ' + ms.toFixed(1) + ' ms');
  const t2 = performance.now();
  ed.getJSON();
  assert.ok(performance.now() - t2 < 10, 'repeat call is ~free');
  ed.destroy();
});

test("'change' payloads are sanitized too, and undo cannot resurrect raw html into getJSON()", async () => {
  const host = mount();
  let payload = null;
  const ed = createEditor(host, { mode: 'BRE', onChange: (d) => { payload = d; } });
  ed.setJSON(doc([para('a', 'x')]));
  const field = host.querySelector('[data-bre-field]');
  field.innerHTML = HOSTILE;
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(350);
  assert.ok(payload);
  assert.doesNotMatch(JSON.stringify(payload), /onerror|javascript:|<style/i, 'onChange payload');
  // type more (raw), then undo back to the previous raw snapshot: output still clean
  field.innerHTML = HOSTILE + ' more';
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
  field.dispatchEvent(Object.assign(new window.Event('keydown', { bubbles: true, cancelable: true }), { key: 'z', metaKey: true }));
  assert.doesNotMatch(JSON.stringify(ed.getJSON()), /onerror|javascript:|<style/i, 'after undo');
  ed.destroy();
});

test('BREW getJSON() is sanitized for hostile loaded html', () => {
  const ed = createEditor(mount(), { mode: 'BREW' });
  ed.setJSON(doc([para('a', HOSTILE), para('b', 'ok <i>fine</i>')]));
  const json = JSON.stringify(ed.getJSON());
  assert.doesNotMatch(json, /onerror|javascript:|<style|<svg/i, json);
  assert.match(json, /<i>fine<\/i>/);
  ed.destroy();
});
