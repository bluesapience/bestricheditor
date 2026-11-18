/**
 * Best Rich Editor — BRE (block) mode + mode dispatcher.
 *
 * Performance notes
 *  - State is immutable with structural sharing: typing is O(1) lookup + one
 *    shallow array copy; undo snapshots are references (no JSON cloning).
 *  - Per-keystroke work never sanitizes: raw field html is stored and cleaned
 *    lazily (getJSON / getHTML / before 'change' fires), only for touched blocks.
 *  - Large documents auto-virtualize (options.virtualize = 'auto').
 *  - One shared drag handle; blocks are 2 elements (wrapper + content).
 */

import { createBremEditor } from '../modes/brem.js';
import { createBrewEditor } from '../modes/brew.js';
import { generateId } from '../utils/id.js';
import { debounce } from '../utils/debounce.js';
import {
  closestBlock,
  escapeHTML,
  isCursorAtStart,
  isCursorAtEnd,
  setCursorOffset,
} from '../utils/dom.js';
import { sanitizeHTML, sanitizeURL } from '../utils/sanitize.js';
import { setKaTeXCssUrl, ensureKaTeXStyles, getKaTeX, loadKaTeX } from '../utils/katex-lazy.js';
import { cleanPastedHTML } from '../utils/pasteClean.js';
import { markdownToBlocks } from '../utils/markdown.js';
import { transforms } from './transforms.js';
import { htmlToBlocks } from '../utils/htmlToBlocks.js';
import { EventEmitter } from './events.js';
import { resolveMessages, fmt } from './messages.js';
import { createState } from './state.js';
import { createAdaptiveRenderer, DEFAULT_VIRTUALIZE_THRESHOLD } from './adaptiveRenderer.js';
import { applyReadOnly } from './blockEl.js';
import { blockRegistry } from './blockRegistry.js';
import { migrateDocument, CURRENT_VERSION } from './migrate.js';
import { createSlashMenu } from '../ui/slashMenu.js';
import { initDragHandles } from '../ui/dragHandle.js';
import { createInlineToolbar } from '../ui/inlineToolbar.js';
import { createBlockMenu } from '../ui/blockMenu.js';

// Register all block types (side effects)
import '../blocks/formula.js';
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
import '../blocks/video.js';

const DEFAULT_EMBED_ALLOWLIST = ['youtube.com', 'youtu.be', 'vimeo.com'];
const MEDIA_TYPES = new Set(['image', 'audio', 'video']);

function buildSlashItems(m) {
  const s = m.slash;
  return [
    { type: 'paragraph', label: s.paragraph[0], icon: 'T', description: s.paragraph[1], keywords: ['text', 'paragraph', 'p'], defaultData: { html: '' } },
    { type: 'heading', label: s.h1[0], icon: 'H1', description: s.h1[1], keywords: ['heading', 'h1', 'title'], defaultData: { level: 1, html: '' } },
    { type: 'heading', label: s.h2[0], icon: 'H2', description: s.h2[1], keywords: ['heading', 'h2'], defaultData: { level: 2, html: '' } },
    { type: 'heading', label: s.h3[0], icon: 'H3', description: s.h3[1], keywords: ['heading', 'h3'], defaultData: { level: 3, html: '' } },
    { type: 'bulleted_list', label: s.bulleted_list[0], icon: '•', description: s.bulleted_list[1], keywords: ['ul', 'list', 'bullet'], defaultData: { html: '' } },
    { type: 'numbered_list', label: s.numbered_list[0], icon: '1.', description: s.numbered_list[1], keywords: ['ol', 'list', 'number'], defaultData: { html: '' } },
    { type: 'quote', label: s.quote[0], icon: '"', description: s.quote[1], keywords: ['blockquote', 'callout'], defaultData: { html: '' } },
    { type: 'divider', label: s.divider[0], icon: '—', description: s.divider[1], keywords: ['hr', 'rule', 'line'], defaultData: {} },
    { type: 'code', label: s.code[0], icon: '</>', description: s.code[1], keywords: ['pre', 'snippet'], defaultData: { code: '', language: '' } },
    { type: 'columns', label: s.columns2[0], icon: '⫾', description: s.columns2[1], keywords: ['layout', 'grid'], colCount: 2 },
    { type: 'columns', label: s.columns3[0], icon: '⫶', description: s.columns3[1], keywords: ['layout', 'grid'], colCount: 3 },
    { type: 'columns', label: s.columns4[0], icon: '⊞', description: s.columns4[1], keywords: ['layout', 'grid'], colCount: 4 },
    { type: 'formula', label: s.formula[0], icon: '∑', description: s.formula[1], keywords: ['math', 'latex', 'katex', 'equation'] },
    { type: 'table', label: s.table[0], icon: '⊞', description: s.table[1], keywords: ['grid', 'rows'], defaultData: { rows: [[m.tableHeader + ' 1', m.tableHeader + ' 2'], ['', '']] } },
    { type: 'image', label: s.image[0], icon: 'IMG', description: s.image[1], keywords: ['picture', 'photo', 'upload'] },
    { type: 'audio', label: s.audio[0], icon: '♪', description: s.audio[1], keywords: ['sound', 'music'] },
    { type: 'video', label: s.video[0], icon: '▶', description: s.video[1], keywords: ['youtube', 'vimeo', 'movie'] },
  ];
}

function makeBlock(type, data) {
  return { id: generateId(), type, data };
}

// Paste pipeline (global, registered once). Steps: clean → parse.
let pastePipelineInstalled = false;
function ensurePastePipeline() {
  // Own flag (not transforms.has): a user step registered earlier must not
  // suppress the built-in clean + parse steps.
  if (pastePipelineInstalled) return;
  pastePipelineInstalled = true;
  transforms.register('paste', (payload) => ({ ...payload, html: cleanPastedHTML(payload.html) }), { order: 10 });
  transforms.register('paste', (payload) => ({ ...payload, blocks: htmlToBlocks(payload.html) }), { order: 20 });
}

const MD_HINT = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|---\s*$|\|.+\|)/m;

