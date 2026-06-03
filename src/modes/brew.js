/**
 * Best Rich Editor — BREW (WYSIWYG) mode
 * contenteditable surface with formatting toolbar.
 */

import { katexReady, getKaTeX, ensureKaTeXStyles } from '../utils/katex-lazy.js';
import { generateId } from '../utils/id.js';
import { debounce } from '../utils/debounce.js';
import { escapeHTML } from '../utils/dom.js';
import { sanitizeHTML, sanitizeURL } from '../utils/sanitize.js';
import { blockRegistry } from '../core/blockRegistry.js';
import { htmlToBlocks } from '../utils/htmlToBlocks.js';

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
import { createVideoPlugin } from '../blocks/video.js';

// ── Module-level constants ─────────────────────────────────────────────────────

const DEFAULT_EMBED_ALLOWLIST = ['youtube.com', 'youtu.be', 'vimeo.com'];

/**
 * Try to extract a safe embed URL for YouTube/Vimeo (mirrors video.js logic).
 * Returns null if not a known embed provider.
 */
function brewGetEmbedUrl(src, embedAllowlist) {
  if (!src) return null;
  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, '');
    const allowed = (embedAllowlist || []).some(
      d => host === d || host.endsWith('.' + d)
    );
    if (!allowed) return null;
    if (host === 'youtube.com' || host === 'youtu.be') {
      const id = host === 'youtu.be'
        ? url.pathname.slice(1).split('?')[0]
        : url.searchParams.get('v');
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

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Convert a single block to its surface HTML representation.
 * Returns a string of HTML for that block (without list wrapper).
 */
function blockToSurfaceHTMLSnippet(block, embedAllowlist) {
  const id = block.id || generateId();
  switch (block.type) {
    case 'paragraph': {
      const html = (block.data && block.data.html != null)
        ? sanitizeHTML(block.data.html)
        : escapeHTML((block.data && block.data.text) || '');
      return `<p data-bre-type="paragraph" data-bre-id="${id}">${html || '<br>'}</p>`;
    }
    case 'heading': {
      const level = (block.data && block.data.level) || 1;
      const html = (block.data && block.data.html != null)
        ? sanitizeHTML(block.data.html)
        : escapeHTML((block.data && block.data.text) || '');
      return `<h${level} data-bre-type="heading" data-bre-level="${level}" data-bre-id="${id}">${html || '<br>'}</h${level}>`;
    }
    case 'quote': {
      const html = (block.data && block.data.html != null)
        ? sanitizeHTML(block.data.html)
        : escapeHTML((block.data && block.data.text) || '');
      return `<blockquote data-bre-type="quote" data-bre-id="${id}">${html || '<br>'}</blockquote>`;
    }
    case 'code': {
      const lang = escapeHTML((block.data && block.data.language) || '');
      const code = escapeHTML((block.data && block.data.code) || '');
      return `<pre data-bre-type="code" data-bre-lang="${lang}" data-bre-id="${id}"><code>${code || '<br>'}</code></pre>`;
    }
    case 'bulleted_list': {
      const html = (block.data && block.data.html != null)
        ? sanitizeHTML(block.data.html)
        : escapeHTML((block.data && block.data.text) || '');
      return `<li data-bre-type="bulleted_list" data-bre-id="${id}">${html || '<br>'}</li>`;
    }
    case 'numbered_list': {
      const html = (block.data && block.data.html != null)
        ? sanitizeHTML(block.data.html)
        : escapeHTML((block.data && block.data.text) || '');
      return `<li data-bre-type="numbered_list" data-bre-id="${id}">${html || '<br>'}</li>`;
    }
    case 'divider': {
      return `<hr data-bre-type="divider" data-bre-id="${id}">`;
    }
    case 'formula': {
      const latex = (block.data && block.data.latex) || '';
      const katex = getKaTeX();
      if (!katex) return `<p data-bre-id="${id}"><em>[Formula: ${escapeHTML(latex)}]</em></p>`;
      try {
        const rendered = katex.renderToString(latex, { throwOnError: false, output: 'html' });
        const safe = sanitizeHTML(rendered, { allowKaTeX: true });
        const escapedLatex = latex.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `<p data-bre-id="${id}"><span data-bre-type="formula" data-bre-latex="${escapedLatex}" contenteditable="false">${safe}</span></p>`;
      } catch {
        return `<p data-bre-id="${id}"><em>[Formula: ${escapeHTML(latex)}]</em></p>`;
      }
    }
    case 'table': {
      const rows = (block.data && Array.isArray(block.data.rows)) ? block.data.rows : [['Header 1', 'Header 2'], ['', '']];
      const [headerRow, ...bodyRows] = rows;
      const makeCell = (tag, content, rowIdx, colIdx) => {
        const ph = rowIdx === 0 ? 'Header' : 'Cell';
        return `<${tag} class="bre-table-cell" contenteditable="true" data-bre-table-row="${rowIdx}" data-bre-table-col="${colIdx}" data-bre-placeholder="${ph}">${escapeHTML(String(content))}</${tag}>`;
      };
      const thHTML = headerRow
        ? `<thead><tr>${headerRow.map((c, ci) => makeCell('th', c, 0, ci)).join('')}</tr></thead>`
        : '';
      const tbHTML = bodyRows.length > 0
        ? `<tbody>${bodyRows.map((r, ri) => `<tr>${(Array.isArray(r) ? r : []).map((c, ci) => makeCell('td', c, ri + 1, ci)).join('')}</tr>`).join('')}</tbody>`
        : '';
      const controls = `<div class="bre-table-controls"><button type="button" class="bre-table-btn" data-bre-table-action="add-row">+ Row</button><button type="button" class="bre-table-btn" data-bre-table-action="del-row">− Row</button><button type="button" class="bre-table-btn" data-bre-table-action="add-col">+ Col</button><button type="button" class="bre-table-btn" data-bre-table-action="del-col">− Col</button></div>`;
      return `<div data-bre-type="table" data-bre-id="${id}" contenteditable="false" class="bre-table-wrapper"><table class="bre-table">${thHTML}${tbHTML}</table>${controls}</div>`;
    }
    case 'image': {
      const src = (block.data && block.data.src) || '';
      const alt = (block.data && block.data.alt) || '';
      const caption = (block.data && block.data.caption) || '';
      const inner = src
        ? `<img class="bre-image" src="${escapeHTML(src)}" alt="${escapeHTML(alt)}" loading="lazy">`
        : `<div class="bre-image-placeholder">Click to set image URL</div>`;
      const cap = `<figcaption class="bre-media-caption">${escapeHTML(caption)}</figcaption>`;
      return `<figure data-bre-type="image" data-bre-id="${id}" data-bre-src="${escapeHTML(src)}" data-bre-alt="${escapeHTML(alt)}" data-bre-caption="${escapeHTML(caption)}" contenteditable="false" class="bre-image-block">${inner}${cap}</figure>`;
    }
    case 'audio': {
      const src = (block.data && block.data.src) || '';
      const caption = (block.data && block.data.caption) || '';
      const inner = src
        ? `<audio class="bre-audio" controls src="${escapeHTML(src)}"></audio>`
        : `<div class="bre-audio-placeholder">Click to set audio URL</div>`;
      const cap = `<figcaption class="bre-media-caption">${escapeHTML(caption)}</figcaption>`;
      return `<figure data-bre-type="audio" data-bre-id="${id}" data-bre-src="${escapeHTML(src)}" data-bre-caption="${escapeHTML(caption)}" contenteditable="false" class="bre-audio-block">${inner}${cap}</figure>`;
    }
    case 'video': {
      const src = (block.data && block.data.src) || '';
      const caption = (block.data && block.data.caption) || '';
      const embedUrl = brewGetEmbedUrl(src, embedAllowlist || DEFAULT_EMBED_ALLOWLIST);
      let inner;
      if (!src) {
        inner = `<div class="bre-video-placeholder">Click to set video URL or paste a YouTube/Vimeo link</div>`;
      } else if (embedUrl) {
        inner = `<iframe class="bre-video-embed" src="${escapeHTML(embedUrl)}" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" allowfullscreen></iframe>`;
      } else {
        inner = `<video class="bre-video" controls src="${escapeHTML(src)}"></video>`;
      }
      const cap = `<figcaption class="bre-media-caption">${escapeHTML(caption)}</figcaption>`;
      return `<figure data-bre-type="video" data-bre-id="${id}" data-bre-src="${escapeHTML(src)}" data-bre-caption="${escapeHTML(caption)}" contenteditable="false" class="bre-video-block">${inner}${cap}</figure>`;
    }
    case 'columns': {
      return `<p data-bre-type="paragraph" data-bre-id="${id}"><em>[Columns block — edit in BRE mode]</em></p>`;
    }
    default: {
      // Unknown block types rendered as placeholder paragraph
      return `<p data-bre-type="paragraph" data-bre-id="${id}"><em>[Unknown block: ${escapeHTML(block.type)}]</em></p>`;
    }
  }
}

/**
 * Convert an array of blocks to surface innerHTML (with UL/OL grouping).
 */
function blocksToSurfaceHTML(blocks, embedAllowlist) {
  const parts = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === 'bulleted_list') {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'bulleted_list') {
        items.push(blockToSurfaceHTMLSnippet(blocks[i], embedAllowlist));
        i++;
      }
      parts.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (block.type === 'numbered_list') {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'numbered_list') {
        items.push(blockToSurfaceHTMLSnippet(blocks[i], embedAllowlist));
        i++;
      }
      parts.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    parts.push(blockToSurfaceHTMLSnippet(block, embedAllowlist));
    i++;
  }
  return parts.join('');
}

