// jsdom benchmark: setJSON / getJSON / getHTML at 100/1000/5000 blocks.
// Usage: node scripts/bench.mjs [--write file.json] [--check file.json] [--sizes 100,1000]
import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const sizes = (arg('--sizes') || '100,1000,5000').split(',').map(Number);
const THRESHOLD = 0.10;
const ABS_FLOOR_MS = 2; // ignore regressions smaller than this (timer noise)

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window;
for (const k of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'DocumentFragment', 'Event', 'CustomEvent',
  'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'DOMParser', 'Range', 'Selection', 'NodeFilter', 'HTMLTextAreaElement']) {
  if (w[k] !== undefined) { try { Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true }); } catch { /* ignore */ } }
}
globalThis.window = w; globalThis.document = w.document;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };

const { createEditor } = await import('../src/core/editor.js');

function makeDoc(n) {
  const blocks = [];
  for (let i = 0; i < n; i++) {
    const k = i % 4;
    blocks.push(k === 0 ? { id: 'b' + i, type: 'heading', data: { level: 2, html: 'Heading ' + i } }
      : k === 3 ? { id: 'b' + i, type: 'bulleted_list', data: { html: 'Item ' + i } }
      : { id: 'b' + i, type: 'paragraph', data: { html: 'Paragraph <strong>' + i + '</strong> with <em>inline</em> text.' } });
  }
  return { id: 'bench', version: 1, created: 0, updated: 0, blocks };
}

const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const configs = [
  { name: 'BRE (default)', opts: { mode: 'BRE' } },
  { name: 'BRE virtualize:false', opts: { mode: 'BRE', virtualize: false } },
  { name: 'BREM', opts: { mode: 'BREM' }, markdown: true },
  { name: 'BREW', opts: { mode: 'BREW' } },
];

const results = {};
for (const cfg of configs) {
  for (const n of sizes) {
    const key = `${cfg.name} @${n}`;
    const doc = cfg.markdown
      ? { id: 'bench', version: 1, created: 0, updated: 0, blocks: [{ id: 'm', type: 'markdown', data: { markdown: Array.from({ length: n }, (_, i) => `Paragraph **${i}** text`).join('\n\n') } }] }
      : makeDoc(n);
    const runs = { setJSON: [], getJSON: [], getHTML: [] };
    try {
      for (let r = 0; r < 3; r++) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const ed = createEditor(host, { ...cfg.opts });
        try {
          runs.setJSON.push(time(() => ed.setJSON(doc)));
          runs.getJSON.push(time(() => ed.getJSON()));
          runs.getHTML.push(time(() => ed.getHTML()));
        } finally { try { ed.destroy(); } catch { /* ignore */ } host.remove(); }
      }
      results[key] = Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, +median(v).toFixed(2)]));
    } catch (err) {
      results[key] = { error: String(err && err.message || err) };
    }
  }
}

console.log('\n' + 'config'.padEnd(32) + 'setJSON'.padStart(12) + 'getJSON'.padStart(12) + 'getHTML'.padStart(12));
for (const [k, v] of Object.entries(results)) {
  console.log(k.padEnd(32) + (v.error ? '  ERROR: ' + v.error : ['setJSON', 'getJSON', 'getHTML'].map((m) => (v[m] + ' ms').padStart(12)).join('')));
}
console.log('\n' + JSON.stringify(results, null, 2));

const writeFile = arg('--write');
if (writeFile) { writeFileSync(writeFile, JSON.stringify(results, null, 2) + '\n'); console.error(`Wrote baseline to ${writeFile}`); }

const checkFile = arg('--check');
if (checkFile) {
  const base = JSON.parse(readFileSync(checkFile, 'utf8'));
  const failures = [];
  for (const [k, b] of Object.entries(base)) {
    const c = results[k];
    if (!c || b.error) continue;
    if (c.error) { failures.push(`${k}: now errors (${c.error})`); continue; }
    for (const m of ['setJSON', 'getJSON', 'getHTML']) {
      if (c[m] > b[m] * (1 + THRESHOLD) && c[m] - b[m] > ABS_FLOOR_MS) failures.push(`${k} ${m}: ${b[m]} -> ${c[m]} ms (+${(((c[m] / b[m]) - 1) * 100).toFixed(0)}%)`);
    }
  }
  if (failures.length) { console.error('\nPerformance regressions (>10%):\n  ' + failures.join('\n  ')); process.exit(1); }
  console.error('\nBench check passed.');
}
