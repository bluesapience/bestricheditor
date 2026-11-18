/**
 * Best Rich Editor — BREW (WYSIWYG) mode
 * contenteditable surface with formatting toolbar.
 *
 * Model/serialization design (see D8):
 *  - Every "unit" (a top-level surface child, or an <li> inside a top-level
 *    <ul>/<ol>) maps to exactly one block and is cached in a WeakMap.
 *  - A MutationObserver marks the cached unit dirty; getJSON()/getHTML() only
 *    re-read dirty or new units and reuse everything else.
 *  - Units carry data-bre-id (block id) and data-bre-block-id (assigned lazily,
 *    de-duplicated when the browser clones a node on Enter).
 *
 * Note: programmatic setJSON()/setHTML() never fire 'change' — only user edits do.
 */

import { loadKaTeX, getKaTeX, ensureKaTeXStyles } from '../utils/katex-lazy.js';
import { generateId } from '../utils/id.js';
import { escapeHTML } from '../utils/dom.js';
import { sanitizeHTML, sanitizeURL } from '../utils/sanitize.js';
import { blockRegistry } from '../core/blockRegistry.js';
import { EventEmitter } from '../core/events.js';
import { htmlToBlocks } from '../utils/htmlToBlocks.js';
import { markdownToBlocks } from '../utils/markdown.js';
import { blockToHTML, isSimpleInlineHTML } from '../utils/blocksToHTML.js';
import { cleanPastedHTML } from '../utils/pasteClean.js';

// Ensure all block plugins are registered (same as editor.js)
import '../blocks/paragraph.js';
import '../blocks/heading.js';
import '../blocks/quote.js';
import '../blocks/divider.js';
import '../blocks/code.js';
import '../blocks/bulletedList.js';
import '../blocks/numberedList.js';
import '../ui/columns.js';
import '../blocks/table.js';
import '../blocks/image.js';
import '../blocks/audio.js';
import '../blocks/formula.js';
import { createVideoPlugin } from '../blocks/video.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_EMBED_ALLOWLIST = ['youtube.com', 'youtu.be', 'vimeo.com'];
const CHANGE_DELAY = 400;

export const DEFAULT_MESSAGES = {
  placeholder: 'Start writing…',
  toolbarLabel: 'Formatting',
  surfaceLabel: 'Rich text editor',
  blockType: 'Block type',
  paragraph: 'Paragraph',
  headingN: 'Heading {n}',
  bold: 'Bold (⌘B)',
  italic: 'Italic (⌘I)',
  underline: 'Underline (⌘U)',
  bulletedList: 'Bulleted list',
  numberedList: 'Numbered list',
  quote: 'Quote',
  codeBlock: 'Code block',
  divider: 'Insert divider',
  link: 'Insert link',
  formula: 'Insert formula',
  table: 'Insert table',
  image: 'Insert image',
  audio: 'Insert audio',
  video: 'Insert video',
  linkDialog: 'Link',
  mediaDialog: 'Media',
  linkText: 'Text',
  linkUrl: 'https://...',
  imageUrl: 'Image URL',
  audioUrl: 'Audio URL',
  videoUrl: 'Video URL or YouTube/Vimeo link',
  altText: 'Alt text',
  caption: 'Caption (optional)',
  save: 'Save',
  cancel: 'Cancel',
  remove: 'Remove',
  formulaPrompt: 'Enter LaTeX formula:',
  formulaEditPrompt: 'Edit LaTeX formula:',
  imagePlaceholder: 'Click to set image URL',
  audioPlaceholder: 'Click to set audio URL',
  videoPlaceholder: 'Click to set video URL or paste a YouTube/Vimeo link',
  addRow: '+ Row',
  delRow: '− Row',
  addCol: '+ Col',
  delCol: '− Col',
  delTable: 'Delete table',
  mediaEdit: 'Edit',
  formulaDialog: 'Edit formula',
  formulaPlaceholder: 'LaTeX, e.g. E = mc^2',
  blockSelected: 'Block selected. Press Delete to remove it, Enter to edit.',
  tableHeader: 'Header',
  tableCell: 'Cell',
  invalidDocument: 'Invalid document',
};

const _warned = new Set();
function warnOnce(key, msg) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn('[bre] ' + msg);
}

const HEADING_TAG = /^H[1-6]$/;
const MARKUP = /[<&]/;

function escText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Sanitize many HTML fragments with ONE DOMPurify call (per-call overhead
 * dominates for big docs). Fragments are wrapped in <div>s; if the wrapper
 * structure doesn't survive (a fragment tried to break out) every fragment is
 * sanitized individually instead.
 */
function sanitizeBatch(htmls, options) {
  const n = htmls.length;
  if (n === 0) return [];
  const t = document.createElement('template');
  t.innerHTML = sanitizeHTML(`<div>${htmls.join('</div><div>')}</div>`, options); // sanitized
  const kids = Array.from(t.content.children);
  if (kids.length === n && kids.every(k => k.nodeName === 'DIV')) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = kids[i].innerHTML;
    return out;
  }
  return htmls.map(h => sanitizeHTML(h, options));
}

/**
 * Try to extract a safe embed URL for YouTube/Vimeo (mirrors video.js logic).
 * Returns null if not a known embed provider.
 */
function brewGetEmbedUrl(src, embedAllowlist) {
  if (!src) return null;
  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, '');
    const allowed = (embedAllowlist || []).some(d => host === d || host.endsWith('.' + d));
    if (!allowed) return null;
    if (host === 'youtube.com' || host === 'youtu.be') {
      const id = host === 'youtu.be' ? url.pathname.slice(1).split('?')[0] : url.searchParams.get('v');
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
    }
    if (host === 'vimeo.com') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

function cloneBlock(b) {
  const data = b.data ? { ...b.data } : {};
  if (Array.isArray(data.rows)) data.rows = data.rows.map(r => (Array.isArray(r) ? r.slice() : r));
  return { ...b, data };
}

/** Read inline HTML (sanitized) of an element. Plain-text elements skip DOMPurify. */
function inlineHTMLOf(el) {
  if (el.childElementCount === 0) {
    const t = el.textContent || '';
    return MARKUP.test(t) ? escText(t) : t;
  }
  if (el.childElementCount === 1 && el.firstElementChild.nodeName === 'BR' && !(el.textContent || '')) return '';
  let src = el;
  if (el.querySelector('[data-bre-type="formula"]')) {
    // Store inline formulas as `$latex$` spans, not their rendered KaTeX markup.
    src = el.cloneNode(true);
    for (const f of src.querySelectorAll('[data-bre-type="formula"]')) {
      f.textContent = `$${f.getAttribute('data-bre-latex') || ''}$`;
    }
  }
  const h = src.innerHTML;
  return isSimpleInlineHTML(h) ? h : sanitizeHTML(h);
}

// ── BREW editor factory ────────────────────────────────────────────────────────