export function createEditor(container, options = {}) {
  if (!(container instanceof Element)) {
    throw new Error('[bre] createEditor: container must be a DOM Element');
  }

  if (options.katexCssUrl) {
    setKaTeXCssUrl(options.katexCssUrl);
    ensureKaTeXStyles();
  }

  if (options.mode === 'BREM') return createBremEditor(container, options);
  if (options.mode === 'BREW') return createBrewEditor(container, options);

  const opts = {
    mode: 'BRE',
    embedAllowlist: DEFAULT_EMBED_ALLOWLIST,
    virtualize: 'auto',
    virtualizeThreshold: DEFAULT_VIRTUALIZE_THRESHOLD,
    readOnly: false,
    dir: undefined,
    ...options,
  };
  const messages = resolveMessages(opts.messages);
  if (opts.placeholder == null) opts.placeholder = messages.placeholder;

  let readOnly = !!opts.readOnly;
  let destroyed = false;

  // ── Events ─────────────────────────────────────────────────────────────────
  const emitter = new EventEmitter();
  const cbMap = {
    change: opts.onChange,
    ready: opts.onReady,
    focus: opts.onFocus,
    blur: opts.onBlur,
    selectionchange: opts.onSelectionChange,
    error: opts.onError,
  };
  for (const [ev, cb] of Object.entries(cbMap)) if (typeof cb === 'function') emitter.on(ev, cb);

  // ── Mount ──────────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'bre-editor';
  root.setAttribute('data-bre-mode', 'BRE');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', messages.editorLabel);
  if (opts.dir === 'ltr' || opts.dir === 'rtl') root.setAttribute('dir', opts.dir);
  else if (opts.dir === 'auto') root.setAttribute('data-bre-dir', 'auto');
  if (readOnly) root.setAttribute('data-bre-readonly', '');

  const content = document.createElement('div');
  content.className = 'bre-blocks';
  root.appendChild(content);

  const liveRegion = document.createElement('div');
  liveRegion.className = 'bre-sr-only';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  root.appendChild(liveRegion);

  container.appendChild(root);

  function announce(msg) {
    liveRegion.textContent = '';
    // Re-set on next frame so repeated identical messages are re-announced.
    requestAnimationFrame(() => { if (!destroyed) liveRegion.textContent = msg; });
  }

  // ── Subsystems ─────────────────────────────────────────────────────────────
  const state = createState();

  const ctx = {
    messages,
    embedAllowlist: opts.embedAllowlist,
    isReadOnly: () => readOnly,
    // Used by custom blocks: persist their data without re-rendering them.
    updateBlockData(blockId, data) {
      if (readOnly) return;
      scheduleUndoSnapshot();
      updateDataAnywhere(blockId, data);
      notifyChange();
    },
  };

  /** Merge data into a block that may live at top level or inside a column. */
  function updateDataAnywhere(id, data) {
    const { block, context } = state.findBlockAnywhere(id);
    if (!block) return;
    if (context === null) {
      state.updateBlockData(id, data);
    } else {
      const { columnsBlockId, colIndex } = context;
      const col = state.getBlock(columnsBlockId).data.columns[colIndex];
      state.updateColumnBlock(columnsBlockId, colIndex, col.map((b) => (b.id === id ? { ...b, data: { ...b.data, ...data } } : b)));
    }
  }

  const renderer = createAdaptiveRenderer(content, state, ctx, {
    virtualize: opts.virtualize,
    threshold: opts.virtualizeThreshold,
  });

  state.addBlock(makeBlock('paragraph', { html: '' }));
  renderer.renderAll(state.getBlocks());

  const slashMenu = createSlashMenu(onSlashSelect, { messages });
  const blockMenu = createBlockMenu({ messages });
  const drag = initDragHandles(root, content, state, renderer, {
    messages,
    onHandleClick: ({ blockId, anchorRect }) => openBlockMenu(blockId, anchorRect),
    isReadOnly: () => readOnly,
    onMove({ from, to }) {
      announce(fmt(messages.blockMoved, { n: to + 1, total: state.getBlocks().length }));
      notifyChange();
    },
  });
  const inlineToolbar = createInlineToolbar(root, { handleLinkInsert, messages, isReadOnly: () => readOnly });

  ensurePastePipeline();

  // ── Change notification (debounced; sanitizes lazily first) ────────────────
  const unsafe = new Set(); // block ids whose html field was stored raw

  function flushUnsafe() {
    if (unsafe.size === 0) return;
    for (const id of unsafe) {
      const { block, context } = state.findBlockAnywhere(id);
      if (!block || typeof block.data.html !== 'string') continue;
      const clean = sanitizeHTML(block.data.html);
      if (clean === block.data.html) continue;
      if (context === null) {
        state.updateBlockData(id, { html: clean }, { silent: true });
      } else {
        const col = state.getBlock(context.columnsBlockId).data.columns[context.colIndex];
        const next = col.map(b => (b.id === id ? { ...b, data: { ...b.data, html: clean } } : b));
        state.updateColumnBlock(context.columnsBlockId, context.colIndex, next, { silent: true });
      }
    }
    unsafe.clear();
  }

  const fireChange = debounce(() => {
    if (destroyed) return;
    flushUnsafe();
    emitter.emit('change', state.getDoc());
  }, 300);

  function notifyChange() {
    if (emitter.has('change')) fireChange();
  }

  // Undo snapshot: once per typing burst (1.5 s of inactivity resets the guard).
  let snapshotPending = false;
  let snapshotTimer = null;
  function scheduleUndoSnapshot() {
    if (snapshotPending) return;
    snapshotPending = true;
    state.saveUndoSnapshot();
    snapshotTimer = setTimeout(() => { snapshotPending = false; snapshotTimer = null; }, 1500);
  }

  // ── Placeholder (editor-empty) ─────────────────────────────────────────────
  let placeholderEl = null;

  function isEmptyDoc() {
    const blocks = state.getBlocks();
    if (blocks.length === 0) return true;
    if (blocks.length > 1) return false;
    const b = blocks[0];
    if (b.type !== 'paragraph') return false;
    const html = b.data.html != null ? b.data.html : b.data.text || '';
    return html.replace(/<[^>]*>/g, '').trim() === '';
  }

  function updatePlaceholder() {
    const empty = isEmptyDoc();
    const first = state.getBlocks()[0];
    const field = empty && first ? renderer.getBlockEl(first.id)?.querySelector('[data-bre-field]') : null;
    if (placeholderEl && placeholderEl !== field) {
      placeholderEl.removeAttribute('data-bre-ph');
      placeholderEl.setAttribute('data-bre-placeholder', messages.paragraphHint);
      placeholderEl = null;
    }
    if (field && field !== placeholderEl) {
      field.setAttribute('data-bre-ph', '');
      field.setAttribute('data-bre-placeholder', opts.placeholder);
      placeholderEl = field;
    }
  }

  function rerenderAll() {
    renderer.renderAll(state.getBlocks());
    placeholderEl = null;
    drag.refresh();
    updatePlaceholder();
  }
  updatePlaceholder();

  // ── Prompt helper (override with options.prompt) ───────────────────────────
  async function ask(message, def = '') {
    if (typeof opts.prompt === 'function') return opts.prompt(message, def);
    const v = window.prompt(message, def);
    return v;
  }

  function reportInvalidUrl() {
    emitter.emit('error', { type: 'invalid-url', error: new Error(messages.invalidUrl) });
    announce(messages.invalidUrl);
    if (typeof opts.prompt !== 'function') window.alert(messages.invalidUrl);
  }

  // Track the block that triggered the slash menu
  let slashBlockId = null;

  // ── Event delegation ───────────────────────────────────────────────────────
  root.addEventListener('input', handleInput);
  root.addEventListener('keydown', handleKeydown);
  root.addEventListener('paste', handlePaste);
  root.addEventListener('click', handleClick);
  root.addEventListener('dblclick', handleDblClick);
  root.addEventListener('drop', handleDrop);
  root.addEventListener('dragover', handleDragOver);
  root.addEventListener('focusin', handleFocusIn);
  root.addEventListener('focusout', handleFocusOut);
  document.addEventListener('selectionchange', handleSelectionChange);

  // ── Focus / selection events ───────────────────────────────────────────────
  let hasFocus = false;
  function handleFocusIn(e) {
    if (selectedEl && e.target !== selectedEl) clearSelection();
    if (hasFocus) return;
    hasFocus = true;
    emitter.emit('focus', undefined);
  }
  function handleFocusOut(e) {
    if (e.relatedTarget && root.contains(e.relatedTarget)) return;
    if (!hasFocus) return;
    hasFocus = false;
    emitter.emit('blur', undefined);
  }

  let selRaf = 0;
  let lastSelKey = '';
  function handleSelectionChange() {
    if (selRaf || !emitter.has('selectionchange')) return;
    selRaf = requestAnimationFrame(() => {
      selRaf = 0;
      if (destroyed) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return;
      const anchor = sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode;
      const blockEl = anchor && closestBlock(anchor);
      const blockId = blockEl ? blockEl.getAttribute('data-bre-block-id') : null;
      const key = blockId + ':' + sel.isCollapsed + ':' + sel.anchorOffset + ':' + sel.focusOffset;
      if (key === lastSelKey) return;
      lastSelKey = key;
      emitter.emit('selectionchange', { blockId, collapsed: sel.isCollapsed });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getFieldInfo(target) {
    const fieldEl = target.closest ? target.closest('[data-bre-field]') : null;
    if (!fieldEl) return null;
    const blockEl = closestBlock(fieldEl);
    if (!blockEl) return null;
    return {
      fieldEl,
      blockEl,
      blockId: blockEl.getAttribute('data-bre-block-id'),
      fieldName: fieldEl.getAttribute('data-bre-field'),
    };
  }

  /** Replace a block (top-level or column child) and re-render it. */
  function replaceAnywhere(blockId, newBlock) {
    const { block, context } = state.findBlockAnywhere(blockId);
    if (!block) return false;
    if (context === null) {
      state.replaceBlock(blockId, newBlock);
      renderer.updateBlock(newBlock);
    } else {
      const { columnsBlockId, colIndex, indexInCol } = context;
      const col = state.getBlock(columnsBlockId).data.columns[colIndex].slice();
      col[indexInCol] = newBlock;
      state.updateColumnBlock(columnsBlockId, colIndex, col);
      renderer.updateBlock(state.getBlock(columnsBlockId));
    }
    return true;
  }

  // ── Click handler ──────────────────────────────────────────────────────────
  async function handleClick(e) {
    if (readOnly) return;

    // Clicking anywhere outside the selected block clears the selection.
    if (selectedEl && !selectedEl.contains(e.target)) clearSelection();

    // Table toolbar actions
    const tableActionEl = e.target.closest('[data-bre-table-action]');
    if (tableActionEl) {
      handleTableAction(tableActionEl);
      return;
    }

    const formulaEl = e.target.closest('.bre-formula');
    if (formulaEl) {
      const blockEl = closestBlock(formulaEl);
      const block = blockEl && state.findBlockAnywhere(blockEl.getAttribute('data-bre-block-id')).block;
      if (!block || block.type !== 'formula') return;
      const latex = await ask(messages.promptEditFormula, block.data.latex || '');
      if (latex === null || latex === undefined) return;
      state.saveUndoSnapshot();
      replaceAnywhere(block.id, { ...block, data: { latex, displayMode: block.data.displayMode ?? true } });
      notifyChange();
      return;
    }

    const mediaEl = e.target.closest(
      '.bre-image, .bre-image-placeholder, .bre-audio, .bre-audio-placeholder, ' +
      '.bre-video, .bre-video-embed, .bre-video-placeholder'
    );
    if (mediaEl) {
      const blockEl = closestBlock(mediaEl);
      const block = blockEl && state.findBlockAnywhere(blockEl.getAttribute('data-bre-block-id')).block;
      if (!block || !MEDIA_TYPES.has(block.type)) return;
      // An empty placeholder IS the "set source" affordance; a loaded media
      // block is selected (Notion-style) so Backspace/Delete can remove it.
      if (/placeholder/.test(mediaEl.className)) await setMediaSource(block);
      else selectBlock(block.id);
      return;
    }

    // Divider: nothing to focus, so clicking selects it.
    const hrEl = e.target.closest('.bre-divider');
    if (hrEl) {
      const blockEl = closestBlock(hrEl);
      if (blockEl) selectBlock(blockEl.getAttribute('data-bre-block-id'));
    }
  }

  // Double-click a loaded media block to replace its source.
  async function handleDblClick(e) {
    if (readOnly) return;
    const mediaEl = e.target.closest('.bre-image, .bre-audio, .bre-video, .bre-video-embed');
    if (!mediaEl) return;
    const blockEl = closestBlock(mediaEl);
    const block = blockEl && state.findBlockAnywhere(blockEl.getAttribute('data-bre-block-id')).block;
    if (block && MEDIA_TYPES.has(block.type)) await setMediaSource(block);
  }

  // ── Block selection (images, audio, video, dividers) ───────────────────────
  let selectedEl = null;

  function selectBlock(id) {
    const el = renderer.getBlockEl(id);
    if (!el) return;
    if (selectedEl && selectedEl !== el) clearSelection();
    selectedEl = el;
    el.setAttribute('data-bre-selected', '');
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    announce(messages.blockSelected);
  }

  function clearSelection() {
    if (!selectedEl) return;
    selectedEl.removeAttribute('data-bre-selected');
    selectedEl.removeAttribute('tabindex');
    selectedEl = null;
  }

  /** Focus a block's text field if it has one, otherwise select the block. */
  function focusOrSelect(id, atEnd) {
    const el = renderer.getBlockEl(id);
    if (!el) return;
    if (el.querySelector('[data-bre-field]')) {
      if (atEnd) focusBlockEnd(id); else focusBlock(id, 0);
    } else {
      selectBlock(id);
    }
  }

  // ── Block actions menu (handle click / Alt+Shift+M) ────────────────────────
  function openBlockMenu(blockId, anchorRect) {
    if (readOnly) return;
    const { block } = state.findBlockAnywhere(blockId);
    if (!block) return;
    const items = [];
    if (MEDIA_TYPES.has(block.type)) items.push({ id: 'replace', label: messages.menuReplace });
    items.push({ id: 'duplicate', label: messages.menuDuplicate }, { id: 'delete', label: messages.menuDelete });
    blockMenu.show(anchorRect, items, (action) => {
      if (action === 'delete') deleteBlock(blockId);
      else if (action === 'duplicate') duplicateBlock(blockId);
      else if (action === 'replace') setMediaSource(block);
    }, () => focusOrSelect(blockId));
  }

  /** Keyboard-opened menu: just under the top-left of the block. */
  function blockAnchor(el) {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.top + 28, left: r.left, right: r.left };
  }

  function cloneWithNewIds(block) {
    const copy = JSON.parse(JSON.stringify(block));
    const reid = (b) => {
      b.id = generateId();
      if (b.data && Array.isArray(b.data.columns)) for (const col of b.data.columns) for (const sub of col) reid(sub);
    };
    reid(copy);
    return copy;
  }

  function duplicateBlock(blockId) {
    const { block, context } = state.findBlockAnywhere(blockId);
    if (!block) return;
    state.saveUndoSnapshot();
    const copy = cloneWithNewIds(block);
    if (context === null) {
      state.addBlock(copy, blockId);
      renderer.insertBlock(copy, blockId);
    } else {
      const { columnsBlockId, colIndex, indexInCol } = context;
      const col = state.getBlock(columnsBlockId).data.columns[colIndex].slice();
      col.splice(indexInCol + 1, 0, copy);
      state.updateColumnBlock(columnsBlockId, colIndex, col);
      renderer.updateBlock(state.getBlock(columnsBlockId));
    }
    updatePlaceholder();
    focusOrSelect(copy.id);
    announce(messages.blockDuplicated);
    notifyChange();
  }

  async function setMediaSource(block) {
    // Image + upload hook → file picker.
    if (block.type === 'image' && typeof opts.uploadImage === 'function') {
      const files = await pickFiles('image/*');
      if (files.length) await uploadImages(files, block.id, true);
      return;
    }
    const msg = block.type === 'image' ? messages.promptImageUrl
      : block.type === 'audio' ? messages.promptAudioUrl
      : messages.promptVideoUrl;
    const url = await ask(msg, block.data.src || '');
    if (url === null || url === undefined) return;
    const safe = url ? sanitizeURL(url) : '';
    if (url && !safe) { reportInvalidUrl(); return; }
    state.saveUndoSnapshot();
    replaceAnywhere(block.id, { ...block, data: { ...block.data, src: safe } });
    notifyChange();
  }

  function handleTableAction(actionEl) {
    const action = actionEl.getAttribute('data-bre-table-action');
    const blockEl = closestBlock(actionEl);
    if (!blockEl) return;
    const blockId = blockEl.getAttribute('data-bre-block-id');
    const block = state.getBlock(blockId);
    if (!block || block.type !== 'table') return;
    state.saveUndoSnapshot();

    let rows = block.data.rows.map(r => r.slice());
    switch (action) {
      case 'add-row': rows.push(new Array(rows[0].length).fill('')); break;
      case 'del-row': if (rows.length > 1) rows = rows.slice(0, -1); break;
      case 'add-col': rows = rows.map(r => [...r, '']); break;
      case 'del-col': if (rows[0].length > 1) rows = rows.map(r => r.slice(0, -1)); break;
      case 'del-block': deleteBlock(blockId); return;
      default: return;
    }
    state.updateBlockData(blockId, { rows });
    renderer.updateBlock(state.getBlock(blockId));
    notifyChange();
  }

  // ── Delete a whole block (top-level or column child) ───────────────────────
  function deleteBlock(blockId) {
    const { block, context } = state.findBlockAnywhere(blockId);
    if (!block) return;
    clearSelection();
    state.saveUndoSnapshot();
    let focusId = null;
    if (context === null) {
      const idx = state.getBlockIndex(blockId);
      const blocks = state.getBlocks();
      const neighbor = blocks[idx + 1] || blocks[idx - 1] || null;
      state.removeBlock(blockId);
      renderer.removeBlock(blockId);
      if (state.getBlocks().length === 0) {
        const p = makeBlock('paragraph', { html: '' });
        state.addBlock(p);
        renderer.insertBlock(p, null);
        focusId = p.id;
      } else {
        focusId = neighbor && neighbor.id;
      }
    } else {
      const { columnsBlockId, colIndex, indexInCol } = context;
      const col = state.getBlock(columnsBlockId).data.columns[colIndex].slice();
      col.splice(indexInCol, 1);
      if (col.length === 0) col.push(makeBlock('paragraph', { html: '' })); // columns are never empty
      state.updateColumnBlock(columnsBlockId, colIndex, col);
      renderer.updateBlock(state.getBlock(columnsBlockId));
      focusId = col[Math.min(indexInCol, col.length - 1)].id;
    }
    updatePlaceholder();
    if (focusId) focusOrSelect(focusId);
    announce(messages.blockDeleted);
    notifyChange();
  }

  // ── Input handler ──────────────────────────────────────────────────────────
  function handleInput(e) {
    if (readOnly) return;
    const target = e.target;

    // Table cell input
    const cellEl = target.closest('[data-bre-table-row]');
    if (cellEl) {
      scheduleUndoSnapshot();
      handleTableCellInput(cellEl);
      notifyChange();
      return;
    }

    const info = getFieldInfo(target);
    if (!info) {
      // Custom block with free-form editable DOM: serialize() syncs its data.
      const blockEl = closestBlock(target);
      if (!blockEl) return;
      const id = blockEl.getAttribute('data-bre-block-id');
      const block = state.findBlockAnywhere(id).block;
      const def = block && blockRegistry.has(block.type) && blockRegistry.get(block.type).def;
      if (def && typeof def.serialize === 'function') {
        scheduleUndoSnapshot();
        const data = def.serialize(blockEl.firstElementChild);
        if (data) updateDataAnywhere(id, data);
        notifyChange();
      }
      return;
    }

    const { fieldEl, blockId, fieldName } = info;
    scheduleUndoSnapshot();

    // Empty contenteditable leaves a stray <br>
    if (fieldEl.firstChild && fieldEl.textContent === '') fieldEl.textContent = '';

    const textContent = fieldEl.textContent;
    const isHtmlField = fieldName === 'html';
    // Store raw field html (O(block size), no sanitizing on the keystroke path);
    // blocks containing markup are cleaned lazily by flushUnsafe().
    let fieldValue = textContent;
    if (isHtmlField) {
      fieldValue = fieldEl.innerHTML;
      if (fieldValue.indexOf('<') !== -1) unsafe.add(blockId);
    }

    const { block, context } = state.findBlockAnywhere(blockId);
    if (!block) return;

    if (context === null) {
      state.updateBlockData(blockId, { [fieldName]: fieldValue });
    } else {
      const { columnsBlockId, colIndex } = context;
      const col = state.getBlock(columnsBlockId).data.columns[colIndex];
      const next = col.map(b => (b.id === blockId ? { ...b, data: { ...b.data, [fieldName]: fieldValue } } : b));
      state.updateColumnBlock(columnsBlockId, colIndex, next);
    }

    if (placeholderEl || isEmptyDoc()) updatePlaceholder();

    // Slash menu
    if (fieldName === 'html' || fieldName === 'text') {
      if (textContent === '/') {
        slashBlockId = blockId;
        slashMenu.show(fieldEl.getBoundingClientRect(), getSlashItems(), fieldEl);
      } else if (textContent.startsWith('/') && slashBlockId === blockId && slashMenu.isVisible()) {
        slashMenu.filter(textContent.slice(1));
      } else if (slashMenu.isVisible()) {
        slashMenu.hide();
        slashBlockId = null;
      }
    } else if (slashMenu.isVisible()) {
      slashMenu.hide();
    }

    notifyChange();
  }

  function getSlashItems() {
    const items = buildSlashItems(messages);
    for (const plugin of blockRegistry.customs()) {
      const def = plugin.def;
      const sm = def.slashMenu;
      if (!sm) continue;
      items.push({
        type: def.type,
        custom: true,
        label: sm.label || def.type,
        icon: sm.icon || '□',
        description: sm.description || '',
        keywords: sm.keywords || [],
        defaultData: def.defaultData || {},
      });
    }
    return items;
  }

  function handleTableCellInput(cellEl) {
    const row = parseInt(cellEl.getAttribute('data-bre-table-row'), 10);
    const col = parseInt(cellEl.getAttribute('data-bre-table-col'), 10);
    if (cellEl.firstChild && cellEl.textContent === '') cellEl.textContent = '';
    const text = cellEl.textContent;

    const blockEl = closestBlock(cellEl);
    if (!blockEl) return;
    const blockId = blockEl.getAttribute('data-bre-block-id');
    const block = state.getBlock(blockId);
    if (!block || block.type !== 'table') return;

    // Copy only the touched row.
    const rows = block.data.rows.slice();
    const r = rows[row].slice();
    r[col] = text;
    rows[row] = r;
    state.updateBlockData(blockId, { rows });
  }

  // ── Keydown ────────────────────────────────────────────────────────────────
  function handleKeydown(e) {
    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      if (readOnly) return;
      const isRedo = e.key === 'y' || e.shiftKey;
      e.preventDefault();
      const before = state.getBlocks();
      if (isRedo ? state.redo() : state.undo()) {
        diffRender(before, state.getBlocks());
        notifyChange();
      }
      return;
    }

    if (readOnly) return;

    // A selected (non-text) block owns the keyboard until focus moves.
    if (selectedEl && e.target === selectedEl) {
      const id = selectedEl.getAttribute('data-bre-block-id');
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteBlock(id); return; }
      if (e.key === 'Escape') { e.preventDefault(); clearSelection(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const field = selectedEl.querySelector('[data-bre-field]');
        if (field) field.focus();
        else openBlockMenu(id, blockAnchor(selectedEl));
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = state.getBlockIndex(id);
        const n = state.getBlocks()[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (n) focusOrSelect(n.id, e.key === 'ArrowUp');
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !(e.altKey && e.shiftKey)) return; // ignore stray typing
    }

    // Alt+Shift+M: open the block actions menu for the current block.
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'm') {
      const be = closestBlock(e.target);
      if (be) {
        e.preventDefault();
        openBlockMenu(be.getAttribute('data-bre-block-id'), blockAnchor(be));
        return;
      }
    }

    // Ctrl/Cmd+Shift+Backspace: delete the whole block the caret is in.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Backspace') {
      const be = closestBlock(e.target);
      if (be) {
        e.preventDefault();
        deleteBlock(be.getAttribute('data-bre-block-id'));
        return;
      }
    }

    // Slash menu navigation
    if (slashMenu.isVisible() && !slashMenu.hasResults() && (e.key === 'Enter' || e.key === 'Tab')) {
      // Nothing to pick: close the menu and let Enter behave normally.
      slashMenu.hide();
      slashBlockId = null;
    }
    if (slashMenu.isVisible()) {
      if (e.key === 'ArrowDown') { e.preventDefault(); slashMenu.next(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); slashMenu.prev(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); slashMenu.confirm(); return; }
      if (e.key === 'Escape') { e.preventDefault(); slashMenu.hide(); slashBlockId = null; return; }
    }

    // Table cell keyboard handling
    const tableCellEl = e.target.closest('[data-bre-table-row]');
    if (tableCellEl) {
      if (e.key === 'Tab') { e.preventDefault(); handleTableTab(tableCellEl, e.shiftKey); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); }
      // Cells store plain text: block native bold/italic/underline so DOM and model stay in sync.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ['b', 'i', 'u'].includes(e.key.toLowerCase())) e.preventDefault();
      return;
    }

    // Inline formatting shortcuts — gated on block capability
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      const fmtKey = e.key === '/' ? 'code' : k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'u' ? 'underline' : null;
      if (fmtKey) {
        const fmtInfo = getFieldInfo(e.target);
        if (fmtInfo) {
          const { block: fmtBlock } = state.findBlockAnywhere(fmtInfo.blockId);
          const caps = fmtBlock && blockRegistry.getCapabilities(fmtBlock.type);
          if (caps && caps.marks && caps.marks.includes(fmtKey)) {
            e.preventDefault();
            inlineToolbar.handleMark(fmtKey);
            return;
          }
          // Mark not supported here (heading underline, code field…): swallow the
          // browser's native formatting so the DOM can't diverge from the model.
          if (fmtKey !== 'code') { e.preventDefault(); return; }
        }
      }
      if (k === 'k') {
        e.preventDefault();
        const info = getFieldInfo(e.target);
        if (info) handleLinkInsert(info.fieldEl);
        return;
      }
    }

    const info = getFieldInfo(e.target);
    if (!info) return;
    const { fieldEl, blockId } = info;
    const { block, context } = state.findBlockAnywhere(blockId);
    if (!block) return;

    if (e.isComposing || e.keyCode === 229) return; // IME in progress

    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      state.saveUndoSnapshot();
      handleEnter(block, fieldEl, context);
      return;
    }

    if (e.key === 'Backspace') {
      // Captions / formula fields: let the browser handle Backspace natively.
      const fname = fieldEl.getAttribute('data-bre-field');
      if (fname !== 'html' && fname !== 'code') return;
      if (isCursorAtStart(fieldEl) && window.getSelection().isCollapsed) {
        e.preventDefault();
        state.saveUndoSnapshot();
        handleBackspace(block, fieldEl, context);
      }
      return;
    }

    if (e.key === 'ArrowUp' && !e.altKey && !e.shiftKey) {
      if (isCursorAtStart(fieldEl)) { e.preventDefault(); navigatePrev(block, context); }
      return;
    }

    if (e.key === 'ArrowDown' && !e.altKey && !e.shiftKey) {
      if (isCursorAtEnd(fieldEl)) { e.preventDefault(); navigateNext(block, context); }
    }
  }

  // ── Enter ──────────────────────────────────────────────────────────────────
  function handleEnter(block, fieldEl, context) {
    // Non-inline fields (code, captions): Enter inserts a newline in code.
    const fieldName = fieldEl.getAttribute('data-bre-field');
    if (fieldName === 'code') {
      document.execCommand('insertText', false, '\n');
      return;
    }
    if (fieldName !== 'html') {
      // captions etc.: Enter just confirms
      fieldEl.blur();
      return;
    }

    // Empty list item + Enter exits the list.
    const isList = block.type === 'bulleted_list' || block.type === 'numbered_list';
    if (isList && fieldEl.textContent === '') {
      replaceAnywhere(block.id, { ...block, type: 'paragraph', data: { html: '' } });
      focusBlock(block.id, 0);
      notifyChange();
      return;
    }
    const newType = isList ? block.type : 'paragraph';

    const sel = window.getSelection();
    let beforeHTML = '';
    let afterHTML = '';

    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (!range.collapsed) range.deleteContents(); // Enter replaces the selection
      range.collapse(true);
      const afterRange = document.createRange();
      afterRange.selectNodeContents(fieldEl);
      afterRange.setStart(range.startContainer, range.startOffset);
      const afterFrag = afterRange.extractContents();
      beforeHTML = sanitizeHTML(fieldEl.innerHTML);
      const tmp = document.createElement('div');
      tmp.appendChild(afterFrag);
      afterHTML = sanitizeHTML(tmp.innerHTML);
    } else {
      beforeHTML = sanitizeHTML(fieldEl.innerHTML);
    }
    // extractContents already shortened the live field.
    if (fieldEl.firstChild && fieldEl.textContent === '') fieldEl.textContent = '';

    if (context !== null) {
      const { columnsBlockId, colIndex, indexInCol } = context;
      const columnsBlock = state.getBlock(columnsBlockId);
      if (!columnsBlock) return;
      const newPara = makeBlock(newType, { html: afterHTML });
      const col = columnsBlock.data.columns[colIndex].slice();
      col[indexInCol] = { ...block, data: { ...block.data, html: beforeHTML } };
      col.splice(indexInCol + 1, 0, newPara);
      state.updateColumnBlock(columnsBlockId, colIndex, col);
      renderer.updateBlock(state.getBlock(columnsBlockId));
      focusBlock(newPara.id, 0);
    } else {
      state.updateBlockData(block.id, { html: beforeHTML });
      const newPara = makeBlock(newType, { html: afterHTML });
      state.addBlock(newPara, block.id);
      renderer.insertBlock(newPara, block.id);
      updatePlaceholder();
      focusBlock(newPara.id, 0);
    }
    notifyChange();
  }

  // ── Backspace ──────────────────────────────────────────────────────────────
  function inlineHTMLOf(b) {
    return b.data.html ?? escapeHTML(b.data.text ?? '');
  }
  function hasInline(b) {
    return b && b.data && (typeof b.data.html === 'string' || typeof b.data.text === 'string');
  }
  function textLen(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = sanitizeHTML(html);
    return tmp.textContent.length;
  }

  function handleBackspace(block, fieldEl, context) {
    const text = fieldEl.textContent;

    if (context !== null) {
      const { columnsBlockId, colIndex, indexInCol } = context;
      if (indexInCol === 0) return; // never merge across columns

      const columnsBlock = state.getBlock(columnsBlockId);
      if (!columnsBlock) return;
      const colBlocks = columnsBlock.data.columns[colIndex];
      const prevBlock = colBlocks[indexInCol - 1];

      if (block.type !== 'paragraph' && text.length > 0 && hasInline(block)) {
        const updated = { ...block, type: 'paragraph', data: { html: inlineHTMLOf(block) } };
        state.updateColumnBlock(columnsBlockId, colIndex, colBlocks.map((b, i) => (i === indexInCol ? updated : b)));
        renderer.updateBlock(state.getBlock(columnsBlockId));
        focusBlock(updated.id, 0);
        notifyChange();
        return;
      }

      if (hasInline(prevBlock) && hasInline(block)) {
        const prevHTML = inlineHTMLOf(prevBlock);
        const merged = { ...prevBlock, data: { ...prevBlock.data, html: prevHTML + inlineHTMLOf(block) } };
      markUnsafeIfMarkup(merged);
        const next = colBlocks.map((b, i) => (i === indexInCol - 1 ? merged : b)).filter((_, i) => i !== indexInCol);
        state.updateColumnBlock(columnsBlockId, colIndex, next);
        renderer.updateBlock(state.getBlock(columnsBlockId));
        focusBlock(merged.id, textLen(prevHTML));
      } else {
        state.updateColumnBlock(columnsBlockId, colIndex, colBlocks.filter((_, i) => i !== indexInCol));
        renderer.updateBlock(state.getBlock(columnsBlockId));
        focusBlock(prevBlock.id, 0);
      }
      notifyChange();
      return;
    }

    const blockIndex = state.getBlockIndex(block.id);

    if (blockIndex === 0) {
      if (block.type === 'paragraph') return;
      if (hasInline(block)) {
        const nb = { ...block, type: 'paragraph', data: { html: inlineHTMLOf(block) } };
        state.replaceBlock(block.id, nb);
        renderer.updateBlock(nb);
        focusBlock(nb.id, 0);
        notifyChange();
      }
      return;
    }

    // Non-paragraph with text: convert to paragraph first
    if (block.type !== 'paragraph' && text.length > 0 && hasInline(block)) {
      const nb = { ...block, type: 'paragraph', data: { html: inlineHTMLOf(block) } };
      state.replaceBlock(block.id, nb);
      renderer.updateBlock(nb);
      focusBlock(nb.id, 0);
      notifyChange();
      return;
    }

    const prevBlock = state.getBlocks()[blockIndex - 1];

    // A divider has nothing to focus: Backspace at the start of the next block removes it.
    if (prevBlock.type === 'divider') {
      state.removeBlock(prevBlock.id);
      renderer.removeBlock(prevBlock.id);
      focusBlock(block.id, 0);
      updatePlaceholder();
      notifyChange();
      return;
    }

    if (hasInline(prevBlock) && hasInline(block)) {
      const prevHTML = inlineHTMLOf(prevBlock);
      const merged = { ...prevBlock, data: { ...prevBlock.data, html: prevHTML + inlineHTMLOf(block) } };
      markUnsafeIfMarkup(merged);
      state.replaceBlock(prevBlock.id, merged);
      state.removeBlock(block.id);
      renderer.removeBlock(block.id);
      renderer.updateBlock(merged);
      focusBlock(prevBlock.id, textLen(prevHTML));
    } else {
      // Previous block can't absorb text (divider, columns, media…): drop the
      // current block only if it's empty, otherwise just move focus.
      if (text.length === 0) {
        state.removeBlock(block.id);
        renderer.removeBlock(block.id);
      }
      focusBlockEnd(prevBlock.id);
    }
    updatePlaceholder();
    notifyChange();
  }

  // ── Arrow navigation ───────────────────────────────────────────────────────
  function navigatePrev(block, context) {
    if (context !== null) {
      const { columnsBlockId, colIndex, indexInCol } = context;
      if (indexInCol > 0) {
        focusBlockEnd(state.getBlock(columnsBlockId).data.columns[colIndex][indexInCol - 1].id);
      }
      return;
    }
    const i = state.getBlockIndex(block.id);
    if (i <= 0) return;
    focusBlockEnd(state.getBlocks()[i - 1].id);
  }

  function navigateNext(block, context) {
    if (context !== null) {
      const { columnsBlockId, colIndex, indexInCol } = context;
      const col = state.getBlock(columnsBlockId).data.columns[colIndex];
      if (indexInCol < col.length - 1) focusBlock(col[indexInCol + 1].id, 0);
      return;
    }
    const i = state.getBlockIndex(block.id);
    const blocks = state.getBlocks();
    if (i >= blocks.length - 1) return;
    focusBlock(blocks[i + 1].id, 0);
  }

  // ── Table tab navigation ───────────────────────────────────────────────────
  function handleTableTab(cellEl, shiftKey) {
    const row = parseInt(cellEl.getAttribute('data-bre-table-row'), 10);
    const col = parseInt(cellEl.getAttribute('data-bre-table-col'), 10);
    const blockEl = closestBlock(cellEl);
    if (!blockEl) return;
    const blockId = blockEl.getAttribute('data-bre-block-id');
    const block = state.getBlock(blockId);
    if (!block || block.type !== 'table') return;

    const rows = block.data.rows;
    const numRows = rows.length;
    const numCols = rows[0] ? rows[0].length : 0;
    let nextRow = row;
    let nextCol = col;

    if (!shiftKey) {
      nextCol++;
      if (nextCol >= numCols) { nextCol = 0; nextRow++; }
      if (nextRow >= numRows) {
        state.updateBlockData(blockId, { rows: [...rows, new Array(numCols).fill('')] });
        renderer.updateBlock(state.getBlock(blockId));
        nextRow = numRows;
      }
    } else {
      nextCol--;
      if (nextCol < 0) { nextCol = numCols - 1; nextRow--; }
      if (nextRow < 0) return;
    }

    const el = renderer.getBlockEl(blockId) || blockEl;
    const target = el.querySelector(`[data-bre-table-row="${nextRow}"][data-bre-table-col="${nextCol}"]`);
    if (target) {
      target.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(target);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // ── Link insert (Cmd+K) ────────────────────────────────────────────────────
  async function handleLinkInsert(fieldEl) {
    // Prompting steals the selection: remember it.
    const sel = window.getSelection();
    const saved = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const url = await ask(messages.promptUrl);
    if (!url) return;
    const safe = sanitizeURL(url);
    if (!safe) { reportInvalidUrl(); return; }
    fieldEl.focus();
    if (saved) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(saved);
    }
    document.execCommand('createLink', false, safe);
    const s2 = window.getSelection();
    if (s2 && s2.rangeCount > 0) {
      let node = s2.getRangeAt(0).commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      const a = node.closest && node.closest('a');
      if (a) {
        a.setAttribute('rel', 'noopener noreferrer');
        a.setAttribute('target', '_blank');
      }
    }
  }

  // ── Paste ──────────────────────────────────────────────────────────────────
  function insertPlainLines(text, info) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const { block, context } = state.findBlockAnywhere(info.blockId);
    if (lines.length === 1 || !block || context !== null) {
      document.execCommand('insertText', false, lines.join(' '));
      return;
    }
    document.execCommand('insertText', false, lines[0]);
    const rest = lines.slice(1).filter(l => l.trim() !== '');
    if (rest.length === 0) return;
    const newBlocks = rest.map(l => makeBlock('paragraph', { html: escapeHTML(l) }));
    insertBlocksAfter(newBlocks, block.id, false);
  }

  function insertBlocksAfter(newBlocks, afterId, removeIfEmpty) {
    let after = afterId;
    state.insertBlocks(newBlocks, afterId);
    for (const pb of newBlocks) {
      renderer.insertBlock(pb, after);
      after = pb.id;
    }
    if (removeIfEmpty) {
      const cur = state.getBlock(afterId);
      if (cur && hasInline(cur) && !cur.data.html?.replace(/<[^>]*>/g, '').trim() && !cur.data.text?.trim()) {
        state.removeBlock(afterId);
        renderer.removeBlock(afterId);
      }
    }
    updatePlaceholder();
    focusBlock(newBlocks[0].id, 0);
    notifyChange();
  }

  function handlePaste(e) {
    if (readOnly) return;
    const info = getFieldInfo(e.target);
    if (!info) {
      // Table cells etc: paste as plain text only.
      if (e.target.closest && e.target.closest('[data-bre-table-row]')) {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' '));
      }
      return;
    }
    e.preventDefault();

    const cd = e.clipboardData;

    // Image files from the clipboard → upload hook.
    if (typeof opts.uploadImage === 'function' && cd.files && cd.files.length) {
      const imgs = Array.from(cd.files).filter(f => f.type.startsWith('image/'));
      if (imgs.length) {
        uploadImages(imgs, info.blockId, true);
        return;
      }
    }

    const html = cd.getData('text/html');
    const text = cd.getData('text/plain');
    state.saveUndoSnapshot();

    // Code fields and captions: plain text only.
    if (info.fieldName !== 'html') {
      document.execCommand('insertText', false, text);
      return;
    }

    const { block, context } = state.findBlockAnywhere(info.blockId);

    if (html && html.trim()) {
      if (!block || context !== null) {
        document.execCommand('insertText', false, text);
        return;
      }
      const result = transforms.run('paste', { html, text }, { messages });
      const pasted = result.blocks;
      if (!pasted || pasted.length === 0) {
        insertPlainLines(text, info);
        return;
      }
      // A single inline run pasted into a paragraph stays inline (no new block).
      if (pasted.length === 1 && pasted[0].type === 'paragraph' && hasInline(block)) {
        document.execCommand('insertHTML', false, sanitizeHTML(pasted[0].data.html));
        return;
      }
      insertBlocksAfter(pasted, block.id, true);
      return;
    }

    // Plain text that looks like Markdown becomes blocks.
    if (text && block && context === null && MD_HINT.test(text) && text.indexOf('\n') !== -1) {
      const pasted = markdownToBlocks(text).filter(b => blockRegistry.has(b.type));
      if (pasted.length) {
        insertBlocksAfter(pasted, block.id, true);
        return;
      }
    }
    insertPlainLines(text, info);
  }

  // ── Drop ───────────────────────────────────────────────────────────────────
  function handleDragOver(e) {
    if (readOnly) return;
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
  }

  function handleDrop(e) {
    if (readOnly) { e.preventDefault(); return; }
    const dt = e.dataTransfer;
    if (!dt) return;

    const files = Array.from(dt.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      if (typeof opts.uploadImage === 'function') {
        const blockEl = e.target.closest ? closestBlock(e.target) : null;
        uploadImages(files, blockEl ? blockEl.getAttribute('data-bre-block-id') : null, false);
      }
      return;
    }
    // Any other file: never let the browser navigate away from the page.
    if (dt.files && dt.files.length) { e.preventDefault(); return; }

    // External rich content would bypass the paste sanitizer: insert as text.
    const types = Array.from(dt.types || []);
    if (types.includes('text/html')) {
      e.preventDefault();
      const text = dt.getData('text/plain');
      if (!text) return;
      const pos = caretFromPoint(e.clientX, e.clientY);
      if (pos) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(pos);
      }
      document.execCommand('insertText', false, text);
    }
  }

  function caretFromPoint(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      const r = document.createRange();
      r.setStart(p.offsetNode, p.offset);
      r.collapse(true);
      return r;
    }
    return null;
  }

  // ── Image upload ───────────────────────────────────────────────────────────
  function pickFiles(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = true;
      input.hidden = true;
      input.addEventListener('change', () => { resolve(Array.from(input.files || [])); input.remove(); });
      input.addEventListener('cancel', () => { resolve([]); input.remove(); });
      root.appendChild(input);
      input.click();
    });
  }

  /**
   * Upload images via options.uploadImage and insert them as image blocks.
   * @param {boolean} replaceTarget  replace the target block if it is an empty
   *   paragraph or an unset image block
   */
  async function uploadImages(files, anchorId, replaceTarget) {
    if (typeof opts.uploadImage !== 'function') return;
    let after = anchorId;
    let replaceId = null;
    if (replaceTarget && anchorId) {
      const b = state.findBlockAnywhere(anchorId).block;
      const emptyPara = b && b.type === 'paragraph' && !(b.data.html || b.data.text || '').replace(/<[^>]*>/g, '').trim();
      if (emptyPara || (b && b.type === 'image' && !b.data.src)) replaceId = anchorId;
    }
    for (const file of files) {
      announce(messages.uploading);
      try {
        const url = await opts.uploadImage(file);
        if (destroyed) return;
        const safe = sanitizeURL(url);
        if (!safe) throw new Error(messages.invalidUrl);
        state.saveUndoSnapshot();
        const data = { src: safe, alt: file.name ? file.name.replace(/\.[^.]+$/, '') : '', caption: '' };
        const existing = replaceId ? state.findBlockAnywhere(replaceId).block : null;
        if (existing) {
          // Reuse the id so the block is replaced in place (top-level or column).
          const nb = { id: replaceId, type: 'image', data };
          replaceAnywhere(replaceId, nb);
          after = replaceId;
          replaceId = null;
        } else {
          const nb = makeBlock('image', data);
          const anchorOk = after && state.getBlock(after);
          state.addBlock(nb, anchorOk ? after : null);
          renderer.insertBlock(nb, anchorOk ? after : null);
          after = nb.id;
        }
        updatePlaceholder();
        notifyChange();
      } catch (error) {
        emitter.emit('error', { type: 'upload', error, file });
        announce(messages.uploadFailed);
      }
    }
  }

  // ── Slash select ───────────────────────────────────────────────────────────
  async function onSlashSelect(item) {
    if (!slashBlockId) return;
    const targetId = slashBlockId;
    slashBlockId = null;

    const { block } = state.findBlockAnywhere(targetId);
    if (!block) return;

    let newData;
    if (item.type === 'columns') {
      newData = {
        columns: Array.from({ length: item.colCount || 2 }, () => [makeBlock('paragraph', { html: '' })]),
      };
    } else if (item.type === 'formula') {
      const latex = await ask(messages.promptFormula);
      if (!latex) { clearSlashText(targetId); return; }
      newData = { latex, displayMode: true };
    } else if (item.type === 'image' && typeof opts.uploadImage === 'function') {
      clearSlashText(targetId);
      const files = await pickFiles('image/*');
      if (files.length) await uploadImages(files, targetId, true);
      return;
    } else if (MEDIA_TYPES.has(item.type)) {
      const label = item.type === 'image' ? messages.promptImageUrl
        : item.type === 'audio' ? messages.promptAudioUrl : messages.promptVideoUrl;
      const url = await ask(label);
      if (!url) { clearSlashText(targetId); return; }
      const safe = sanitizeURL(url);
      if (!safe) { reportInvalidUrl(); clearSlashText(targetId); return; }
      newData = { src: safe, caption: '' };
    } else {
      newData = { ...(item.defaultData || {}) };
    }

    state.saveUndoSnapshot();
    const cur = state.findBlockAnywhere(targetId).block || block;
    const newBlock = { ...cur, type: item.type, data: newData };
    replaceAnywhere(targetId, newBlock);
    updatePlaceholder();
    focusBlock(newBlock.id, 0);
    notifyChange();
  }

  /** Remove the typed "/query" text when a slash command is cancelled. */
  function clearSlashText(blockId) {
    const { block } = state.findBlockAnywhere(blockId);
    if (!block || !hasInline(block)) return;
    const el = renderer.getBlockEl(blockId);
    const field = el && el.querySelector('[data-bre-field]');
    if (field && field.textContent.startsWith('/')) {
      field.textContent = '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.focus();
    }
  }

  // ── Focus helpers ──────────────────────────────────────────────────────────
  function focusBlock(blockId, offset) {
    const el = renderer.getBlockEl(blockId);
    if (!el) return;
    const field = el.querySelector('[data-bre-field]');
    if (!field) return;
    field.focus();
    if (typeof offset === 'number') setCursorOffset(field, offset);
  }

  function focusBlockEnd(blockId) {
    const el = renderer.getBlockEl(blockId);
    if (!el) return;
    const field = el.querySelector('[data-bre-field]');
    if (!field) return;
    field.focus();
    setCursorOffset(field, field.textContent.length);
  }

  // ── Diff render (identity based thanks to structural sharing) ──────────────
  function markUnsafeIfMarkup(b) {
    if (b && b.data && typeof b.data.html === 'string' && b.data.html.indexOf('<') !== -1) unsafe.add(b.id);
  }

  function diffRender(oldBlocks, newBlocks) {
    let sameStructure = oldBlocks.length === newBlocks.length;
    if (sameStructure) {
      for (let i = 0; i < newBlocks.length; i++) {
        if (oldBlocks[i].id !== newBlocks[i].id) { sameStructure = false; break; }
      }
    }
    if (sameStructure) {
      let firstChanged = null;
      for (let i = 0; i < newBlocks.length; i++) {
        if (oldBlocks[i] !== newBlocks[i]) {
          renderer.updateBlock(newBlocks[i]);
          markUnsafeIfMarkup(newBlocks[i]);
          if (!firstChanged) firstChanged = newBlocks[i];
        }
      }
      if (firstChanged) focusBlockEnd(firstChanged.id);
    } else {
      // Raw browser html restored by undo/redo must be re-sanitized lazily.
      const oldSet = new Set(oldBlocks);
      for (const b of newBlocks) if (!oldSet.has(b)) markUnsafeIfMarkup(b);
      refreshAll();
      // Keep keyboard focus inside the editor so repeated Cmd+Z keeps working.
      const i = firstDifference(oldBlocks, newBlocks);
      const target = newBlocks[Math.min(i, newBlocks.length - 1)];
      if (target) focusBlockEnd(target.id);
    }
    updatePlaceholder();
  }

  function firstDifference(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
    return n;
  }

  /** Re-render after a structural edit, keeping the scroll window in virtual mode. */
  function refreshAll() {
    renderer.refresh(state.getBlocks());
    placeholderEl = null;
    drag.refresh();
  }

  // ── Document normalisation ─────────────────────────────────────────────────
  /**
   * Make a loaded document safe to render. Recursive: unknown types → paragraph,
   * markdown blocks → real blocks, missing ids/data filled, tables and columns
   * coerced to their expected shapes. One bad block never blocks the load.
   */
  function normalizeBlocks(list, out) {
    for (const b of list) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'markdown') {
        const md = (b.data && b.data.markdown) || '';
        for (const nb of markdownToBlocks(md)) out.push(nb);
        continue;
      }
      if (!blockRegistry.has(b.type)) {
        console.warn(`[bre] setJSON: unknown block type "${b.type}" — loaded as text`);
        const d = b.data && typeof b.data === 'object' ? b.data : {};
        out.push(makeBlock('paragraph', { text: String(d.text || d.html || d.markdown || '') }));
        continue;
      }
      let nb = b;
      if (typeof nb.id !== 'string' || !nb.data || typeof nb.data !== 'object') {
        nb = { ...nb, id: typeof nb.id === 'string' ? nb.id : generateId(), data: nb.data && typeof nb.data === 'object' ? nb.data : {} };
      }
      if (nb.type === 'columns') {
        const raw = Array.isArray(nb.data.columns) ? nb.data.columns : Array.isArray(nb.data.children) ? nb.data.children : [[], []];
        let cols = raw.map((c) => { const o = []; normalizeBlocks(Array.isArray(c) ? c : [], o); if (!o.length) o.push(makeBlock('paragraph', { html: '' })); return o; });
        while (cols.length < 2) cols.push([makeBlock('paragraph', { html: '' })]);
        if (cols.length > 4) cols = cols.slice(0, 4);
        nb = { ...nb, data: { columns: cols } };
      } else if (nb.type === 'table') {
        const rows = Array.isArray(nb.data.rows) && nb.data.rows.length
          ? nb.data.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [String(r ?? '')]))
          : [['', ''], ['', '']];
        const width = Math.max(...rows.map((r) => r.length), 1);
        for (const r of rows) while (r.length < width) r.push('');
        nb = { ...nb, data: { ...nb.data, rows } };
      }
      out.push(nb);
    }
  }

  function normalizeDoc(input) {
    const doc = migrateDocument(input);
    const out = [];
    normalizeBlocks(doc.blocks, out);
    if (out.length === 0) out.push(makeBlock('paragraph', { html: '' }));
    return { ...doc, blocks: out };
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  function getJSON() {
    flushUnsafe();
    return state.getDoc();
  }

  /** Programmatic loads never fire 'change'. */
  function setJSON(doc) {
    if (!doc || !Array.isArray(doc.blocks)) {
      console.warn('[bre] setJSON: invalid document');
      return;
    }
    fireChange.cancel();
    unsafe.clear();
    state.setDoc(normalizeDoc(doc));
    rerenderAll();
  }

  // Per-block HTML cache. Blocks are immutable with structural sharing, so an
  // unchanged block (same object) never needs to be serialized or sanitized
  // again — repeated getHTML() calls (e.g. from onChange) only pay for edits.
  const htmlCache = new WeakMap();
  // Built-in types whose toHTML() is safe by construction (escaped / sanitized
  // inside the plugin). Everything else (media, formula, columns, custom blocks)
  // gets a per-block DOMPurify pass.
  const SELF_SAFE = new Set(['paragraph', 'heading', 'quote', 'bulleted_list', 'numbered_list', 'divider', 'code', 'table']);

  function blockHTML(block) {
    let html = htmlCache.get(block);
    if (html !== undefined) return html;
    const plugin = blockRegistry.get(block.type);
    html = plugin.toHTML(block, ctx);
    if (!SELF_SAFE.has(block.type)) html = sanitizeHTML(html, { allowKaTeX: true, allowMedia: true });
    // KaTeX still loading → the plugin returned a plain-text fallback. Don't
    // cache it (it would stick forever); kick the load so the next call is right.
    if (html.indexOf('bre-formula-error') !== -1 && !getKaTeX()) {
      loadKaTeX();
      return html;
    }
    htmlCache.set(block, html);
    return html;
  }

  function getHTML() {
    flushUnsafe();
    const blocks = state.getBlocks();
    const parts = [];
    let i = 0;
    while (i < blocks.length) {
      const block = blocks[i];
      if (!blockRegistry.has(block.type)) { i++; continue; }
      if (block.type === 'bulleted_list' || block.type === 'numbered_list') {
        const type = block.type;
        const items = [];
        while (i < blocks.length && blocks[i].type === type) {
          items.push(blockHTML(blocks[i]));
          i++;
        }
        const tag = type === 'bulleted_list' ? 'ul' : 'ol';
        parts.push(`<${tag}>\n${items.join('\n')}\n</${tag}>`);
        continue;
      }
      parts.push(blockHTML(block));
      i++;
    }
    return parts.join('\n');
  }

  function setHTML(html) {
    if (typeof html !== 'string') return;
    const blocks = htmlToBlocks(html);
    const now = Date.now();
    setJSON({
      id: generateId(),
      version: CURRENT_VERSION,
      created: now,
      updated: now,
      blocks: blocks.length > 0 ? blocks : [makeBlock('paragraph', { html: '' })],
    });
  }

  function setReadOnly(value) {
    readOnly = !!value;
    if (readOnly) root.setAttribute('data-bre-readonly', '');
    else root.removeAttribute('data-bre-readonly');
    applyReadOnly(content, readOnly);
    if (readOnly) { slashMenu.hide(); slashBlockId = null; }
    drag.refresh();
  }

  function focus() {
    const first = state.getBlocks()[0];
    if (first) focusBlock(first.id, 0);
  }

  function blur() {
    const a = document.activeElement;
    if (a && root.contains(a)) a.blur();
  }

  function registerBlock(def) {
    blockRegistry.registerCustom(def);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    fireChange.cancel();
    if (snapshotTimer) clearTimeout(snapshotTimer);
    if (selRaf) cancelAnimationFrame(selRaf);
    root.removeEventListener('input', handleInput);
    root.removeEventListener('keydown', handleKeydown);
    root.removeEventListener('paste', handlePaste);
    root.removeEventListener('click', handleClick);
    root.removeEventListener('dblclick', handleDblClick);
    root.removeEventListener('drop', handleDrop);
    root.removeEventListener('dragover', handleDragOver);
    root.removeEventListener('focusin', handleFocusIn);
    root.removeEventListener('focusout', handleFocusOut);
    document.removeEventListener('selectionchange', handleSelectionChange);
    slashMenu.destroy();
    blockMenu.destroy();
    inlineToolbar.destroy();
    drag.destroy();
    renderer.destroy();
    emitter.clear();
    unsafe.clear();
    root.remove();
  }

  const api = {
    getJSON,
    setJSON,
    getHTML,
    setHTML,
    destroy,
    setReadOnly,
    isReadOnly: () => readOnly,
    focus,
    blur,
    isEmpty: isEmptyDoc,
    on: (event, handler) => emitter.on(event, handler),
    off: (event, handler) => emitter.off(event, handler),
    registerBlock,
  };

  queueMicrotask(() => { if (!destroyed) emitter.emit('ready', api); });

  if (readOnly) applyReadOnly(content, true);

  return api;
}

export { transforms };