/**
 * Parse the surface DOM into a blocks array.
 */
function surfaceToBlocks(surface) {
  const blocks = [];

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return; // skip bare text nodes
    if (node.nodeName === 'BR') return;

    const tag = node.nodeName.toUpperCase();
    const id = node.dataset && node.dataset.breId ? node.dataset.breId : generateId();

    switch (tag) {
      case 'P': {
        // Check if this paragraph contains only a formula span
        const formulaSpan = node.querySelector('[data-bre-type="formula"]');
        if (formulaSpan && node.textContent.trim() === formulaSpan.textContent.trim()) {
          const latex = formulaSpan.getAttribute('data-bre-latex') || '';
          blocks.push({ id, type: 'formula', data: { latex } });
        } else {
          blocks.push({ id, type: 'paragraph', data: { html: sanitizeHTML(node.innerHTML) } });
        }
        break;
      }
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6': {
        const level = parseInt(tag[1], 10);
        blocks.push({ id, type: 'heading', data: { level, html: sanitizeHTML(node.innerHTML) } });
        break;
      }
      case 'BLOCKQUOTE': {
        blocks.push({ id, type: 'quote', data: { html: sanitizeHTML(node.innerHTML) } });
        break;
      }
      case 'PRE': {
        const codeEl = node.querySelector('code');
        const code = codeEl ? (codeEl.textContent || '') : (node.textContent || '');
        const language = (node.dataset && node.dataset.breLang) || '';
        blocks.push({ id, type: 'code', data: { code, language } });
        break;
      }
      case 'UL': {
        // Process each li as bulleted_list
        for (const li of node.children) {
          if (li.nodeName !== 'LI') continue;
          const liId = (li.dataset && li.dataset.breId) ? li.dataset.breId : generateId();
          blocks.push({ id: liId, type: 'bulleted_list', data: { html: sanitizeHTML(li.innerHTML) } });
        }
        break;
      }
      case 'OL': {
        // Process each li as numbered_list
        for (const li of node.children) {
          if (li.nodeName !== 'LI') continue;
          const liId = (li.dataset && li.dataset.breId) ? li.dataset.breId : generateId();
          blocks.push({ id: liId, type: 'numbered_list', data: { html: sanitizeHTML(li.innerHTML) } });
        }
        break;
      }
      case 'HR': {
        blocks.push({ id, type: 'divider', data: {} });
        break;
      }
      case 'FIGURE': {
        const type = node.dataset && node.dataset.breType;
        if (type === 'image') {
          blocks.push({ id, type: 'image', data: {
            src: (node.dataset && node.dataset.breSrc) || '',
            alt: (node.dataset && node.dataset.breAlt) || '',
            caption: (node.dataset && node.dataset.breCaption) || '',
          }});
        } else if (type === 'audio') {
          blocks.push({ id, type: 'audio', data: {
            src: (node.dataset && node.dataset.breSrc) || '',
            caption: (node.dataset && node.dataset.breCaption) || '',
          }});
        } else if (type === 'video') {
          blocks.push({ id, type: 'video', data: {
            src: (node.dataset && node.dataset.breSrc) || '',
            caption: (node.dataset && node.dataset.breCaption) || '',
          }});
        }
        break;
      }
      case 'DIV': {
        const breType = node.dataset && node.dataset.breType;
        if (breType === 'table') {
          // Read cell text from the editable table cells
          const rows = [];
          const tableEl = node.querySelector('table');
          if (tableEl) {
            for (const tr of tableEl.querySelectorAll('tr')) {
              const row = [];
              for (const cell of tr.querySelectorAll('th, td')) {
                row.push(cell.textContent || '');
              }
              if (row.length > 0) rows.push(row);
            }
          }
          blocks.push({ id, type: 'table', data: { rows } });
        } else {
          // Chrome wraps new lines in divs — treat as paragraph
          blocks.push({ id, type: 'paragraph', data: { html: sanitizeHTML(node.innerHTML) } });
        }
        break;
      }
      default: {
        // Skip unknown elements silently (span, b, i, etc. at top level are ignored)
        break;
      }
    }
  }

  for (const child of surface.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      // Bare text at surface level — wrap as paragraph
      const text = child.textContent || '';
      if (text.trim()) {
        blocks.push({ id: generateId(), type: 'paragraph', data: { html: escapeHTML(text) } });
      }
      continue;
    }
    processNode(child);
  }

  return blocks;
}

