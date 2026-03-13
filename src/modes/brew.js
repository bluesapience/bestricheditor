/**
 * Best Rich Editor — BREW (WYSIWYG) mode
 * contenteditable surface with formatting toolbar.
 */

import katex from 'katex';
import { generateId } from '../utils/id.js';
import { debounce } from '../utils/debounce.js';
import { escapeHTML } from '../utils/dom.js';
import { sanitizeHTML, sanitizeURL } from '../utils/sanitize.js';
import { blockRegistry } from '../core/blockRegistry.js';

// Ensure all block plugins are registered (same as editor.js)
import '../blocks/paragraph.js';
import '../blocks/heading.js';
import '../blocks/quote.js';
import '../blocks/divider.js';
import '../blocks/code.js';
import '../blocks/bulletedList.js';
import '../blocks/numberedList.js';
import '../ui/columns.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Convert a single block to its surface HTML representation.
 * Returns a string of HTML for that block (without list wrapper).
 */
function blockToSurfaceHTMLSnippet(block) {
  const id = block.id || generateId();
  switch (block.type) {
    case 'paragraph': {
      const text = escapeHTML((block.data && block.data.text) || '');
      return `<p data-bre-type="paragraph" data-bre-id="${id}">${text || '<br>'}</p>`;
    }
    case 'heading': {
      const level = (block.data && block.data.level) || 1;
      const text = escapeHTML((block.data && block.data.text) || '');
      return `<h${level} data-bre-type="heading" data-bre-level="${level}" data-bre-id="${id}">${text || '<br>'}</h${level}>`;
    }
    case 'quote': {
      const text = escapeHTML((block.data && block.data.text) || '');
      return `<blockquote data-bre-type="quote" data-bre-id="${id}">${text || '<br>'}</blockquote>`;
    }
    case 'code': {
      const lang = escapeHTML((block.data && block.data.language) || '');
      const code = escapeHTML((block.data && block.data.code) || '');
      return `<pre data-bre-type="code" data-bre-lang="${lang}" data-bre-id="${id}"><code>${code || '<br>'}</code></pre>`;
    }
    case 'bulleted_list': {
      const text = escapeHTML((block.data && block.data.text) || '');
      return `<li data-bre-type="bulleted_list" data-bre-id="${id}">${text || '<br>'}</li>`;
    }
    case 'numbered_list': {
      const text = escapeHTML((block.data && block.data.text) || '');
      return `<li data-bre-type="numbered_list" data-bre-id="${id}">${text || '<br>'}</li>`;
    }
    case 'divider': {
      return `<hr data-bre-type="divider" data-bre-id="${id}">`;
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
function blocksToSurfaceHTML(blocks) {
  const parts = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === 'bulleted_list') {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'bulleted_list') {
        items.push(blockToSurfaceHTMLSnippet(blocks[i]));
        i++;
      }
      parts.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (block.type === 'numbered_list') {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'numbered_list') {
        items.push(blockToSurfaceHTMLSnippet(blocks[i]));
        i++;
      }
      parts.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    parts.push(blockToSurfaceHTMLSnippet(block));
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
        blocks.push({ id, type: 'paragraph', data: { text: node.textContent || '' } });
        break;
      }
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6': {
        const level = parseInt(tag[1], 10);
        blocks.push({ id, type: 'heading', data: { level, text: node.textContent || '' } });
        break;
      }
      case 'BLOCKQUOTE': {
        blocks.push({ id, type: 'quote', data: { text: node.textContent || '' } });
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
          blocks.push({ id: liId, type: 'bulleted_list', data: { text: li.textContent || '' } });
        }
        break;
      }
      case 'OL': {
        // Process each li as numbered_list
        for (const li of node.children) {
          if (li.nodeName !== 'LI') continue;
          const liId = (li.dataset && li.dataset.breId) ? li.dataset.breId : generateId();
          blocks.push({ id: liId, type: 'numbered_list', data: { text: li.textContent || '' } });
        }
        break;
      }
      case 'HR': {
        blocks.push({ id, type: 'divider', data: {} });
        break;
      }
      case 'DIV': {
        // Chrome wraps new lines in divs — treat as paragraph
        blocks.push({ id, type: 'paragraph', data: { text: node.textContent || '' } });
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
        blocks.push({ id: generateId(), type: 'paragraph', data: { text } });
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
  const opts = {
    mode: 'BREW',
    onChange: null,
    ...options,
  };

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
    surface.focus();
    const url = prompt('Enter URL:');
    if (!url) return;
    const safe = sanitizeURL(url);
    if (!safe) {
      alert('Invalid or unsafe URL.');
      return;
    }
    document.execCommand('createLink', false, safe);
    // Add rel attribute to newly created link
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      // Find the anchor element
      let node = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      const anchor = node.closest ? node.closest('a') : null;
      if (anchor) {
        anchor.setAttribute('rel', 'noopener noreferrer');
        anchor.setAttribute('target', '_blank');
      }
    }
    debouncedSync();
  });

  btnFormula.addEventListener('mousedown', (e) => {
    e.preventDefault();
    surface.focus();
    const latex = prompt('Enter LaTeX formula:');
    if (!latex) return;
    try {
      const rendered = katex.renderToString(latex, {
        throwOnError: false,
        output: 'html',
      });
      const safe = sanitizeHTML(rendered, { allowKaTeX: true });
      document.execCommand('insertHTML', false, safe);
    } catch (err) {
      console.warn('[bre] BREW formula render error:', err);
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

    const html = blocksToSurfaceHTML(_blocks);
    // Use DOMPurify via sanitizeHTML with a permissive profile to allow data-bre-* attributes
    const safe = sanitizeHTML(html, { allowKaTeX: false });
    surface.innerHTML = safe;
    updateToolbarState();
  }

  function getHTML() {
    _blocks = surfaceToBlocks(surface);
    const raw = blocksToHTML(_blocks);
    return sanitizeHTML(raw, { allowKaTeX: false });
  }

  function destroy() {
    document.removeEventListener('selectionchange', onSelectionChange);
    root.remove();
  }

  return { getJSON, setJSON, getHTML, destroy };
}