export function createBrewEditor(container, options = {}) {
  ensureKaTeXStyles();

  const opts = {
    mode: 'BREW',
    onChange: null,
    embedAllowlist: DEFAULT_EMBED_ALLOWLIST,
    readOnly: false,
    ...options,
  };
  const messages = { ...DEFAULT_MESSAGES, ...(opts.messages || {}) };
  if (typeof opts.placeholder === 'string') messages.placeholder = opts.placeholder;

  // Register video plugin if not already registered (e.g. when BREW used standalone)
  if (!blockRegistry.has('video')) {
    blockRegistry.register('video', createVideoPlugin(opts.embedAllowlist));
  }

  const emitter = new EventEmitter();
  const cleanups = [];
  for (const [ev, fn] of [
    ['change', opts.onChange], ['ready', opts.onReady], ['focus', opts.onFocus],
    ['blur', opts.onBlur], ['selectionchange', opts.onSelectionChange],
  ]) {
    if (typeof fn === 'function') cleanups.push(emitter.on(ev, fn));
  }
  const listen = (target, type, fn, o) => {
    target.addEventListener(type, fn, o);
    cleanups.push(() => target.removeEventListener(type, fn, o));
  };

  let readOnly = !!opts.readOnly;
  let destroyed = false;
  let changeTimer = null;
  let selRaf = null;
  let activeDialog = null;

  let _docMeta = { id: generateId(), version: 1, created: Date.now(), updated: Date.now() };

  // ── Model cache ─────────────────────────────────────────────────────────────
  /** unit node -> { block, html, dirty, list } */
  const cache = new WeakMap();
  let modelDirty = true;
  let _units = [];
  let _blocks = [];

  // ── DOM structure ──────────────────────────────────────────────────────────

  const root = document.createElement('div');
  root.className = 'bre-editor bre-editor--brew';
  root.setAttribute('data-bre-mode', 'BREW');
  if (opts.dir) root.setAttribute('dir', opts.dir);

  const toolbar = document.createElement('div');
  toolbar.className = 'bre-brew-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', messages.toolbarLabel);

  const headingLabel = (n) => messages.headingN.replace('{n}', String(n));

  const blockTypeSelect = document.createElement('select');
  blockTypeSelect.className = 'bre-brew-block-type';
  blockTypeSelect.setAttribute('aria-label', messages.blockType);
  const BLOCK_TYPE_OPTIONS = [
    { value: 'paragraph', label: messages.paragraph },
    ...[1, 2, 3, 4, 5, 6].map(n => ({ value: `heading-${n}`, label: headingLabel(n) })),
  ];
  for (const o of BLOCK_TYPE_OPTIONS) {
    const option = document.createElement('option');
    option.value = o.value;
    option.textContent = o.label;
    blockTypeSelect.appendChild(option);
  }
  toolbar.appendChild(blockTypeSelect);

  function createToolbarBtn(text, cmd, label, toggle) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bre-brew-btn';
    btn.setAttribute('data-brew-cmd', cmd);
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
    if (toggle) btn.setAttribute('aria-pressed', 'false');
    btn.textContent = text;
    return btn;
  }
  const addSep = () => {
    const sep = document.createElement('div');
    sep.className = 'bre-brew-toolbar-sep';
    sep.setAttribute('role', 'separator');
    toolbar.appendChild(sep);
  };

  addSep();
  const btnBold      = createToolbarBtn('B', 'bold', messages.bold, true);
  const btnItalic    = createToolbarBtn('I', 'italic', messages.italic, true);
  const btnUnderline = createToolbarBtn('U', 'underline', messages.underline, true);
  toolbar.append(btnBold, btnItalic, btnUnderline);
  addSep();
  const btnBullet   = createToolbarBtn('•', 'bulleted_list', messages.bulletedList, true);
  const btnNumbered = createToolbarBtn('1.', 'numbered_list', messages.numberedList, true);
  const btnQuote    = createToolbarBtn('"', 'quote', messages.quote, true);
  const btnCode     = createToolbarBtn('</>', 'code', messages.codeBlock, true);
  toolbar.append(btnBullet, btnNumbered, btnQuote, btnCode);
  addSep();
  const btnDivider = createToolbarBtn('—', 'divider', messages.divider);
  const btnLink    = createToolbarBtn('Link', 'link', messages.link);
  const btnFormula = createToolbarBtn('∑', 'formula', messages.formula);
  toolbar.append(btnDivider, btnLink, btnFormula);
  addSep();
  const btnTable = createToolbarBtn('⊞', 'table', messages.table);
  const btnImage = createToolbarBtn('🖼', 'image', messages.image);
  const btnAudio = createToolbarBtn('♪', 'audio', messages.audio);
  const btnVideo = createToolbarBtn('▶', 'video', messages.video);
  toolbar.append(btnTable, btnImage, btnAudio, btnVideo);

  const surface = document.createElement('div');
  surface.className = 'bre-brew-surface';
  surface.setAttribute('role', 'textbox');
  surface.setAttribute('aria-multiline', 'true');
  surface.setAttribute('aria-label', messages.surfaceLabel);
  surface.setAttribute('spellcheck', 'true');
  surface.setAttribute('data-bre-placeholder', messages.placeholder);

  if (!readOnly) root.appendChild(toolbar);
  root.appendChild(surface);
  container.appendChild(root);

  // ── Block -> DOM (setJSON) ──────────────────────────────────────────────────

  const tpl = document.createElement('template');

  function formulaSpanHTML(latex, displayMode, rendered) {
    const l = escapeHTML(latex);
    const disp = displayMode === false ? ' data-bre-display="false"' : '';
    return `<span data-bre-type="formula" data-bre-latex="${l}"${disp} contenteditable="false">${rendered != null ? rendered : escapeHTML('$' + latex + '$')}</span>`;
  }

  function renderKatex(latex, displayMode) {
    const katex = getKaTeX();
    if (!katex) return null;
    try {
      return sanitizeHTML(
        katex.renderToString(latex, { throwOnError: false, output: 'html', displayMode: displayMode !== false }),
        { allowKaTeX: true },
      );
    } catch {
      return null;
    }
  }

  /** Complex (non-text) block -> HTML snippet string. */
  // Edit / Remove buttons under each media block. Needed because embeds (iframes)
  // swallow clicks and a native <video> double-click toggles fullscreen.
  function mediaControls() {
    const b = (a, label) => `<button type="button" class="bre-table-btn" data-bre-media-action="${a}">${escapeHTML(label)}</button>`;
    return `<div class="bre-media-controls" contenteditable="false"${readOnly ? ' hidden' : ''}>${b('edit', messages.mediaEdit)}${b('remove', messages.remove)}</div>`;
  }

  function snippetFor(block, id) {
    const d = block.data || {};
    switch (block.type) {
      case 'code': {
        const lang = escapeHTML(d.language || '');
        return `<pre data-bre-type="code" data-bre-lang="${lang}" data-bre-id="${id}" data-bre-block-id="${id}"><code>${escapeHTML(d.code || '') || '<br>'}</code></pre>`;
      }
      case 'divider':
        return `<hr data-bre-type="divider" data-bre-id="${id}" data-bre-block-id="${id}">`;
      case 'formula': {
        const latex = d.latex || '';
        return `<p data-bre-id="${id}" data-bre-block-id="${id}">${formulaSpanHTML(latex, d.displayMode, renderKatex(latex, d.displayMode))}</p>`;
      }
      case 'table': {
        const rows = Array.isArray(d.rows) && d.rows.length ? d.rows : [['', ''], ['', '']];
        const [headerRow, ...bodyRows] = rows;
        const makeCell = (tag, content, rowIdx, colIdx) => {
          const ph = rowIdx === 0 ? messages.tableHeader : messages.tableCell;
          return `<${tag} class="bre-table-cell" contenteditable="${readOnly ? 'false' : 'true'}" data-bre-table-row="${rowIdx}" data-bre-table-col="${colIdx}" data-bre-placeholder="${escapeHTML(ph)}">${escapeHTML(String(content ?? ''))}</${tag}>`;
        };
        const th = headerRow ? `<thead><tr>${headerRow.map((c, ci) => makeCell('th', c, 0, ci)).join('')}</tr></thead>` : '';
        const tb = bodyRows.length
          ? `<tbody>${bodyRows.map((r, ri) => `<tr>${(Array.isArray(r) ? r : []).map((c, ci) => makeCell('td', c, ri + 1, ci)).join('')}</tr>`).join('')}</tbody>`
          : '';
        const btn = (a, label) => `<button type="button" class="bre-table-btn" data-bre-table-action="${a}">${escapeHTML(label)}</button>`;
        const controls = `<div class="bre-table-controls"${readOnly ? ' hidden' : ''}>${btn('add-row', messages.addRow)}${btn('del-row', messages.delRow)}${btn('add-col', messages.addCol)}${btn('del-col', messages.delCol)}${btn('del-block', messages.delTable)}</div>`;
        return `<div data-bre-type="table" data-bre-id="${id}" data-bre-block-id="${id}" contenteditable="false" class="bre-table-wrapper"><table class="bre-table">${th}${tb}</table>${controls}</div>`;
      }
      case 'image': {
        const src = d.src || '';
        const inner = src
          ? `<img class="bre-image" src="${escapeHTML(src)}" alt="${escapeHTML(d.alt || '')}" loading="lazy">`
          : `<div class="bre-image-placeholder">${escapeHTML(messages.imagePlaceholder)}</div>`;
        return `<figure data-bre-type="image" data-bre-id="${id}" data-bre-block-id="${id}" data-bre-src="${escapeHTML(src)}" data-bre-alt="${escapeHTML(d.alt || '')}" data-bre-caption="${escapeHTML(d.caption || '')}" contenteditable="false" class="bre-image-block">${inner}<figcaption class="bre-media-caption" contenteditable="${readOnly ? 'false' : 'true'}" data-bre-placeholder="${escapeHTML(messages.caption)}">${escapeHTML(d.caption || '')}</figcaption>${mediaControls()}</figure>`;
      }
      case 'audio': {
        const src = d.src || '';
        const inner = src
          ? `<audio class="bre-audio" controls src="${escapeHTML(src)}"></audio>`
          : `<div class="bre-audio-placeholder">${escapeHTML(messages.audioPlaceholder)}</div>`;
        return `<figure data-bre-type="audio" data-bre-id="${id}" data-bre-block-id="${id}" data-bre-src="${escapeHTML(src)}" data-bre-caption="${escapeHTML(d.caption || '')}" contenteditable="false" class="bre-audio-block">${inner}<figcaption class="bre-media-caption" contenteditable="${readOnly ? 'false' : 'true'}" data-bre-placeholder="${escapeHTML(messages.caption)}">${escapeHTML(d.caption || '')}</figcaption>${mediaControls()}</figure>`;
      }
      case 'video': {
        const src = d.src || '';
        const embedUrl = brewGetEmbedUrl(src, opts.embedAllowlist || DEFAULT_EMBED_ALLOWLIST);
        let inner;
        if (!src) inner = `<div class="bre-video-placeholder">${escapeHTML(messages.videoPlaceholder)}</div>`;
        else if (embedUrl) inner = `<iframe class="bre-video-embed" src="${escapeHTML(embedUrl)}" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" allowfullscreen></iframe>`;
        else inner = `<video class="bre-video" controls src="${escapeHTML(src)}"></video>`;
        return `<figure data-bre-type="video" data-bre-id="${id}" data-bre-block-id="${id}" data-bre-src="${escapeHTML(src)}" data-bre-caption="${escapeHTML(d.caption || '')}" contenteditable="false" class="bre-video-block">${inner}<figcaption class="bre-media-caption" contenteditable="${readOnly ? 'false' : 'true'}" data-bre-placeholder="${escapeHTML(messages.caption)}">${escapeHTML(d.caption || '')}</figcaption>${mediaControls()}</figure>`;
      }
      default:
        return '';
    }
  }

  function snippetToNode(html) {
    // Editor-generated snippets: keep KaTeX markup and the table control buttons.
    tpl.innerHTML = sanitizeHTML(html, { allowKaTeX: true, allowMedia: true, allowButtons: true });
    return tpl.content.firstElementChild;
  }

  /** Flatten columns, expand markdown blocks, drop junk. Warns once on lossy steps. */
  function normalizeBlocks(blocks, out = []) {
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'markdown') {
        normalizeBlocks(markdownToBlocks((b.data && b.data.markdown) || ''), out);
      } else if (b.type === 'columns') {
        warnOnce('columns', 'BREW flattens columns blocks into a single column');
        const cols = (b.data && Array.isArray(b.data.columns)) ? b.data.columns
          : (b.data && Array.isArray(b.data.children)) ? b.data.children : [];
        for (const col of cols) normalizeBlocks(Array.isArray(col) ? col : [], out);
      } else {
        out.push(b);
      }
    }
    return out;
  }

  const TEXT_TAG = { paragraph: 'p', quote: 'blockquote', bulleted_list: 'li', numbered_list: 'li' };

  /**
   * Phase 1: describe one unit. Text blocks carry inline html still to be
   * sanitized (`pending`); complex blocks carry a snippet string. Sanitizing
   * is batched across the whole document in phase 2 (see setJSON).
   */
  function planBlock(b, flags) {
    const id = b.id || generateId();
    const d = b.data || {};
    let tag = TEXT_TAG[b.type];
    if (b.type === 'heading') tag = `h${Math.min(6, Math.max(1, parseInt(d.level, 10) || 1))}`;
    if (tag) {
      let html;
      let pending = false;
      if (typeof d.html === 'string') {
        html = d.html;
        pending = !isSimpleInlineHTML(html);
      } else {
        const text = d.text == null ? '' : String(d.text);
        html = MARKUP.test(text) ? escText(text) : text;
      }
      return { b, id, tag, html, pending };
    }
    if (b.type === 'formula') flags.formula = true;
    const snippet = snippetFor(b, id);
    if (snippet) {
      // code/divider snippets are fully escaped constants — no sanitize needed
      return { b, id, snippet, pending: b.type !== 'code' && b.type !== 'divider' };
    }
    // Unknown type: keep its text rather than dropping silently
    const text = d.html != null ? String(d.html) : (d.text != null ? escText(String(d.text)) : '');
    if (text) {
      warnOnce('unk:' + b.type, `BREW: unknown block type "${b.type}" loaded as a paragraph`);
      return { b: { ...b, type: 'paragraph' }, id, tag: 'p', html: text, pending: true };
    }
    warnOnce('unk:' + b.type, `BREW: block type "${b.type}" has no WYSIWYG representation and was skipped`);
    return null;
  }

  /** Phase 3: create the DOM node (+ seed cache for text blocks). */
  function nodeFromPlan(pl, flags) {
    if (pl.snippet != null) {
      if (pl.b.type === 'code' || pl.b.type === 'divider') {
        // Cheap path: build directly instead of parsing a snippet.
        const isCode = pl.b.type === 'code';
        const el = document.createElement(isCode ? 'pre' : 'hr');
        el.setAttribute('data-bre-type', pl.b.type);
        el.setAttribute('data-bre-id', pl.id);
        el.setAttribute('data-bre-block-id', pl.id);
        if (isCode) {
          const d = pl.b.data || {};
          el.setAttribute('data-bre-lang', d.language || '');
          const code = document.createElement('code');
          if (d.code) code.textContent = d.code; else code.appendChild(document.createElement('br'));
          el.appendChild(code);
        }
        return el;
      }
      tpl.innerHTML = pl.snippet; // already sanitized (or fully escaped) in phase 2
      return tpl.content.firstElementChild;
    }
    const { b, id, tag, html } = pl;
    const el = document.createElement(tag);
    el.setAttribute('data-bre-type', b.type);
    el.setAttribute('data-bre-id', id);
    el.setAttribute('data-bre-block-id', id);
    if (html) {
      if (MARKUP.test(html)) {
        if (html.includes('data-bre-type="formula"')) flags.formula = true;
        el.innerHTML = html; // sanitized in phase 2
      } else {
        el.textContent = html;
      }
    } else {
      el.appendChild(document.createElement('br'));
    }
    let data;
    if (b.type === 'heading') {
      const level = Number(tag[1]);
      el.setAttribute('data-bre-level', String(level));
      data = { level, html };
    } else {
      data = { html };
    }
    const listTag = b.type === 'bulleted_list' ? 'UL' : b.type === 'numbered_list' ? 'OL' : null;
    cache.set(el, { block: { id, type: b.type, data }, html: null, dirty: false, list: listTag });
    return el;
  }

  function hydrateFormulas() {
    const katex = getKaTeX();
    if (!katex) return;
    for (const span of surface.querySelectorAll('[data-bre-type="formula"]')) {
      if (span.querySelector('.katex')) continue;
      const latex = span.getAttribute('data-bre-latex') || '';
      const isBlock = span.parentNode && span.parentNode.nodeName === 'P' &&
        (span.parentNode.textContent || '').trim() === (span.textContent || '').trim() &&
        span.getAttribute('data-bre-display') !== 'false';
      const rendered = renderKatex(latex, isBlock);
      if (rendered != null) {
        span.setAttribute('contenteditable', 'false');
        span.innerHTML = rendered; // sanitized by renderKatex
      }
    }
  }

  function afterLoad(flags) {
    if (!flags.formula) return;
    if (getKaTeX()) hydrateFormulas();
    else loadKaTeX().then(() => { if (!destroyed) hydrateFormulas(); });
  }

  // ── DOM -> model ────────────────────────────────────────────────────────────

  function readUnit(node, listTag) {
    if (node.nodeType === 3) {
      const text = node.textContent || '';
      return text.trim() ? { id: generateId(), type: 'paragraph', data: { html: escText(text) } } : null;
    }
    if (node.nodeType !== 1) return null;
    const tag = node.nodeName.toUpperCase();
    if (tag === 'BR' || tag === 'STYLE' || tag === 'SCRIPT') return null;

    let id = node.getAttribute('data-bre-id');
    if (!id) { id = generateId(); node.setAttribute('data-bre-id', id); }
    if (!node.hasAttribute('data-bre-block-id')) node.setAttribute('data-bre-block-id', id);

    if (listTag) {
      return { id, type: listTag === 'UL' ? 'bulleted_list' : 'numbered_list', data: { html: inlineHTMLOf(node) } };
    }
    if (HEADING_TAG.test(tag)) {
      return { id, type: 'heading', data: { level: parseInt(tag[1], 10), html: inlineHTMLOf(node) } };
    }
    switch (tag) {
      case 'P': {
        const formulaSpan = node.querySelector('[data-bre-type="formula"]');
        if (formulaSpan && node.textContent.trim() === formulaSpan.textContent.trim()) {
          return {
            id, type: 'formula',
            data: { latex: formulaSpan.getAttribute('data-bre-latex') || '', displayMode: formulaSpan.getAttribute('data-bre-display') !== 'false' },
          };
        }
        return { id, type: 'paragraph', data: { html: inlineHTMLOf(node) } };
      }
      case 'BLOCKQUOTE':
        return { id, type: 'quote', data: { html: inlineHTMLOf(node) } };
      case 'PRE': {
        const codeEl = node.querySelector('code');
        const code = codeEl ? (codeEl.textContent || '') : (node.textContent || '');
        let language = node.getAttribute('data-bre-lang') || '';
        if (!language && codeEl) {
          const m = /(?:^|\s)language-([\w-]+)/.exec(codeEl.getAttribute('class') || '');
          if (m) language = m[1];
        }
        return { id, type: 'code', data: { code: code === '\n' ? '' : code, language } };
      }
      case 'HR':
        return { id, type: 'divider', data: {} };
      case 'FIGURE': {
        const type = node.getAttribute('data-bre-type');
        const src = node.getAttribute('data-bre-src') || '';
        const caption = node.getAttribute('data-bre-caption') || '';
        if (type === 'image') return { id, type, data: { src, alt: node.getAttribute('data-bre-alt') || '', caption } };
        if (type === 'audio' || type === 'video') return { id, type, data: { src, caption } };
        return { id, type: 'paragraph', data: { html: inlineHTMLOf(node) } };
      }
      case 'DIV': {
        if (node.getAttribute('data-bre-type') === 'table') {
          const rows = [];
          const tableEl = node.querySelector('table');
          if (tableEl) {
            for (const tr of tableEl.querySelectorAll('tr')) {
              const row = [];
              for (const cell of tr.querySelectorAll('th, td')) row.push(cell.textContent || '');
              if (row.length) rows.push(row);
            }
          }
          return { id, type: 'table', data: { rows } };
        }
        // Chrome wraps new lines in divs — treat as paragraph
        return { id, type: 'paragraph', data: { html: inlineHTMLOf(node) } };
      }
      case 'UL':
      case 'OL':
        return null; // handled per <li>
      default: {
        // Stray inline/unknown top-level element — keep its content as a paragraph.
        const html = inlineHTMLOf(node);
        return html ? { id, type: 'paragraph', data: { html } } : null;
      }
    }
  }

  function unitOf(target) {
    if (!target || target === surface) return null;
    let n = target;
    let prev = null;
    while (n && n.parentNode !== surface) { prev = n; n = n.parentNode; }
    if (!n) return null;
    if (n.nodeName === 'UL' || n.nodeName === 'OL') return prev && prev.parentNode === n ? prev : null;
    return n;
  }

  function markRecords(records) {
    for (const r of records) {
      if (r.type === 'attributes' && (r.attributeName === 'data-bre-id' || r.attributeName === 'data-bre-block-id')) continue;
      modelDirty = true;
      const u = unitOf(r.target);
      if (u) {
        const e = cache.get(u);
        if (e) e.dirty = true;
      }
    }
  }

  const observer = new MutationObserver(markRecords);
  observer.observe(surface, { childList: true, subtree: true, characterData: true, attributes: true });

  function buildModel() {
    markRecords(observer.takeRecords());
    if (!modelDirty) return;
    const seen = new Set();
    const units = [];
    const visit = (node, listTag) => {
      let e = cache.get(node);
      if (!e || e.dirty || e.list !== listTag) {
        const block = readUnit(node, listTag);
        e = { block, html: null, dirty: false, list: listTag };
        cache.set(node, e);
      }
      if (!e.block) return;
      if (seen.has(e.block.id)) {
        // Browser cloned a node (Enter/split) — give the duplicate its own id.
        const id = generateId();
        e.block = { ...e.block, id };
        if (node.nodeType === 1) { node.setAttribute('data-bre-id', id); node.setAttribute('data-bre-block-id', id); }
      }
      seen.add(e.block.id);
      units.push(e);
    };
    for (const node of surface.childNodes) {
      if (node.nodeType === 1 && (node.nodeName === 'UL' || node.nodeName === 'OL')) {
        for (const li of node.children) if (li.nodeName === 'LI') visit(li, node.nodeName);
      } else {
        visit(node, null);
      }
    }
    _units = units;
    _blocks = units.map(u => u.block);
    modelDirty = false;
    // Attribute writes above were queued as records; they're filtered, drop them.
    observer.takeRecords();
  }

  // ── Selection / toolbar state ───────────────────────────────────────────────

  function getAnchorBlockEl() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node = sel.anchorNode;
    if (!node || !surface.contains(node)) return null;
    while (node && node.parentNode !== surface) {
      if (node.parentNode && (node.parentNode.nodeName === 'UL' || node.parentNode.nodeName === 'OL') &&
          node.parentNode.parentNode === surface) {
        return node; // the LI
      }
      node = node.parentNode;
    }
    return node instanceof Element ? node : null;
  }

  function getCurrentBlockType() {
    const el = getAnchorBlockEl();
    if (!el) return 'paragraph';
    const tag = el.nodeName.toUpperCase();
    if (HEADING_TAG.test(tag)) return `heading-${tag[1]}`;
    switch (tag) {
      case 'BLOCKQUOTE': return 'quote';
      case 'PRE': return 'code';
      case 'LI': return el.parentNode && el.parentNode.nodeName === 'UL' ? 'bulleted_list' : 'numbered_list';
      default: return 'paragraph';
    }
  }

  function currentBlockHasInline() {
    const t = getCurrentBlockType();
    return blockRegistry.getCapabilities(t.startsWith('heading') ? 'heading' : t).inline;
  }

  function setPressed(btn, on) {
    btn.setAttribute('data-active', on ? 'true' : 'false');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function updateToolbarState() {
    if (readOnly || destroyed) return;
    const currentType = getCurrentBlockType();
    blockTypeSelect.value = BLOCK_TYPE_OPTIONS.some(o => o.value === currentType) ? currentType : 'paragraph';
    setPressed(btnBullet, currentType === 'bulleted_list');
    setPressed(btnNumbered, currentType === 'numbered_list');
    setPressed(btnQuote, currentType === 'quote');
    setPressed(btnCode, currentType === 'code');
    const hasInline = currentBlockHasInline();
    for (const btn of [btnBold, btnItalic, btnUnderline]) {
      btn.disabled = !hasInline;
      let active = false;
      if (hasInline) {
        try { active = document.queryCommandState(btn.getAttribute('data-brew-cmd')); } catch { /* jsdom */ }
      }
      setPressed(btn, active);
    }
  }

  // ── Change notification ─────────────────────────────────────────────────────

  function scheduleChange() {
    if (readOnly) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      changeTimer = null;
      if (destroyed) return;
      _docMeta.updated = Date.now();
      emitter.emit('change', getDoc());
    }, CHANGE_DELAY);
  }

  // ── Block type change ──────────────────────────────────────────────────────

  function setCurrentBlockType(value) {
    surface.focus();
    const blockEl = getAnchorBlockEl();
    if (!blockEl) return;
    if (blockEl.getAttribute('data-bre-type') === 'table' || blockEl.nodeName === 'FIGURE') return;

    const isPre = blockEl.nodeName === 'PRE';
    const plain = blockEl.textContent || '';
    const inlineSrc = isPre ? null : sanitizeHTML(blockEl.innerHTML);
    let newEl;

    const fillInline = (el) => {
      if (inlineSrc != null && MARKUP.test(inlineSrc)) el.innerHTML = inlineSrc; // sanitized above
      else el.textContent = plain;
    };

    if (value === 'paragraph') {
      newEl = document.createElement('p');
      newEl.setAttribute('data-bre-type', 'paragraph');
      fillInline(newEl);
    } else if (value.startsWith('heading-')) {
      const level = parseInt(value.split('-')[1], 10);
      newEl = document.createElement(`h${level}`);
      newEl.setAttribute('data-bre-type', 'heading');
      newEl.setAttribute('data-bre-level', String(level));
      fillInline(newEl);
    } else if (value === 'quote') {
      newEl = document.createElement('blockquote');
      newEl.setAttribute('data-bre-type', 'quote');
      fillInline(newEl);
    } else if (value === 'code') {
      newEl = document.createElement('pre');
      newEl.setAttribute('data-bre-type', 'code');
      const codeEl = document.createElement('code');
      codeEl.textContent = plain;
      newEl.appendChild(codeEl);
    } else if (value === 'bulleted_list' || value === 'numbered_list') {
      const li = document.createElement('li');
      li.setAttribute('data-bre-type', value);
      fillInline(li);
      newEl = document.createElement(value === 'bulleted_list' ? 'ul' : 'ol');
      newEl.appendChild(li);
    }
    if (!newEl) return;
    if (!newEl.firstChild) newEl.appendChild(document.createElement('br'));

    const targetEl = blockEl.nodeName === 'LI' ? blockEl.parentNode : blockEl;
    if (targetEl && targetEl.parentNode === surface) surface.replaceChild(newEl, targetEl);

    const sel = window.getSelection();
    const range = document.createRange();
    const focusTarget = (value === 'bulleted_list' || value === 'numbered_list' || value === 'code') ? newEl.firstChild : newEl;
    if (focusTarget) {
      range.selectNodeContents(focusTarget);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    surface.focus();
    updateToolbarState();
    scheduleChange();
  }

  listen(blockTypeSelect, 'change', () => setCurrentBlockType(blockTypeSelect.value));

  for (const [btn, type] of [
    [btnBullet, 'bulleted_list'], [btnNumbered, 'numbered_list'], [btnQuote, 'quote'], [btnCode, 'code'],
  ]) {
    listen(btn, 'mousedown', (e) => {
      e.preventDefault();
      // Toggle: pressing the active type again returns to a paragraph
      setCurrentBlockType(btn.getAttribute('aria-pressed') === 'true' ? 'paragraph' : type);
    });
    // Keyboard activation (Enter/Space dispatch click without mousedown)
    listen(btn, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setCurrentBlockType(btn.getAttribute('aria-pressed') === 'true' ? 'paragraph' : type);
      }
    });
  }

  // ── Inline marks ───────────────────────────────────────────────────────────

  function applyMark(cmd) {
    if (readOnly || !currentBlockHasInline()) return;
    document.execCommand(cmd);
    updateToolbarState();
    scheduleChange();
  }
  for (const btn of [btnBold, btnItalic, btnUnderline]) {
    const cmd = btn.getAttribute('data-brew-cmd');
    listen(btn, 'mousedown', (e) => { e.preventDefault(); applyMark(cmd); });
    listen(btn, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); surface.focus(); applyMark(cmd); }
    });
  }

  // ── Dialogs ────────────────────────────────────────────────────────────────

  /**
   * Generic small inline dialog. Esc closes and returns focus (and selection)
   * to the surface; Enter confirms. `fields`: [{ key, type, placeholder, value }].
   * `onSave(values)` runs after `validate(values)` returns no invalid keys.
   */
  /**
   * Place a dialog just below its anchor (an Element, Range, or the saved
   * selection), clamped inside the editor. Without this an absolutely positioned
   * dialog sits at the editor's top-left corner.
   */
  function positionDialog(dialog, anchor, atCorner) {
    const rect = (a) => {
      try { return a && a.getBoundingClientRect ? a.getBoundingClientRect() : null; } catch (_) { return null; }
    };
    let r = rect(anchor);
    if (!r || (!r.width && !r.height)) r = rect(toolbar) || rect(surface); // collapsed range etc.
    if (!r) return;
    const rootRect = root.getBoundingClientRect();
    // atCorner: the dialog spans the block it edits (never narrower than a usable form).
    if (atCorner) dialog.style.width = Math.min(Math.max(r.width, 280), rootRect.width || r.width) + 'px';
    // atCorner: dialog's top-left sits on the anchor's top-left; otherwise just below it.
    const top = atCorner ? r.top - rootRect.top : r.bottom - rootRect.top + 6;
    const maxLeft = Math.max(0, rootRect.width - dialog.offsetWidth);
    const left = Math.max(0, Math.min(r.left - rootRect.left, maxLeft));
    dialog.style.top = top + 'px';
    dialog.style.left = left + 'px';
  }

  function openDialog({ className, label, fields, savedRange, anchor, atCorner, validate, onSave, onRemove }) {
    if (activeDialog) activeDialog.close(false);

    const dialog = document.createElement('div');
    dialog.className = className;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', label);

    const inputs = {};
    for (const f of fields) {
      const input = document.createElement('input');
      input.type = f.type || 'text';
      input.placeholder = f.placeholder;
      input.setAttribute('aria-label', f.placeholder);
      input.value = f.value || '';
      input.className = 'bre-brew-link-input';
      dialog.appendChild(input);
      inputs[f.key] = input;
    }

    const actions = document.createElement('div');
    actions.className = 'bre-brew-link-actions';
    const mk = (text, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.className = cls;
      return b;
    };
    const saveBtn = mk(messages.save, 'bre-brew-link-save');
    const cancelBtn = mk(messages.cancel, 'bre-brew-link-cancel');
    if (onRemove) {
      const removeBtn = mk(messages.remove, 'bre-brew-link-remove');
      removeBtn.addEventListener('click', () => { close(true); onRemove(); });
      actions.appendChild(removeBtn);
    }
    actions.append(cancelBtn, saveBtn);
    dialog.appendChild(actions);

    let outsideTimer = null;
    const outside = (e) => { if (!dialog.contains(e.target)) close(false); };

    function close(restoreFocus) {
      clearTimeout(outsideTimer);
      document.removeEventListener('mousedown', outside);
      dialog.remove();
      if (activeDialog && activeDialog.dialog === dialog) activeDialog = null;
      if (restoreFocus && !destroyed) {
        surface.focus();
        if (savedRange) {
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(savedRange);
        }
      }
    }

    saveBtn.addEventListener('click', () => {
      const values = {};
      for (const k of Object.keys(inputs)) values[k] = inputs[k].value.trim();
      for (const input of Object.values(inputs)) input.removeAttribute('aria-invalid');
      const bad = validate ? validate(values) : [];
      if (bad.length) {
        for (const k of bad) inputs[k].setAttribute('aria-invalid', 'true');
        inputs[bad[0]].focus();
        return;
      }
      close(true);
      onSave(values);
    });
    cancelBtn.addEventListener('click', () => close(true));
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveBtn.click(); }
    });

    root.appendChild(dialog);
    positionDialog(dialog, anchor || savedRange, atCorner);
    // Deferred: the mousedown that opened the dialog is still bubbling.
    outsideTimer = setTimeout(() => document.addEventListener('mousedown', outside), 0);
    activeDialog = { dialog, close };
    const first = Object.values(inputs)[0];
    if (first) first.focus();
  }

  function openLinkDialog({ text, url }, savedRange, onSave, onRemove, anchor) {
    openDialog({
      anchor,
      className: 'bre-brew-link-dialog',
      label: messages.linkDialog,
      savedRange,
      fields: [
        { key: 'text', placeholder: messages.linkText, value: text },
        { key: 'url', type: 'url', placeholder: messages.linkUrl, value: url },
      ],
      validate: (v) => {
        const bad = [];
        if (!v.text) bad.push('text');
        if (!v.url || !sanitizeURL(v.url)) bad.push('url');
        return bad;
      },
      onSave: (v) => onSave({ text: v.text, url: sanitizeURL(v.url) }),
      onRemove,
    });
  }

  function openMediaDialog({ src, alt, caption, type }, savedRange, onSave, onRemove, anchor) {
    const fields = [{
      key: 'src', placeholder: type === 'image' ? messages.imageUrl : type === 'audio' ? messages.audioUrl : messages.videoUrl, value: src,
    }];
    if (type === 'image') fields.push({ key: 'alt', placeholder: messages.altText, value: alt });
    fields.push({ key: 'caption', placeholder: messages.caption, value: caption });
    openDialog({
      anchor,
      atCorner: !!anchor,
      className: 'bre-brew-link-dialog bre-brew-media-dialog',
      label: messages.mediaDialog,
      savedRange,
      fields,
      validate: (v) => (v.src && (sanitizeURL(v.src) || brewGetEmbedUrl(v.src, opts.embedAllowlist)) ? [] : ['src']),
      onSave: (v) => onSave({ src: v.src, alt: v.alt || '', caption: v.caption || '' }),
      onRemove,
    });
  }

  const currentRange = () => {
    const sel = window.getSelection();
    return sel && sel.rangeCount > 0 && surface.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  };

  function insertLink(text, url) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) sel.deleteFromDocument();
    document.execCommand('insertText', false, text);
    const sel2 = window.getSelection();
    if (sel2 && sel2.rangeCount > 0) {
      const range = sel2.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const end = range.startOffset;
        const r = document.createRange();
        r.setStart(node, Math.max(0, end - text.length));
        r.setEnd(node, end);
        sel2.removeAllRanges();
        sel2.addRange(r);
      }
    }
    document.execCommand('createLink', false, url);
    const sel3 = window.getSelection();
    if (sel3 && sel3.rangeCount > 0) {
      let node = sel3.getRangeAt(0).commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      const anchor = node.nodeName === 'A' ? node : (node.closest && node.closest('a'));
      if (anchor) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
      }
    }
  }

  function openLinkFromToolbar() {
    if (readOnly) return;
    const savedRange = currentRange();
    openLinkDialog({ text: savedRange ? savedRange.toString() : '', url: '' }, savedRange, ({ text, url }) => {
      surface.focus();
      if (savedRange) {
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(savedRange);
      }
      insertLink(text, url);
      scheduleChange();
    });
  }
  listen(btnLink, 'mousedown', (e) => { e.preventDefault(); openLinkFromToolbar(); });
  listen(btnLink, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLinkFromToolbar(); } });

  // ── Insert buttons ─────────────────────────────────────────────────────────

  function insertDivider() {
    if (readOnly) return;
    surface.focus();
    document.execCommand('insertHTML', false, '<hr data-bre-type="divider"><p><br></p>');
    scheduleChange();
  }
  listen(btnDivider, 'mousedown', (e) => { e.preventDefault(); insertDivider(); });
  listen(btnDivider, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); insertDivider(); } });

  function insertFormula(latex) {
    loadKaTeX().then(() => {
      if (destroyed) return;
      const rendered = renderKatex(latex, false);
      surface.focus();
      document.execCommand('insertHTML', false,
        sanitizeHTML(formulaSpanHTML(latex, false, rendered), { allowKaTeX: true, allowMedia: true }) + '&nbsp;');
      scheduleChange();
    });
  }
  function promptFormula() {
    if (readOnly) return;
    surface.focus();
    const latex = window.prompt(messages.formulaPrompt);
    if (latex) insertFormula(latex);
  }
  listen(btnFormula, 'mousedown', (e) => { e.preventDefault(); promptFormula(); });
  listen(btnFormula, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); promptFormula(); } });

  // ── Table actions ──────────────────────────────────────────────────────────

  function reindexTable(table) {
    table.querySelectorAll('tr').forEach((tr, rowIndex) => {
      tr.querySelectorAll('th, td').forEach((cell, colIndex) => {
        cell.setAttribute('data-bre-table-row', String(rowIndex));
        cell.setAttribute('data-bre-table-col', String(colIndex));
      });
    });
  }

  function makeCell(tag, placeholder) {
    const cell = document.createElement(tag);
    cell.className = 'bre-table-cell';
    cell.setAttribute('contenteditable', 'true');
    cell.setAttribute('data-bre-placeholder', placeholder);
    return cell;
  }

  function handleTableAction(action, wrapper) {
    if (action === 'del-block') { removeBlockEl(wrapper); return; }
    const table = wrapper.querySelector('table');
    if (!table) return;
    if (action === 'add-row') {
      const firstRow = table.querySelector('tr');
      const colCount = firstRow ? firstRow.querySelectorAll('th, td').length : 2;
      let tbody = table.querySelector('tbody');
      if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
      const tr = document.createElement('tr');
      for (let c = 0; c < colCount; c++) tr.appendChild(makeCell('td', messages.tableCell));
      tbody.appendChild(tr);
      reindexTable(table);
    } else if (action === 'del-row') {
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const rows = tbody.querySelectorAll('tr');
      if (rows.length > 0) rows[rows.length - 1].remove();
    } else if (action === 'add-col') {
      table.querySelectorAll('tr').forEach((tr, ri) => {
        tr.appendChild(makeCell(ri === 0 ? 'th' : 'td', ri === 0 ? messages.tableHeader : messages.tableCell));
      });
      reindexTable(table);
    } else if (action === 'del-col') {
      table.querySelectorAll('tr').forEach(tr => {
        const cells = tr.querySelectorAll('th, td');
        if (cells.length > 1) cells[cells.length - 1].remove();
      });
    }
  }

  function insertMediaBlock(block) {
    const id = generateId();
    const snippet = snippetFor({ ...block, id }, id);
    const safe = sanitizeHTML(snippet, { allowKaTeX: true, allowMedia: true, allowButtons: true });
    surface.focus();
    document.execCommand('insertHTML', false, safe + '<p><br></p>');
    scheduleChange();
  }

  const onTable = (e) => { e.preventDefault(); if (!readOnly) insertMediaBlock({ type: 'table', data: {} }); };
  listen(btnTable, 'mousedown', onTable);
  listen(btnTable, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onTable(e); });

  function showMediaDialog(figureEl) {
    const type = figureEl.getAttribute('data-bre-type');
    openMediaDialog({
      src: figureEl.getAttribute('data-bre-src') || '',
      alt: type === 'image' ? (figureEl.getAttribute('data-bre-alt') || '') : null,
      caption: figureEl.getAttribute('data-bre-caption') || '',
      type,
    }, null, ({ src, alt, caption }) => {
      const safe = sanitizeURL(src) || src;
      const node = snippetToNode(snippetFor(
        { type, data: { src: safe, alt, caption } }, figureEl.getAttribute('data-bre-id') || generateId(),
      ));
      if (node && figureEl.parentNode) figureEl.parentNode.replaceChild(node, figureEl);
      scheduleChange();
    }, () => removeBlockEl(figureEl), figureEl);
  }

  for (const [btn, type] of [[btnImage, 'image'], [btnAudio, 'audio'], [btnVideo, 'video']]) {
    const open = (e) => {
      e.preventDefault();
      if (readOnly) return;
      const savedRange = currentRange();
      openMediaDialog({ src: '', alt: '', caption: '', type }, savedRange, ({ src, alt, caption }) => {
        insertMediaBlock({ type, data: { src, alt, caption } });
      });
    };
    listen(btn, 'mousedown', open);
    listen(btn, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  }

  // ── Surface click: links, table controls, media, formulas ───────────────────

  // ── Add a line after a non-text last block ─────────────────────────────────
  const CARET_TAGS = /^(P|H[1-6]|UL|OL|BLOCKQUOTE)$/;
  const NON_TEXT_TYPES = new Set(['image', 'audio', 'video', 'table', 'divider', 'code']);
  /** A block you can put the caret in and type after (not media/table/divider/code). */
  const isTextBlock = (el) => !!el && CARET_TAGS.test(el.nodeName) && !NON_TEXT_TYPES.has(el.getAttribute('data-bre-type') || '');

  function placeCaret(el, atEnd) {
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!atEnd);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /**
   * Clicking the empty space below the last block: if the document ends in
   * something you can't type after (image, table, divider, code…), add a fresh
   * paragraph there; otherwise just put the caret at the end.
   */
  function focusEnd() {
    clearBlockSelection();
    surface.focus();
    const last = surface.lastElementChild;
    if (isTextBlock(last)) {
      placeCaret(last, true);
      return;
    }
    appendParagraphAtEnd();
  }

  function appendParagraphAtEnd() {
    const before = surface.lastElementChild;
    placeCaret(surface, true);
    try { document.execCommand('insertHTML', false, '<p><br></p>'); } catch (_) { /* fall back */ }
    if (surface.lastElementChild === before) { // no native insert (or nothing happened)
      const p = document.createElement('p');
      p.appendChild(document.createElement('br'));
      surface.appendChild(p);
    }
    placeCaret(surface.lastElementChild, false);
    scheduleChange();
  }

  listen(surface, 'click', (e) => {
    if (readOnly) return; // links navigate natively, nothing else is interactive
    if (e.target === surface) { focusEnd(); return; }

    const anchorEl = e.target.closest('a');
    if (anchorEl && surface.contains(anchorEl)) {
      e.preventDefault();
      openLinkDialog(
        { text: anchorEl.textContent || '', url: anchorEl.getAttribute('href') || '' }, null,
        ({ text, url }) => {
          anchorEl.textContent = text;
          anchorEl.setAttribute('href', url);
          scheduleChange();
        },
        () => {
          anchorEl.replaceWith(document.createTextNode(anchorEl.textContent || ''));
          scheduleChange();
        },
        anchorEl,
      );
      return;
    }

    const mediaActionBtn = e.target.closest('[data-bre-media-action]');
    if (mediaActionBtn && surface.contains(mediaActionBtn)) {
      e.preventDefault();
      const fig = mediaActionBtn.closest('figure[data-bre-type]');
      if (fig) {
        if (mediaActionBtn.getAttribute('data-bre-media-action') === 'remove') removeBlockEl(fig);
        else showMediaDialog(fig);
      }
      return;
    }

    const tableActionBtn = e.target.closest('[data-bre-table-action]');
    if (tableActionBtn && surface.contains(tableActionBtn)) {
      e.preventDefault();
      const wrapper = tableActionBtn.closest('[data-bre-type="table"]');
      if (wrapper) {
        handleTableAction(tableActionBtn.getAttribute('data-bre-table-action'), wrapper);
        scheduleChange();
      }
      return;
    }

    // Media / divider: a click selects the block (outline); Delete removes it,
    // Enter or double-click edits. Never opens a dialog by accident.
    // (Clicks in the caption just place the caret: captions are edited inline.)
    const selectable = e.target.closest('figure[data-bre-type], hr');
    if (selectable && surface.contains(selectable) && !e.target.closest('figcaption')) {
      e.preventDefault();
      selectBlockEl(selectable);
      return;
    }

    const formulaEl = e.target.closest('[data-bre-type="formula"]');
    if (!formulaEl) return;
    openFormulaDialog(formulaEl);
  });

  // Double-click a media block to edit its source / alt / caption.
  listen(surface, 'dblclick', (e) => {
    if (readOnly) return;
    const fig = e.target.closest('figure[data-bre-type]');
    if (fig && surface.contains(fig) && !e.target.closest('figcaption') && ['image', 'audio', 'video'].includes(fig.getAttribute('data-bre-type'))) {
      e.preventDefault();
      showMediaDialog(fig);
    }
  });

  // ── Block selection + deletion (media, divider, table, formula) ────────────
  let selectedBlockEl = null;

  function selectBlockEl(el) {
    if (selectedBlockEl && selectedBlockEl !== el) clearBlockSelection();
    selectedBlockEl = el;
    el.setAttribute('data-bre-selected', '');
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }

  function clearBlockSelection() {
    if (!selectedBlockEl) return;
    selectedBlockEl.removeAttribute('data-bre-selected');
    selectedBlockEl.removeAttribute('tabindex');
    selectedBlockEl = null;
  }

  /**
   * Delete a block through the browser's own editing command so it lands on the
   * native undo stack (Cmd+Z restores it); fall back to a plain removal.
   */
  function removeBlockEl(el) {
    if (!el || !el.parentNode) return;
    clearBlockSelection();
    const sel = window.getSelection();
    surface.focus();
    if (sel) {
      const r = document.createRange();
      r.selectNode(el);
      sel.removeAllRanges();
      sel.addRange(r);
      try { document.execCommand('delete'); } catch (_) { /* fall through */ }
    }
    if (el.isConnected) el.remove();
    if (!surface.firstChild) surface.replaceChildren(); // keep :empty for the placeholder
    scheduleChange();
  }

  listen(surface, 'keydown', (e) => {
    // Enter in a caption commits it (no line breaks in a one-line caption).
    if (e.key === 'Enter' && e.target.closest && e.target.closest('figcaption.bre-media-caption')) {
      e.preventDefault();
      return;
    }
    if (readOnly || !selectedBlockEl || e.target !== selectedBlockEl) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      removeBlockEl(selectedBlockEl);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearBlockSelection();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const el = selectedBlockEl;
      const next = e.key === 'ArrowDown' ? el.nextElementSibling : el.previousElementSibling;
      clearBlockSelection();
      surface.focus();
      if (!next) {
        if (e.key === 'ArrowDown') appendParagraphAtEnd(); else placeCaret(el, false);
      } else if (isTextBlock(next)) {
        placeCaret(next, e.key === 'ArrowUp');
      } else {
        selectBlockEl(next); // another non-text block: select it
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (['image', 'audio', 'video'].includes(selectedBlockEl.getAttribute('data-bre-type'))) showMediaDialog(selectedBlockEl);
    }
  });

  listen(surface, 'focusin', (e) => {
    if (selectedBlockEl && e.target !== selectedBlockEl) clearBlockSelection();
  });

  function openFormulaDialog(formulaEl) {
    openDialog({
      className: 'bre-brew-link-dialog',
      label: messages.formulaDialog,
      savedRange: null,
      fields: [{ key: 'latex', placeholder: messages.formulaPlaceholder, value: formulaEl.getAttribute('data-bre-latex') || '' }],
      validate: (v) => (v.latex ? [] : ['latex']),
      onSave: ({ latex }) => {
        loadKaTeX().then(() => {
          if (destroyed) return;
          const rendered = renderKatex(latex, formulaEl.getAttribute('data-bre-display') !== 'false');
          formulaEl.setAttribute('data-bre-latex', latex);
          if (rendered != null) formulaEl.innerHTML = rendered; // sanitized by renderKatex
          else formulaEl.textContent = `$${latex}$`;
          scheduleChange();
        });
      },
      onRemove: () => removeBlockEl(formulaEl),
      anchor: formulaEl,
    });
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  listen(surface, 'keydown', (e) => {
    if (readOnly) return;
    const isMod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (isMod && (k === 'b' || k === 'i' || k === 'u')) {
      e.preventDefault();
      applyMark(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
      return;
    }
    if (e.key === 'Enter') {
      const blockEl = getAnchorBlockEl();
      if (blockEl && blockEl.nodeName === 'PRE') {
        e.preventDefault();
        document.execCommand('insertText', false, '\n');
      }
    }
  });

  // ── Paste ──────────────────────────────────────────────────────────────────

  listen(surface, 'paste', (e) => {
    e.preventDefault();
    if (readOnly || !e.clipboardData) return;
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html && html.trim()) {
      const safe = sanitizeHTML(cleanPastedHTML(html)); // DOMPurify after cleaning
      if (safe.replace(/<[^>]*>/g, '').trim() || /<img\b/i.test(safe)) {
        document.execCommand('insertHTML', false, safe);
        return;
      }
    }
    if (text) document.execCommand('insertText', false, text);
  });

  // ── Input / empty-state ────────────────────────────────────────────────────

  listen(root, 'input', (e) => {
    if (!surface.contains(e.target)) return; // ignore dialog inputs
    // Keep the surface truly :empty when blank so the placeholder CSS can match.
    if (surface.childNodes.length === 1) {
      const n = surface.firstChild;
      if (n.nodeType === 1 && (n.nodeName === 'P' || n.nodeName === 'DIV') &&
          (!n.getAttribute('data-bre-type') || n.getAttribute('data-bre-type') === 'paragraph') &&
          !(n.textContent || '') &&
          (n.childElementCount === 0 || (n.childElementCount === 1 && n.firstElementChild.nodeName === 'BR'))) {
        surface.replaceChildren();
      }
    }
    // Caption typed inline: mirror it onto the figure attribute the serializer reads.
    const cap = e.target.closest && e.target.closest('figcaption.bre-media-caption');
    if (cap) {
      const fig = cap.closest('figure[data-bre-type]');
      if (fig) fig.setAttribute('data-bre-caption', cap.textContent || '');
    }
    wrapBareText();
    scheduleChange();
  });

  /**
   * Browsers type into a bare text node when the surface is empty. Wrap it in a
   * <p> so block-type controls (heading, list, quote…) have a block to act on.
   * Moving a node resets ranges inside it, so the caret is restored afterwards.
   */
  function wrapBareText() {
    let changed = false;
    const sel = window.getSelection();
    const aNode = sel && sel.anchorNode;
    const aOff = sel ? sel.anchorOffset : 0;
    for (const n of Array.from(surface.childNodes)) {
      if (n.nodeType === 3 && n.nodeValue.trim() !== '') {
        const p = document.createElement('p');
        surface.insertBefore(p, n);
        p.appendChild(n);
        changed = true;
      }
    }
    if (changed && aNode && aNode.nodeType === 3 && surface.contains(aNode)) {
      sel.collapse(aNode, Math.min(aOff, aNode.nodeValue.length));
    }
  }

  // ── Focus / selection events ───────────────────────────────────────────────

  listen(root, 'focusin', (e) => {
    if (!e.relatedTarget || !root.contains(e.relatedTarget)) emitter.emit('focus', e);
  });
  listen(root, 'focusout', (e) => {
    if (!e.relatedTarget || !root.contains(e.relatedTarget)) emitter.emit('blur', e);
  });

  const raf = (fn) => (window.requestAnimationFrame ? window.requestAnimationFrame(fn) : setTimeout(fn, 16));
  const cancelRaf = (h) => (window.cancelAnimationFrame ? window.cancelAnimationFrame(h) : clearTimeout(h));

  function onSelectionChange() {
    if (selRaf != null) return;
    selRaf = raf(() => {
      selRaf = null;
      if (destroyed) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !surface.contains(sel.anchorNode)) return;
      updateToolbarState();
      const el = getAnchorBlockEl();
      emitter.emit('selectionchange', {
        blockId: el ? el.getAttribute('data-bre-id') : null,
        collapsed: sel.isCollapsed,
      });
    });
  }
  listen(document, 'selectionchange', onSelectionChange);

  // ── Read-only ──────────────────────────────────────────────────────────────

  function applyIslandsReadOnly() {
    for (const cell of surface.querySelectorAll('[data-bre-table-row]')) {
      cell.setAttribute('contenteditable', readOnly ? 'false' : 'true');
    }
    for (const cap of surface.querySelectorAll('.bre-media-caption')) {
      cap.setAttribute('contenteditable', readOnly ? 'false' : 'true');
    }
    for (const c of surface.querySelectorAll('.bre-table-controls, .bre-media-controls')) c.hidden = readOnly;
  }

  function applyReadOnly() {
    surface.setAttribute('contenteditable', readOnly ? 'false' : 'true');
    surface.setAttribute('aria-readonly', readOnly ? 'true' : 'false');
    if (readOnly) {
      toolbar.remove();
      root.setAttribute('data-bre-readonly', 'true');
      if (activeDialog) activeDialog.close(false);
    } else {
      root.removeAttribute('data-bre-readonly');
      root.insertBefore(toolbar, surface);
    }
    applyIslandsReadOnly();
  }
  surface.setAttribute('contenteditable', readOnly ? 'false' : 'true');
  surface.setAttribute('aria-readonly', readOnly ? 'true' : 'false');
  if (readOnly) root.setAttribute('data-bre-readonly', 'true');

  // ── Public API ──────────────────────────────────────────────────────────────

  function getDoc() {
    buildModel();
    return { ..._docMeta, blocks: _blocks.map(cloneBlock) };
  }

  /** Returns the document. Cheap on repeat calls: only changed units are re-read. */
  function getJSON() {
    return getDoc();
  }

  /** Accepts BRE blocks and/or 'markdown' blocks. Does not fire 'change'. */
  function setJSON(doc) {
    if (!doc || !Array.isArray(doc.blocks)) {
      console.warn('[bre] BREW setJSON: ' + messages.invalidDocument);
      return;
    }
    clearTimeout(changeTimer);
    changeTimer = null;
    _docMeta = {
      id: doc.id || _docMeta.id,
      version: Number(doc.version) || 1,
      created: doc.created || Date.now(),
      updated: Date.now(),
    };
    const blocks = normalizeBlocks(doc.blocks);
    const flags = { formula: false };
    const plans = [];
    for (const b of blocks) {
      const pl = planBlock(b, flags);
      if (pl) plans.push(pl);
    }
    // Phase 2: one DOMPurify call for all text markup, one for all media/table snippets.
    const textIdx = [];
    const snipIdx = [];
    plans.forEach((pl, i) => {
      if (!pl.pending) return;
      (pl.snippet != null ? snipIdx : textIdx).push(i);
    });
    const textOut = sanitizeBatch(textIdx.map(i => plans[i].html));
    textIdx.forEach((i, k) => { plans[i].html = textOut[k]; });
    const snipOut = sanitizeBatch(snipIdx.map(i => plans[i].snippet), { allowKaTeX: true, allowMedia: true, allowButtons: true });
    snipIdx.forEach((i, k) => { plans[i].snippet = snipOut[k]; });

    const frag = document.createDocumentFragment();
    let list = null;
    for (const pl of plans) {
      const isList = pl.b.type === 'bulleted_list' || pl.b.type === 'numbered_list';
      const node = nodeFromPlan(pl, flags);
      if (!node) continue;
      if (isList) {
        const tag = pl.b.type === 'bulleted_list' ? 'UL' : 'OL';
        if (!list || list.nodeName !== tag) {
          list = document.createElement(tag.toLowerCase());
          frag.appendChild(list);
        }
        list.appendChild(node);
      } else {
        list = null;
        frag.appendChild(node);
      }
    }
    surface.replaceChildren(frag);
    observer.takeRecords(); // our own render isn't a user edit
    modelDirty = true;
    applyIslandsReadOnly();
    afterLoad(flags);
    updateToolbarState();
  }

  function getHTML() {
    buildModel();
    const parts = [];
    let open = null;
    for (const u of _units) {
      const t = u.block.type;
      const want = t === 'bulleted_list' ? 'ul' : t === 'numbered_list' ? 'ol' : null;
      if (open && open !== want) { parts.push(`</${open}>`); open = null; }
      if (want && !open) { parts.push(`<${want}>`); open = want; }
      if (u.html == null) {
        const h = blockToHTML(u.block, { trusted: true, embedAllowlist: opts.embedAllowlist });
        // KaTeX not loaded yet → plain-text fallback: use it now but don't cache it.
        if (h.indexOf('bre-formula-error') !== -1 && !getKaTeX()) { loadKaTeX(); parts.push(h); continue; }
        u.html = h;
      }
      if (u.html) parts.push(u.html);
    }
    if (open) parts.push(`</${open}>`);
    return parts.join('\n');
  }

  /** Does not fire 'change'. */
  function setHTML(html) {
    if (typeof html !== 'string') return;
    setJSON({ id: _docMeta.id, version: _docMeta.version, created: _docMeta.created, blocks: htmlToBlocks(html) });
  }

  function setReadOnly(v) {
    v = !!v;
    if (v === readOnly) return;
    readOnly = v;
    if (readOnly) { clearTimeout(changeTimer); changeTimer = null; }
    applyReadOnly();
  }

  function isEmpty() {
    if ((surface.textContent || '').trim()) return false;
    return !surface.querySelector('img,audio,video,iframe,hr,table,figure,[data-bre-type="formula"]');
  }

  function focus() { surface.focus(); }
  function blur() {
    if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(changeTimer);
    changeTimer = null;
    if (selRaf != null) cancelRaf(selRaf);
    selRaf = null;
    if (activeDialog) activeDialog.close(false);
    observer.disconnect();
    cleanups.forEach(fn => fn());
    cleanups.length = 0;
    if (emitter._listeners) emitter._listeners.clear();
    root.remove();
  }

  const api = {
    getJSON, setJSON, getHTML, setHTML, destroy,
    setReadOnly,
    isReadOnly: () => readOnly,
    focus, blur, isEmpty,
    on: (ev, fn) => emitter.on(ev, fn),
    off: (ev, fn) => emitter.off(ev, fn),
  };

  queueMicrotask(() => { if (!destroyed) emitter.emit('ready', api); });
  return api;
}