/**
 * Serialize blocks to getHTML() output using the block registry plugins.
 */
function blocksToHTML(blocks) {
  const parts = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === 'bulleted_list') {
      const group = [];
      while (i < blocks.length && blocks[i].type === 'bulleted_list') {
        group.push(blocks[i]);
        i++;
      }
      if (blockRegistry.has('bulleted_list')) {
        const plugin = blockRegistry.get('bulleted_list');
        const items = group.map(b => plugin.toHTML(b)).join('\n');
        parts.push(`<ul>\n${items}\n</ul>`);
      }
      continue;
    }

    if (block.type === 'numbered_list') {
      const group = [];
      while (i < blocks.length && blocks[i].type === 'numbered_list') {
        group.push(blocks[i]);
        i++;
      }
      if (blockRegistry.has('numbered_list')) {
        const plugin = blockRegistry.get('numbered_list');
        const items = group.map(b => plugin.toHTML(b)).join('\n');
        parts.push(`<ol>\n${items}\n</ol>`);
      }
      continue;
    }

    if (blockRegistry.has(block.type)) {
      const plugin = blockRegistry.get(block.type);
      parts.push(plugin.toHTML(block));
    }
    i++;
  }
  return parts.join('\n');
}

// ── BREW editor factory ────────────────────────────────────────────────────────

export function createBrewEditor(container, options = {}) {
  ensureKaTeXStyles();

  const opts = {
    mode: 'BREW',
    onChange: null,
    embedAllowlist: DEFAULT_EMBED_ALLOWLIST,
    ...options,
  };

  // Register video plugin if not already registered (e.g. when BREW used standalone)
  if (!blockRegistry.has('video')) {
    blockRegistry.register('video', createVideoPlugin(opts.embedAllowlist));
  }

  // Internal document state
  let _blocks = [];
  let _docMeta = {
    id: generateId(),
    version: 1,
    created: Date.now(),
    updated: Date.now(),
  };

  // ── DOM structure ──────────────────────────────────────────────────────────

  const root = document.createElement('div');
  root.className = 'bre-editor bre-editor--brew';
  root.setAttribute('data-bre-mode', 'BREW');

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'bre-brew-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Formatting');

  // Block type selector (headings + paragraph only)
  const blockTypeSelect = document.createElement('select');
  blockTypeSelect.className = 'bre-brew-block-type';
  const BLOCK_TYPE_OPTIONS = [
    { value: 'paragraph',  label: 'Paragraph' },
    { value: 'heading-1',  label: 'Heading 1' },
    { value: 'heading-2',  label: 'Heading 2' },
    { value: 'heading-3',  label: 'Heading 3' },
    { value: 'heading-4',  label: 'Heading 4' },
    { value: 'heading-5',  label: 'Heading 5' },
    { value: 'heading-6',  label: 'Heading 6' },
  ];
  for (const opt of BLOCK_TYPE_OPTIONS) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    blockTypeSelect.appendChild(option);
  }
  toolbar.appendChild(blockTypeSelect);

  // Separator
  const sep1 = document.createElement('div');
  sep1.className = 'bre-brew-toolbar-sep';
  toolbar.appendChild(sep1);

  // Inline mark buttons
  const btnBold      = createToolbarBtn('B',   'bold',      'Bold (⌘B)');
  const btnItalic    = createToolbarBtn('I',   'italic',    'Italic (⌘I)');
  const btnUnderline = createToolbarBtn('U',   'underline', 'Underline (⌘U)');
  toolbar.appendChild(btnBold);
  toolbar.appendChild(btnItalic);
  toolbar.appendChild(btnUnderline);

  // Separator
  const sep2 = document.createElement('div');
  sep2.className = 'bre-brew-toolbar-sep';
  toolbar.appendChild(sep2);

  // Block-type toggle buttons (bullet, numbered, quote, code)
  const btnBullet   = createToolbarBtn('•',   'bulleted_list',  'Bulleted List');
  const btnNumbered = createToolbarBtn('1.',  'numbered_list',  'Numbered List');
  const btnQuote    = createToolbarBtn('"',   'quote',          'Quote');
  const btnCode     = createToolbarBtn('</>',  'code',           'Code Block');
  toolbar.appendChild(btnBullet);
  toolbar.appendChild(btnNumbered);
  toolbar.appendChild(btnQuote);
  toolbar.appendChild(btnCode);

  // Separator
  const sep3 = document.createElement('div');
  sep3.className = 'bre-brew-toolbar-sep';
  toolbar.appendChild(sep3);

  // Insert buttons
  const btnDivider = createToolbarBtn('—', 'divider', 'Insert Divider');
  const btnLink    = createToolbarBtn('Link', 'link', 'Insert Link');
  const btnFormula = createToolbarBtn('∑',  'formula', 'Insert Formula');
  toolbar.appendChild(btnDivider);
  toolbar.appendChild(btnLink);
  toolbar.appendChild(btnFormula);

  // Separator
  const sep4 = document.createElement('div');
  sep4.className = 'bre-brew-toolbar-sep';
  toolbar.appendChild(sep4);

  // Media / table insert buttons
  const btnTable = createToolbarBtn('⊞', 'table', 'Insert Table');
  const btnImage = createToolbarBtn('🖼', 'image', 'Insert Image');
  const btnAudio = createToolbarBtn('♪', 'audio', 'Insert Audio');
  const btnVideo = createToolbarBtn('▶', 'video', 'Insert Video');
  toolbar.appendChild(btnTable);
  toolbar.appendChild(btnImage);
  toolbar.appendChild(btnAudio);
  toolbar.appendChild(btnVideo);

  // Surface
  const surface = document.createElement('div');
  surface.className = 'bre-brew-surface';
  surface.setAttribute('contenteditable', 'true');
  surface.setAttribute('spellcheck', 'true');

  root.appendChild(toolbar);
  root.appendChild(surface);
  container.appendChild(root);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function createToolbarBtn(text, cmd, title) {
    const btn = document.createElement('button');
    btn.className = 'bre-brew-btn';
    btn.setAttribute('data-brew-cmd', cmd);
    btn.setAttribute('title', title);
    btn.textContent = text;
    return btn;
  }

  /**
   * Find the block-level element that contains the current selection anchor.
   * Returns the direct child of surface, or null.
   */
  function getAnchorBlockEl() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node = sel.anchorNode;
    if (!node) return null;
    // Walk up to a direct child of surface
    while (node && node.parentNode !== surface) {
      // Also handle list items inside ul/ol
      if (node.parentNode && (node.parentNode.nodeName === 'UL' || node.parentNode.nodeName === 'OL')) {
        // node is an LI whose parent UL/OL is a direct child of surface
        if (node.parentNode.parentNode === surface) {
          return node; // return the LI
        }
      }
      node = node.parentNode;
    }
    return node instanceof Element ? node : null;
  }

  /**
   * Get the BRE block type for the element currently hosting the cursor.
   * Returns e.g. 'paragraph', 'heading-1', 'code', etc.
   */
  function getCurrentBlockType() {
    const el = getAnchorBlockEl();
    if (!el) return 'paragraph';
    const tag = el.nodeName.toUpperCase();
    switch (tag) {
      case 'P': return 'paragraph';
      case 'H1': return 'heading-1';
      case 'H2': return 'heading-2';
      case 'H3': return 'heading-3';
      case 'H4': return 'heading-4';
      case 'H5': return 'heading-5';
      case 'H6': return 'heading-6';
      case 'BLOCKQUOTE': return 'quote';
      case 'PRE': return 'code';
      case 'LI': {
        const parent = el.parentNode;
        if (!parent) return 'paragraph';
        return parent.nodeName === 'UL' ? 'bulleted_list' : 'numbered_list';
      }
      default: return 'paragraph';
    }
  }

  /**
   * Return whether the current block type supports inline marks.
   */
  function currentBlockHasInline() {
    const blockType = getCurrentBlockType();
    // Normalize heading-N to 'heading'
    const baseType = blockType.startsWith('heading') ? 'heading' : blockType;
    const caps = blockRegistry.getCapabilities(baseType);
    return caps.inline;
  }

  /**
   * Update toolbar state (button active states, block type selector, disabled states).
   */
  function updateToolbarState() {
    const currentType = getCurrentBlockType();

    // Block type selector — headings + paragraph
    if (BLOCK_TYPE_OPTIONS.some(o => o.value === currentType)) {
      blockTypeSelect.value = currentType;
    } else {
      blockTypeSelect.value = 'paragraph';
    }

    // Block-type toggle buttons active state
    btnBullet.setAttribute('data-active',   currentType === 'bulleted_list'  ? 'true' : 'false');
    btnNumbered.setAttribute('data-active', currentType === 'numbered_list'  ? 'true' : 'false');
    btnQuote.setAttribute('data-active',    currentType === 'quote'          ? 'true' : 'false');
    btnCode.setAttribute('data-active',     currentType === 'code'           ? 'true' : 'false');

    // Inline mark button active + disabled states
    const hasInline = currentBlockHasInline();
    const markButtons = [btnBold, btnItalic, btnUnderline];
    for (const btn of markButtons) {
      btn.disabled = !hasInline;
      if (hasInline) {
        try {
          const cmd = btn.getAttribute('data-brew-cmd');
          const active = document.queryCommandState(cmd);
          btn.setAttribute('data-active', active ? 'true' : 'false');
        } catch {
          btn.setAttribute('data-active', 'false');
        }
      } else {
        btn.setAttribute('data-active', 'false');
      }
    }
  }

  // ── Block type change ──────────────────────────────────────────────────────

  /** Convert the block currently hosting the cursor to the given type value. */
  function setCurrentBlockType(value) {
    surface.focus();
    const blockEl = getAnchorBlockEl();
    if (!blockEl) return;

    const currentText = blockEl.textContent || '';
    let newEl;

    if (value === 'paragraph') {
      newEl = document.createElement('p');
      newEl.setAttribute('data-bre-type', 'paragraph');
    } else if (value.startsWith('heading-')) {
      const level = parseInt(value.split('-')[1], 10);
      newEl = document.createElement(`h${level}`);
      newEl.setAttribute('data-bre-type', 'heading');
      newEl.setAttribute('data-bre-level', String(level));
    } else if (value === 'quote') {
      newEl = document.createElement('blockquote');
      newEl.setAttribute('data-bre-type', 'quote');
    } else if (value === 'code') {
      newEl = document.createElement('pre');
      newEl.setAttribute('data-bre-type', 'code');
      const codeEl = document.createElement('code');
      codeEl.textContent = currentText;
      newEl.appendChild(codeEl);
    } else if (value === 'bulleted_list') {
      const li = document.createElement('li');
      li.setAttribute('data-bre-type', 'bulleted_list');
      li.textContent = currentText;
      newEl = document.createElement('ul');
      newEl.appendChild(li);
    } else if (value === 'numbered_list') {
      const li = document.createElement('li');
      li.setAttribute('data-bre-type', 'numbered_list');
      li.textContent = currentText;
      newEl = document.createElement('ol');
      newEl.appendChild(li);
    }

    if (!newEl) return;

    // Non-list, non-code blocks get plain text content
    if (!['code', 'bulleted_list', 'numbered_list'].includes(value)) {
      newEl.textContent = currentText;
    }

    // If cursor is inside an LI, replace its parent UL/OL
    let targetEl = blockEl.nodeName === 'LI' ? blockEl.parentNode : blockEl;
    if (targetEl && targetEl.parentNode === surface) {
      surface.replaceChild(newEl, targetEl);
    }

    // Move cursor into the new element
    const sel = window.getSelection();
    const range = document.createRange();
    let focusTarget = newEl;
    if (value === 'bulleted_list' || value === 'numbered_list' || value === 'code') {
      focusTarget = newEl.firstChild;
    }
    if (focusTarget) {
      range.selectNodeContents(focusTarget);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    surface.focus();
    updateToolbarState();
    debouncedSync();
  }

  blockTypeSelect.addEventListener('change', () => {
    setCurrentBlockType(blockTypeSelect.value);
  });

  // Block-type toggle buttons — mousedown+preventDefault preserves surface focus
  for (const [btn, type] of [
    [btnBullet,   'bulleted_list'],
    [btnNumbered, 'numbered_list'],
    [btnQuote,    'quote'],
    [btnCode,     'code'],
  ]) {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      setCurrentBlockType(type);
    });
  }

  // ── Inline mark buttons ────────────────────────────────────────────────────

  function handleMarkMousedown(e) {
    e.preventDefault(); // preserve selection
    const cmd = e.currentTarget.getAttribute('data-brew-cmd');
    if (!cmd) return;
    if (['bold', 'italic', 'underline'].includes(cmd)) {
      if (!currentBlockHasInline()) return;
      document.execCommand(cmd);
      updateToolbarState();
    }
  }

  btnBold.addEventListener('mousedown', handleMarkMousedown);
  btnItalic.addEventListener('mousedown', handleMarkMousedown);
  btnUnderline.addEventListener('mousedown', handleMarkMousedown);

  // ── Insert buttons ─────────────────────────────────────────────────────────

  btnDivider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    surface.focus();
    document.execCommand('insertHTML', false, '<hr data-bre-type="divider"><p><br></p>');
    debouncedSync();
  });

  btnLink.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const sel = window.getSelection();
    const selectedText = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).toString() : '';
    // Save the range now, before focus moves to the dialog
    const savedRange = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).cloneRange() : null;
    showLinkDialog({ text: selectedText, url: '' }, ({ text, url }) => {
      // Restore saved selection before inserting
      surface.focus();
      if (savedRange) {
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(savedRange);
      }
      insertLink(text, url);
      debouncedSync();
    });
  });

  function insertLink(text, url) {
    // Delete selected content first (avoids double-text when selection existed)
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      sel.deleteFromDocument();
    }
    // Insert the label text, then select it and apply createLink
    document.execCommand('insertText', false, text);
    // Re-select the just-inserted text so createLink wraps it
    const sel2 = window.getSelection();
    if (sel2 && sel2.rangeCount > 0) {
      const range = sel2.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const end = range.startOffset;
        const start = Math.max(0, end - text.length);
        const newRange = document.createRange();
        newRange.setStart(node, start);
        newRange.setEnd(node, end);
        sel2.removeAllRanges();
        sel2.addRange(newRange);
      }
    }
    document.execCommand('createLink', false, url);
    // Add target/rel to the newly created anchor
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

  /**
   * Show a small inline link dialog near the toolbar.
   * opts: { text, url, showRemove }
   * onSave(({ text, url }) => void)
   * onRemove(() => void) — optional
   */
  function showLinkDialog(opts, onSave, onRemove) {
    // Remove any existing dialog
    const existing = root.querySelector('.bre-brew-link-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.className = 'bre-brew-link-dialog';

    const textField = document.createElement('input');
    textField.type = 'text';
    textField.placeholder = 'Text';
    textField.value = opts.text || '';
    textField.className = 'bre-brew-link-input';

    const urlField = document.createElement('input');
    urlField.type = 'url';
    urlField.placeholder = 'https://...';
    urlField.value = opts.url || '';
    urlField.className = 'bre-brew-link-input';

    const actions = document.createElement('div');
    actions.className = 'bre-brew-link-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.className = 'bre-brew-link-save';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'bre-brew-link-cancel';

    // Layout: [Remove (edit only)] ··· [Cancel] [Save]
    if (onRemove) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.className = 'bre-brew-link-remove';
      removeBtn.addEventListener('click', () => {
        dialog.remove();
        onRemove();
      });
      actions.appendChild(removeBtn);
    }

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    dialog.appendChild(textField);
    dialog.appendChild(urlField);
    dialog.appendChild(actions);
    root.appendChild(dialog);
    textField.focus();

    function close() { dialog.remove(); }

    saveBtn.addEventListener('click', () => {
      const text = textField.value.trim();
      const url = urlField.value.trim();
      if (!text || !url) return;
      const safe = sanitizeURL(url);
      if (!safe) { urlField.style.outline = '2px solid red'; return; }
      close();
      onSave({ text, url: safe });
    });

    cancelBtn.addEventListener('click', close);

    // Close on Escape
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') saveBtn.click();
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('mousedown', function outsideClick(e) {
        if (!dialog.contains(e.target)) {
          close();
          document.removeEventListener('mousedown', outsideClick);
        }
      });
    }, 0);
  }

  btnFormula.addEventListener('mousedown', (e) => {
    e.preventDefault();
    surface.focus();
    const latex = prompt('Enter LaTeX formula:');
    if (!latex) return;
    insertFormula(latex);
    debouncedSync();
  });

  function insertFormula(latex) {
    const katex = getKaTeX();
    if (!katex) {
      // KaTeX chunk still loading — retry once it's ready (button click, so delay is fine).
      katexReady.then(() => insertFormula(latex));
      return;
    }
    try {
      const rendered = katex.renderToString(latex, { throwOnError: false, output: 'html' });
      const safe = sanitizeHTML(rendered, { allowKaTeX: true });
      const escapedLatex = latex.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      document.execCommand(
        'insertHTML',
        false,
        `<span data-bre-type="formula" data-bre-latex="${escapedLatex}" contenteditable="false">${safe}</span>&nbsp;`
      );
    } catch (err) {
      console.warn('[bre] BREW formula render error:', err);
    }
  }

  // ── Table actions (add/remove rows & cols) ─────────────────────────────────

  function reindexTable(table) {
    table.querySelectorAll('tr').forEach((tr, rowIndex) => {
      tr.querySelectorAll('th, td').forEach((cell, colIndex) => {
        cell.setAttribute('data-bre-table-row', String(rowIndex));
        cell.setAttribute('data-bre-table-col', String(colIndex));
      });
    });
  }

  function handleTableAction(action, wrapper) {
    const table = wrapper.querySelector('table');
    if (!table) return;

    if (action === 'add-row') {
      const firstRow = table.querySelector('tr');
      const colCount = firstRow ? firstRow.querySelectorAll('th, td').length : 2;
      let tbody = table.querySelector('tbody');
      if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
      const tr = document.createElement('tr');
      for (let c = 0; c < colCount; c++) {
        const td = document.createElement('td');
        td.className = 'bre-table-cell';
        td.setAttribute('contenteditable', 'true');
        td.setAttribute('data-bre-placeholder', 'Cell');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
      reindexTable(table);

    } else if (action === 'del-row') {
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const rows = tbody.querySelectorAll('tr');
      if (rows.length > 0) rows[rows.length - 1].remove();

    } else if (action === 'add-col') {
      table.querySelectorAll('tr').forEach((tr, rowIndex) => {
        const isHeader = rowIndex === 0;
        const cell = document.createElement(isHeader ? 'th' : 'td');
        cell.className = 'bre-table-cell';
        cell.setAttribute('contenteditable', 'true');
        cell.setAttribute('data-bre-placeholder', isHeader ? 'Header' : 'Cell');
        tr.appendChild(cell);
      });
      reindexTable(table);

    } else if (action === 'del-col') {
      table.querySelectorAll('tr').forEach(tr => {
        const cells = tr.querySelectorAll('th, td');
        if (cells.length > 1) cells[cells.length - 1].remove();
      });
    }
  }

  // Delegate input events from table cells (contenteditable="true" islands inside
  // contenteditable="false" wrappers don't bubble to the surface's input listener).
  root.addEventListener('input', (e) => {
    if (e.target.closest('[data-bre-type="table"]')) {
      debouncedSync();
    }
  });

  // ── Table insert + edit ────────────────────────────────────────────────────

  btnTable.addEventListener('mousedown', (e) => {
    e.preventDefault();
    insertMediaBlock({ type: 'table' });
  });

  /**
   * Insert a new media/table figure block after the current cursor position.
   */
  function insertMediaBlock(block) {
    const id = generateId();
    const html = blockToSurfaceHTMLSnippet({ ...block, id }, opts.embedAllowlist);
    const safe = sanitizeHTML(html, { allowKaTeX: false, allowMedia: true });
    surface.focus();
    document.execCommand('insertHTML', false, safe + '<p><br></p>');
    debouncedSync();
  }

  /**
   * Show a dialog to edit a media figure (image/audio/video).
   */
  function showMediaDialog(figureEl) {
    const type = figureEl.dataset.breType;

    // Image / Audio / Video: edit src + caption
    showMediaSrcDialog(
      {
        src: figureEl.dataset.breSrc || '',
        alt: type === 'image' ? (figureEl.dataset.breAlt || '') : null,
        caption: figureEl.dataset.breCaption || '',
        type,
      },
      ({ src, alt, caption }) => {
        const safe = sanitizeURL(src);
        figureEl.dataset.breSrc = safe;
        if (type === 'image') figureEl.dataset.breAlt = alt || '';
        figureEl.dataset.breCaption = caption || '';

        // Re-render the inner media element
        const newSnippet = blockToSurfaceHTMLSnippet(
          { id: figureEl.dataset.breId, type, data: { src: safe, alt: alt || '', caption: caption || '' } },
          opts.embedAllowlist
        );
        const tmp = document.createElement('div');
        tmp.innerHTML = sanitizeHTML(newSnippet, { allowKaTeX: false, allowMedia: true });
        const newFig = tmp.firstElementChild;
        if (newFig && figureEl.parentNode) {
          figureEl.parentNode.replaceChild(newFig, figureEl);
        }
        debouncedSync();
      }
    );
  }

  /**
   * Small inline dialog to edit src (+ alt for images) + caption for media blocks.
   */
  function showMediaSrcDialog({ src, alt, caption, type }, onSave) {
    const existing = root.querySelector('.bre-brew-media-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.className = 'bre-brew-link-dialog bre-brew-media-dialog';

    function makeField(placeholder, value) {
      const f = document.createElement('input');
      f.type = 'text';
      f.placeholder = placeholder;
      f.value = value || '';
      f.className = 'bre-brew-link-input';
      dialog.appendChild(f);
      return f;
    }

    const srcField     = makeField(type === 'image' ? 'Image URL' : type === 'audio' ? 'Audio URL' : 'Video URL or YouTube/Vimeo link', src);
    const altField     = type === 'image' ? makeField('Alt text', alt) : null;
    const captionField = makeField('Caption (optional)', caption);

    const actions = document.createElement('div');
    actions.className = 'bre-brew-link-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.className = 'bre-brew-link-save';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'bre-brew-link-cancel';

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    dialog.appendChild(actions);
    root.appendChild(dialog);
    srcField.focus();

    function close() { dialog.remove(); }
    saveBtn.addEventListener('click', () => {
      const newSrc = srcField.value.trim();
      if (!newSrc) { srcField.style.outline = '2px solid red'; return; }
      const safe = sanitizeURL(newSrc);
      if (!safe && !brewGetEmbedUrl(newSrc, opts.embedAllowlist)) {
        srcField.style.outline = '2px solid red';
        return;
      }
      close();
      onSave({ src: newSrc, alt: altField ? altField.value.trim() : '', caption: captionField.value.trim() });
    });
    cancelBtn.addEventListener('click', close);
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') saveBtn.click();
    });
    setTimeout(() => {
      document.addEventListener('mousedown', function outsideClick(e) {
        if (!dialog.contains(e.target)) {
          close();
          document.removeEventListener('mousedown', outsideClick);
        }
      });
    }, 0);
  }

  // Image / Audio / Video toolbar buttons
  btnImage.addEventListener('mousedown', (e) => {
    e.preventDefault();
    showMediaSrcDialog({ src: '', alt: '', caption: '', type: 'image' }, ({ src, alt, caption }) => {
      insertMediaBlock({ type: 'image', data: { src, alt, caption } });
    });
  });

  btnAudio.addEventListener('mousedown', (e) => {
    e.preventDefault();
    showMediaSrcDialog({ src: '', caption: '', type: 'audio' }, ({ src, caption }) => {
      insertMediaBlock({ type: 'audio', data: { src, caption } });
    });
  });

  btnVideo.addEventListener('mousedown', (e) => {
    e.preventDefault();
    showMediaSrcDialog({ src: '', caption: '', type: 'video' }, ({ src, caption }) => {
      insertMediaBlock({ type: 'video', data: { src, caption } });
    });
  });

  // ── Formula click-to-edit ──────────────────────────────────────────────────

  surface.addEventListener('click', (e) => {
    // Click-to-edit links
    const anchorEl = e.target.closest('a');
    if (anchorEl && surface.contains(anchorEl)) {
      e.preventDefault();
      showLinkDialog(
        { text: anchorEl.textContent || '', url: anchorEl.getAttribute('href') || '' },
        ({ text, url }) => {
          anchorEl.textContent = text;
          anchorEl.setAttribute('href', url);
          debouncedSync();
        },
        () => {
          anchorEl.replaceWith(document.createTextNode(anchorEl.textContent || ''));
          debouncedSync();
        }
      );
      return;
    }

    // Table control buttons (+ Row, − Row, + Col, − Col)
    const tableActionBtn = e.target.closest('[data-bre-table-action]');
    if (tableActionBtn && surface.contains(tableActionBtn)) {
      e.preventDefault();
      const action = tableActionBtn.getAttribute('data-bre-table-action');
      const tableWrapper = tableActionBtn.closest('[data-bre-type="table"]');
      if (tableWrapper) {
        handleTableAction(action, tableWrapper);
        debouncedSync();
      }
      return;
    }

    // Click-to-edit media figures (image/audio/video)
    const mediaFigure = e.target.closest('figure[data-bre-type]');
    if (mediaFigure && surface.contains(mediaFigure)) {
      const mtype = mediaFigure.dataset.breType;
      if (['image', 'audio', 'video'].includes(mtype)) {
        e.preventDefault();
        showMediaDialog(mediaFigure);
        return;
      }
    }

    const formulaEl = e.target.closest('[data-bre-type="formula"]');
    if (!formulaEl) return;
    const currentLatex = formulaEl.getAttribute('data-bre-latex') || '';
    const latex = prompt('Edit LaTeX formula:', currentLatex);
    if (latex === null) return; // cancelled
    if (!latex.trim()) {
      formulaEl.remove();
      debouncedSync();
      return;
    }
    const katex = getKaTeX();
    if (!katex) return;
    try {
      const rendered = katex.renderToString(latex, { throwOnError: false, output: 'html' });
      const safe = sanitizeHTML(rendered, { allowKaTeX: true });
      const escapedLatex = latex.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      formulaEl.setAttribute('data-bre-latex', latex);
      formulaEl.innerHTML = safe;
      // Re-sanitize by reassigning escaped attribute
      formulaEl.setAttribute('data-bre-latex', escapedLatex);
    } catch (err) {
      console.warn('[bre] BREW formula edit error:', err);
    }
    debouncedSync();
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  surface.addEventListener('keydown', (e) => {
    const isMod = e.ctrlKey || e.metaKey;

    if (isMod && e.key === 'b') {
      e.preventDefault();
      if (currentBlockHasInline()) document.execCommand('bold');
      updateToolbarState();
      return;
    }
    if (isMod && e.key === 'i') {
      e.preventDefault();
      if (currentBlockHasInline()) document.execCommand('italic');
      updateToolbarState();
      return;
    }
    if (isMod && e.key === 'u') {
      e.preventDefault();
      if (currentBlockHasInline()) document.execCommand('underline');
      updateToolbarState();
      return;
    }

    // Enter in code block: insert literal newline
    if (e.key === 'Enter') {
      const blockEl = getAnchorBlockEl();
      if (blockEl && blockEl.nodeName === 'PRE') {
        e.preventDefault();
        document.execCommand('insertText', false, '\n');
        return;
      }
      // Enter in list items: let browser handle natively
    }
  });

  // ── Paste ──────────────────────────────────────────────────────────────────

  surface.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      document.execCommand('insertText', false, text);
    }
  });

  // ── Selection state ────────────────────────────────────────────────────────

  document.addEventListener('selectionchange', onSelectionChange);
  surface.addEventListener('keyup', updateToolbarState);
  surface.addEventListener('mouseup', updateToolbarState);

  function onSelectionChange() {
    // Only update if selection is within our surface
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const node = sel.anchorNode;
    if (node && surface.contains(node)) {
      updateToolbarState();
    }
  }

  // ── Debounced model sync ────────────────────────────────────────────────────

  const debouncedSync = debounce(() => syncToModel(), 400);

  function syncToModel() {
    _blocks = surfaceToBlocks(surface);
    _docMeta.updated = Date.now();
    if (opts.onChange) {
      opts.onChange(getDoc());
    }
  }

  surface.addEventListener('input', () => {
    debouncedSync();
  });

  // ── Internal document helpers ───────────────────────────────────────────────

  function getDoc() {
    return {
      ..._docMeta,
      blocks: _blocks.map(b => ({ ...b })),
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  function getJSON() {
    // Sync before returning
    _blocks = surfaceToBlocks(surface);
    return getDoc();
  }

  function setJSON(doc) {
    if (!doc || !Array.isArray(doc.blocks)) {
      console.warn('[bre] BREW setJSON: invalid document');
      return;
    }
    _docMeta = {
      id: doc.id || _docMeta.id,
      version: doc.version || 1,
      created: doc.created || Date.now(),
      updated: Date.now(),
    };
    _blocks = doc.blocks.map(b => ({ ...b }));

    const html = blocksToSurfaceHTML(_blocks, opts.embedAllowlist);
    // Use DOMPurify via sanitizeHTML with a permissive profile to allow data-bre-* attributes
    const safe = sanitizeHTML(html, { allowKaTeX: false, allowMedia: true });
    surface.innerHTML = safe;
    updateToolbarState();
  }

  function getHTML() {
    _blocks = surfaceToBlocks(surface);
    const raw = blocksToHTML(_blocks);
    return sanitizeHTML(raw, { allowKaTeX: false, allowMedia: true });
  }

  function setHTML(html) {
    if (typeof html !== 'string') return;
    const blocks = htmlToBlocks(html);
    setJSON({
      id: _docMeta.id,
      version: _docMeta.version,
      created: _docMeta.created,
      updated: Date.now(),
      blocks: blocks.length > 0 ? blocks : [{ id: generateId(), type: 'paragraph', data: { html: '' } }],
    });
  }

  function destroy() {
    document.removeEventListener('selectionchange', onSelectionChange);
    root.remove();
  }

  return { getJSON, setJSON, getHTML, setHTML, destroy };
}
