/**
 * Best Rich Editor — Stage 5
 * Block engine + all blocks + slash menu + drag + columns + BREM + BREW
 * + Table, Image, Audio, Video + Virtualized rendering
 */

import { createBremEditor } from '../modes/brem.js';
import { createBrewEditor } from '../modes/brew.js';
import { generateId } from '../utils/id.js';
import { debounce } from '../utils/debounce.js';
import {
  closestBlock,
  escapeHTML,
  getCursorOffset,
  setCursorOffset,
  isCursorAtStart,
  isCursorAtEnd,
} from '../utils/dom.js';
import { sanitizeHTML, sanitizeURL } from '../utils/sanitize.js';
import { transforms } from './transforms.js';
import { htmlToBlocks } from '../utils/htmlToBlocks.js';
import '../blocks/formula.js';
import { createState } from './state.js';
import { createCommands } from './commands.js';
import { createRenderer } from './renderer.js';
import { createVirtualRenderer } from './virtualRenderer.js';
import { blockRegistry } from './blockRegistry.js';
import { createSlashMenu } from '../ui/slashMenu.js';
import { initDragHandles } from '../ui/dragHandle.js';
import { createVideoPlugin } from '../blocks/video.js';

// Register all block types (side effects)
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

// Slash menu items
const SLASH_ITEMS = [
  {
    type: 'paragraph',
    label: 'Text',
    icon: 'T',
    description: 'Start writing with plain text',
    defaultData: { html: '' },
  },
  {
    type: 'heading',
    label: 'Heading 1',
    icon: 'H1',
    description: 'Large section heading',
    defaultData: { level: 1, html: '' },
  },
  {
    type: 'heading',
    label: 'Heading 2',
    icon: 'H2',
    description: 'Medium section heading',
    defaultData: { level: 2, html: '' },
  },
  {
    type: 'heading',
    label: 'Heading 3',
    icon: 'H3',
    description: 'Small section heading',
    defaultData: { level: 3, html: '' },
  },
  {
    type: 'bulleted_list',
    label: 'Bulleted List',
    icon: '•',
    description: 'Create a simple bulleted list',
    defaultData: { html: '' },
  },
  {
    type: 'numbered_list',
    label: 'Numbered List',
    icon: '1.',
    description: 'Create a numbered list',
    defaultData: { html: '' },
  },
  {
    type: 'quote',
    label: 'Quote',
    icon: '"',
    description: 'Capture a quote or callout',
    defaultData: { html: '' },
  },
  {
    type: 'divider',
    label: 'Divider',
    icon: '—',
    description: 'Insert a horizontal divider',
    defaultData: {},
  },
  {
    type: 'code',
    label: 'Code',
    icon: '</>',
    description: 'Write a code snippet',
    defaultData: { code: '', language: '' },
  },
  {
    type: 'columns',
    label: 'Columns 2',
    icon: '⫾',
    description: 'Two-column layout',
    colCount: 2,
    defaultData: null, // handled specially
  },
  {
    type: 'columns',
    label: 'Columns 3',
    icon: '⫶',
    description: 'Three-column layout',
    colCount: 3,
    defaultData: null, // handled specially
  },
  {
    type: 'columns',
    label: 'Columns 4',
    icon: '⊞',
    description: 'Four-column layout (2×2 on medium screens)',
    colCount: 4,
    defaultData: null, // handled specially
  },
  {
    type: 'formula',
    label: 'Formula',
    icon: '∑',
    description: 'Insert a KaTeX math formula',
    defaultData: null, // handled specially
  },
  {
    type: 'table',
    label: 'Table',
    icon: '⊞',
    description: 'Insert a table',
    defaultData: { rows: [['Header 1', 'Header 2'], ['', '']] },
  },
  {
    type: 'image',
    label: 'Image',
    icon: '🖼',
    description: 'Insert an image from URL',
    defaultData: null, // handled specially
  },
  {
    type: 'audio',
    label: 'Audio',
    icon: '♪',
    description: 'Insert an audio file from URL',
    defaultData: null, // handled specially
  },
  {
    type: 'video',
    label: 'Video',
    icon: '▶',
    description: 'Insert a video or YouTube/Vimeo embed',
    defaultData: null, // handled specially
  },
];

function makeBlock(type, data) {
  return { id: generateId(), type, data };
}

export function createEditor(container, options = {}) {
  if (!(container instanceof Element)) {
    throw new Error('[bre] createEditor: container must be a DOM Element');
  }

  if (options.mode === 'BREM') {
    return createBremEditor(container, options);
  }

  if (options.mode === 'BREW') {
    return createBrewEditor(container, options);
  }

  const opts = {
    mode: 'BRE',
    onChange: null,
    embedAllowlist: ['youtube.com', 'youtu.be', 'vimeo.com'],
    virtualize: false,
    ...options,
  };

  // Register video plugin with the resolved embed allowlist (always overwrite so
  // different editor instances can have different allowlists).
  blockRegistry.register('video', createVideoPlugin(opts.embedAllowlist));

  // ── Mount ──────────────────────────────────────────────────────────────────

  const root = document.createElement('div');
  root.className = 'bre-editor';
  root.setAttribute('data-bre-mode', opts.mode);
  container.appendChild(root);

  // ── Subsystems ─────────────────────────────────────────────────────────────

  const state = createState();
  const commands = createCommands();
  const renderer = opts.virtualize
    ? createVirtualRenderer(root, state)
    : createRenderer(root);

  // Initialize with one empty paragraph if no content
  const initBlock = makeBlock('paragraph', { html: '' });
  state.addBlock(initBlock);
  renderer.renderAll(state.getBlocks());

  // Slash menu
  const slashMenu = createSlashMenu(onSlashSelect);

  // Drag handles
  initDragHandles(root, state, renderer);

  // Register paste pipeline steps (idempotent — only register once globally)
  if (!transforms.has('paste')) {
    // Step 1: normalise — strip MS Word/Google Docs cruft
    transforms.register('paste', (payload) => {
      let { html } = payload;
      // Remove MS Word conditional comments and namespace tags
      html = html.replace(/<!--\[if[\s\S]*?\[endif\]-->/gi, '');
      html = html.replace(/<\/?o:[^>]*>/gi, '');
      html = html.replace(/<\/?w:[^>]*>/gi, '');
      html = html.replace(/<\/?m:[^>]*>/gi, '');
      // Remove style/script/meta tags
      html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
      html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
      return { ...payload, html };
    }, { order: 10 });

    // Step 2: parse HTML → blocks
    transforms.register('paste', (payload) => {
      const blocks = htmlToBlocks(payload.html);
      return { ...payload, blocks };
    }, { order: 20 });

    // Step 3: optimise — merge adjacent same-type text blocks if trivially short
    transforms.register('paste', (payload) => {
      // No-op for now — placeholder for future optimisation
      return payload;
    }, { order: 30 });
  }

  // Debounced onChange
  const notifyChange = opts.onChange
    ? debounce(() => opts.onChange(state.getDoc()), 300)
    : null;

  // Track the block that triggered the slash menu
  let slashBlockId = null;
  let slashFieldEl = null;

  // ── Event Delegation ───────────────────────────────────────────────────────

  root.addEventListener('input', handleInput);
  root.addEventListener('keydown', handleKeydown);
  root.addEventListener('paste', handlePaste);
  root.addEventListener('click', handleClick);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getFieldInfo(target) {
    const fieldEl = target.closest('[data-bre-field]');
    if (!fieldEl) return null;
    const blockEl = closestBlock(fieldEl);
    if (!blockEl) return null;
    const blockId = blockEl.getAttribute('data-bre-block-id');
    const fieldName = fieldEl.getAttribute('data-bre-field');
    return { fieldEl, blockEl, blockId, fieldName };
  }

  // ── Click Handler ──────────────────────────────────────────────────────────

  function handleClick(e) {
    // Formula click-to-edit
    const formulaEl = e.target.closest('.bre-formula');
    if (formulaEl) {
      const blockEl = closestBlock(formulaEl);
      if (!blockEl) return;
      const blockId = blockEl.getAttribute('data-bre-block-id');
      const block = state.getBlock(blockId);
      if (!block || block.type !== 'formula') return;
      const currentLatex = block.data.latex || '';
      const latex = prompt('Edit LaTeX formula:', currentLatex);
      if (latex === null) return;
      state.updateBlockData(blockId, { latex, displayMode: block.data.displayMode ?? true });
      renderer.updateBlock(state.getBlock(blockId));
      if (notifyChange) notifyChange();
      return;
    }

    // Image click-to-set-src
    const imgEl = e.target.closest('.bre-image, .bre-image-placeholder');
    if (imgEl) {
      const blockEl = closestBlock(imgEl);
      if (!blockEl) return;
      const blockId = blockEl.getAttribute('data-bre-block-id');
      const block = state.getBlock(blockId);
      if (!block || block.type !== 'image') return;
      const url = prompt('Enter image URL:', block.data.src || '');
      if (url === null) return;
      const safe = url ? sanitizeURL(url) : '';
      if (url && !safe) { alert('Invalid or unsafe URL.'); return; }
      state.updateBlockData(blockId, { src: safe });
      renderer.updateBlock(state.getBlock(blockId));
      if (notifyChange) notifyChange();
      return;
    }

    // Audio click-to-set-src
    const audioEl = e.target.closest('.bre-audio, .bre-audio-placeholder');
    if (audioEl) {
      const blockEl = closestBlock(audioEl);
      if (!blockEl) return;
      const blockId = blockEl.getAttribute('data-bre-block-id');
      const block = state.getBlock(blockId);
      if (!block || block.type !== 'audio') return;
      const url = prompt('Enter audio URL:', block.data.src || '');
      if (url === null) return;
      const safe = url ? sanitizeURL(url) : '';
      if (url && !safe) { alert('Invalid or unsafe URL.'); return; }
      state.updateBlockData(blockId, { src: safe });
      renderer.updateBlock(state.getBlock(blockId));
      if (notifyChange) notifyChange();
      return;
    }

    // Video click-to-set-src
    const videoEl = e.target.closest('.bre-video, .bre-video-embed, .bre-video-placeholder');
    if (videoEl) {
      const blockEl = closestBlock(videoEl);
      if (!blockEl) return;
      const blockId = blockEl.getAttribute('data-bre-block-id');
      const block = state.getBlock(blockId);
      if (!block || block.type !== 'video') return;
      const url = prompt('Enter video URL or YouTube/Vimeo link:', block.data.src || '');
      if (url === null) return;
      const safe = url ? sanitizeURL(url) : '';
      if (url && !safe) { alert('Invalid or unsafe URL.'); return; }
      state.updateBlockData(blockId, { src: safe });
      renderer.updateBlock(state.getBlock(blockId));
      if (notifyChange) notifyChange();
      return;
    }

    // Table toolbar actions
    const tableActionEl = e.target.closest('[data-bre-table-action]');
    if (tableActionEl) {
      handleTableAction(tableActionEl);
      return;
    }
  }

  function handleTableAction(actionEl) {
    const action = actionEl.getAttribute('data-bre-table-action');
    const blockEl = closestBlock(actionEl);
    if (!blockEl) return;
    const blockId = blockEl.getAttribute('data-bre-block-id');
    const block = state.getBlock(blockId);
    if (!block || block.type !== 'table') return;

    let rows = block.data.rows.map(r => [...r]);
    switch (action) {
      case 'add-row':
        rows.push(new Array(rows[0].length).fill(''));
        break;
      case 'del-row':
        if (rows.length > 1) rows = rows.slice(0, -1);
        break;
      case 'add-col':
        rows = rows.map(r => [...r, '']);
        break;
      case 'del-col':
        if (rows[0].length > 1) rows = rows.map(r => r.slice(0, -1));
        break;
      default:
        return;
    }
    state.updateBlockData(blockId, { rows });
    renderer.updateBlock(state.getBlock(blockId));
    if (notifyChange) notifyChange();
  }

  // ── Input Handler ──────────────────────────────────────────────────────────

  function handleInput(e) {
    // Table cell input — handle before generic field logic
    const cellEl = e.target.closest('[data-bre-table-row]');
    if (cellEl) {
      handleTableCellInput(cellEl);
      if (notifyChange) notifyChange();
      return;
    }

    const info = getFieldInfo(e.target);
    if (!info) return;
    const { fieldEl, blockId, fieldName } = info;

    // Fix empty contenteditable leaving <br>
    if (fieldEl.textContent === '' && fieldEl.innerHTML !== '') {
      fieldEl.innerHTML = '';
    }

    const textContent = fieldEl.textContent;
    const isHtmlField = fieldName === 'html';
    const fieldValue = isHtmlField ? sanitizeHTML(fieldEl.innerHTML) : textContent;

    // Sync to state
    const { block, context } = state.findBlockAnywhere(blockId);
    if (!block) return;

    if (context === null) {
      // Top-level block
      state.updateBlockData(blockId, { [fieldName]: fieldValue });
    } else {
      // Column sub-block — update its data within the column
      const { columnsBlockId, colIndex } = context;
      const columnsBlock = state.getBlock(columnsBlockId);
      if (!columnsBlock) return;
      const newColBlocks = columnsBlock.data.columns[colIndex].map(b => {
        if (b.id !== blockId) return b;
        return { ...b, data: { ...b.data, [fieldName]: fieldValue } };
      });
      state.updateColumnBlock(columnsBlockId, colIndex, newColBlocks);
    }

    // Slash menu — use textContent for detection regardless of field type
    if (fieldName === 'text' || fieldName === 'html') {
      if (textContent === '/') {
        slashBlockId = blockId;
        slashFieldEl = fieldEl;
        const rect = fieldEl.getBoundingClientRect();
        slashMenu.show(rect, SLASH_ITEMS);
      } else if (textContent.startsWith('/') && slashBlockId === blockId) {
        slashMenu.filter(textContent.slice(1));
      } else {
        if (slashMenu.isVisible()) slashMenu.hide();
        slashBlockId = null;
        slashFieldEl = null;
      }
    } else {
      if (slashMenu.isVisible()) slashMenu.hide();
    }

    if (notifyChange) notifyChange();
  }

  function handleTableCellInput(cellEl) {
    const row = parseInt(cellEl.getAttribute('data-bre-table-row'), 10);
    const col = parseInt(cellEl.getAttribute('data-bre-table-col'), 10);
    // Fix <br> left behind in empty contenteditable
    if (cellEl.textContent === '' && cellEl.innerHTML !== '') cellEl.innerHTML = '';
    const text = cellEl.textContent;

    const blockEl = closestBlock(cellEl);
    if (!blockEl) return;
    const blockId = blockEl.getAttribute('data-bre-block-id');
    const block = state.getBlock(blockId);
    if (!block || block.type !== 'table') return;

    const newRows = block.data.rows.map((r, ri) =>
      ri !== row ? r : r.map((c, ci) => (ci !== col ? c : text))
    );
    // Update state without re-rendering — DOM already has correct text
    state.updateBlockData(blockId, { rows: newRows });
  }

  // ── Keydown Handler ────────────────────────────────────────────────────────

  function handleKeydown(e) {
    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      commands.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
      e.preventDefault();
      commands.redo();
      return;
    }

    // Slash menu navigation
    if (slashMenu.isVisible()) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashMenu.next();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashMenu.prev();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        slashMenu.confirm();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        slashMenu.hide();
        slashBlockId = null;
        slashFieldEl = null;
        return;
      }
    }

    // Table cell keyboard handling
    const tableCellEl = e.target.closest('[data-bre-table-row]');
    if (tableCellEl) {
      if (e.key === 'Tab') {
        e.preventDefault();
        handleTableTab(tableCellEl, e.shiftKey);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // Prevent Enter from splitting the block; allow Shift+Enter for newline
        e.preventDefault();
        return;
      }
      return; // Let all other keys work naturally inside table cells
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const info = getFieldInfo(e.target);
      if (info) handleLinkInsert(info.fieldEl);
      return;
    }

    const info = getFieldInfo(e.target);
    if (!info) return;
    const { fieldEl, blockId } = info;

    const { block, context } = state.findBlockAnywhere(blockId);
    if (!block) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEnter(block, fieldEl, context);
      return;
    }

    if (e.key === 'Backspace') {
      if (isCursorAtStart(fieldEl)) {
        e.preventDefault();
        handleBackspace(e, block, fieldEl, context);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      if (isCursorAtStart(fieldEl)) {
        e.preventDefault();
        navigatePrev(block, context);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      if (isCursorAtEnd(fieldEl)) {
        e.preventDefault();
        navigateNext(block, context);
      }
      return;
    }
  }

  // ── Enter ──────────────────────────────────────────────────────────────────

  function handleEnter(block, fieldEl, context) {
    // Split field content at cursor using Range API to preserve inline HTML
    const sel = window.getSelection();
    let beforeHTML = '';
    let afterHTML = '';

    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.collapse(true);
      // Select from cursor to end of fieldEl, then extract it
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

    if (context !== null) {
      // Sub-block inside a column
      const { columnsBlockId, colIndex, indexInCol } = context;
      const columnsBlock = state.getBlock(columnsBlockId);
      if (!columnsBlock) return;

      const updatedBlock = { ...block, data: { ...block.data, html: beforeHTML } };
      const newPara = makeBlock('paragraph', { html: afterHTML });

      const newColBlocks = [...columnsBlock.data.columns[colIndex]];
      newColBlocks[indexInCol] = updatedBlock;
      newColBlocks.splice(indexInCol + 1, 0, newPara);

      state.updateColumnBlock(columnsBlockId, colIndex, newColBlocks);

      // Re-render the columns block
      const updatedColumnsBlock = state.getBlock(columnsBlockId);
      renderer.updateBlock(updatedColumnsBlock);

      focusBlock(newPara.id, 0);
    } else {
      // Top-level block — fieldEl already has beforeHTML (extractContents modified it)
      state.updateBlockData(block.id, { html: beforeHTML });
      const newPara = makeBlock('paragraph', { html: afterHTML });
      state.addBlock(newPara, block.id);
      renderer.insertBlock(newPara, block.id);

      focusBlock(newPara.id, 0);
    }
  }

  // ── Backspace ──────────────────────────────────────────────────────────────

  function handleBackspace(e, block, fieldEl, context) {
    const text = fieldEl.textContent;

    if (context !== null) {
      // Sub-block inside a column
      const { columnsBlockId, colIndex, indexInCol } = context;

      // First sub-block in a column — do nothing (don't merge across columns)
      if (indexInCol === 0) return;

      const columnsBlock = state.getBlock(columnsBlockId);
      if (!columnsBlock) return;
      const colBlocks = columnsBlock.data.columns[colIndex];
      const prevBlock = colBlocks[indexInCol - 1];

      // Convert non-paragraph to paragraph if not empty
      if (block.type !== 'paragraph' && text.length > 0) {
        const html = block.data.html ?? escapeHTML(block.data.text ?? '');
        const updatedBlock = { ...block, type: 'paragraph', data: { html } };
        const newColBlocks = colBlocks.map((b, i) => i === indexInCol ? updatedBlock : b);
        state.updateColumnBlock(columnsBlockId, colIndex, newColBlocks);
        const updatedCols = state.getBlock(columnsBlockId);
        renderer.updateBlock(updatedCols);
        focusBlock(updatedBlock.id, 0);
        return;
      }

      // Merge with previous if prev supports inline content
      const prevPlugin = blockRegistry.get(prevBlock.type);
      const prevHasInline = prevPlugin && prevBlock.data &&
        (typeof prevBlock.data.html === 'string' || typeof prevBlock.data.text === 'string');

      if (prevHasInline) {
        const prevHTML = prevBlock.data.html ?? escapeHTML(prevBlock.data.text ?? '');
        const currentHTML = block.data.html ?? escapeHTML(block.data.text ?? '');
        const mergedHTML = prevHTML + currentHTML;
        const tmpEl = document.createElement('div');
        tmpEl.innerHTML = prevHTML;
        const mergedOffset = tmpEl.textContent.length;
        const updatedPrev = { ...prevBlock, data: { ...prevBlock.data, html: mergedHTML } };
        const newColBlocks = colBlocks
          .map((b, i) => i === indexInCol - 1 ? updatedPrev : b)
          .filter((_, i) => i !== indexInCol);
        state.updateColumnBlock(columnsBlockId, colIndex, newColBlocks);
        const updatedCols = state.getBlock(columnsBlockId);
        renderer.updateBlock(updatedCols);
        focusBlock(updatedPrev.id, mergedOffset);
      } else {
        // Just remove current
        const newColBlocks = colBlocks.filter((_, i) => i !== indexInCol);
        state.updateColumnBlock(columnsBlockId, colIndex, newColBlocks);
        const updatedCols = state.getBlock(columnsBlockId);
        renderer.updateBlock(updatedCols);
        if (colBlocks[indexInCol - 1]) {
          focusBlock(colBlocks[indexInCol - 1].id, 0);
        }
      }
      return;
    }

    // Top-level block
    const blockIndex = state.getBlockIndex(block.id);

    // First block — if empty paragraph, do nothing
    if (blockIndex === 0) {
      if (block.type === 'paragraph' && text === '') return;
      if (block.type !== 'paragraph') {
        // Convert to paragraph
        const html = block.data.html ?? escapeHTML(block.data.text ?? '');
        const newBlock = makeBlock('paragraph', { html });
        newBlock.id = block.id; // keep same id
        state.replaceBlock(block.id, newBlock);
        renderer.updateBlock(state.getBlock(block.id));
        focusBlock(newBlock.id, 0);
      }
      return;
    }

    // Non-paragraph type with text: convert to paragraph
    if (block.type !== 'paragraph' && text.length > 0) {
      const html = block.data.html ?? escapeHTML(block.data.text ?? '');
      const newBlock = { ...block, type: 'paragraph', data: { html } };
      state.replaceBlock(block.id, newBlock);
      renderer.updateBlock(state.getBlock(block.id));
      focusBlock(newBlock.id, 0);
      return;
    }

    // Merge with previous block
    const blocks = state.getBlocks();
    const prevBlock = blocks[blockIndex - 1];

    // If prev is columns, just remove current empty block
    if (prevBlock.type === 'columns' || prevBlock.type === 'divider') {
      state.removeBlock(block.id);
      renderer.removeBlock(block.id);
      focusBlock(prevBlock.id, 0);
      return;
    }

    const prevPlugin = blockRegistry.get(prevBlock.type);
    const prevHasInline = prevPlugin && prevBlock.data &&
      (typeof prevBlock.data.html === 'string' || typeof prevBlock.data.text === 'string');

    if (prevHasInline) {
      const prevHTML = prevBlock.data.html ?? escapeHTML(prevBlock.data.text ?? '');
      const currentHTML = block.data.html ?? escapeHTML(block.data.text ?? '');
      const mergedHTML = prevHTML + currentHTML;
      const tmpEl = document.createElement('div');
      tmpEl.innerHTML = prevHTML;
      const mergedOffset = tmpEl.textContent.length;
      state.updateBlockData(prevBlock.id, { html: mergedHTML });
      state.removeBlock(block.id);
      renderer.removeBlock(block.id);

      // Update prev block in DOM to show merged content
      const updatedPrev = state.getBlock(prevBlock.id);
      if (updatedPrev) {
        renderer.updateBlock(updatedPrev);
        focusBlock(prevBlock.id, mergedOffset);
      }
    } else {
      // Just remove current
      state.removeBlock(block.id);
      renderer.removeBlock(block.id);
      focusBlock(prevBlock.id, 0);
    }
  }

  // ── Arrow Navigation ───────────────────────────────────────────────────────

  function navigatePrev(block, context) {
    if (context !== null) {
      // In a column — try to go to previous block in same column
      const { columnsBlockId, colIndex, indexInCol } = context;
      if (indexInCol > 0) {
        const columnsBlock = state.getBlock(columnsBlockId);
        const prevId = columnsBlock.data.columns[colIndex][indexInCol - 1].id;
        focusBlockEnd(prevId);
      }
      // Don't leave the column
      return;
    }

    const blockIndex = state.getBlockIndex(block.id);
    if (blockIndex <= 0) return;
    const blocks = state.getBlocks();
    const prevBlock = blocks[blockIndex - 1];
    focusBlockEnd(prevBlock.id);
  }

  function navigateNext(block, context) {
    if (context !== null) {
      // In a column — try to go to next block in same column
      const { columnsBlockId, colIndex, indexInCol } = context;
      const columnsBlock = state.getBlock(columnsBlockId);
      const col = columnsBlock.data.columns[colIndex];
      if (indexInCol < col.length - 1) {
        focusBlock(col[indexInCol + 1].id, 0);
      }
      return;
    }

    const blockIndex = state.getBlockIndex(block.id);
    const blocks = state.getBlocks();
    if (blockIndex >= blocks.length - 1) return;
    focusBlock(blocks[blockIndex + 1].id, 0);
  }

  // ── Table Tab Navigation ───────────────────────────────────────────────────

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
      // At last cell — add a new row
      if (nextRow >= numRows) {
        const newRows = [...rows, new Array(numCols).fill('')];
        state.updateBlockData(blockId, { rows: newRows });
        renderer.updateBlock(state.getBlock(blockId));
        nextRow = numRows;
      }
    } else {
      nextCol--;
      if (nextCol < 0) { nextCol = numCols - 1; nextRow--; }
      if (nextRow < 0) return; // already at first cell
    }

    const targetCell = blockEl.querySelector(
      `[data-bre-table-row="${nextRow}"][data-bre-table-col="${nextCol}"]`
    );
    if (targetCell) {
      targetCell.focus();
      // Move caret to end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(targetCell);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // ── Link Insert (Cmd+K) ────────────────────────────────────────────────────

  function handleLinkInsert(fieldEl) {
    const url = prompt('Enter URL:');
    if (!url) return;
    const safe = sanitizeURL(url);
    if (!safe) { alert('Invalid or unsafe URL.'); return; }
    fieldEl.focus();
    document.execCommand('createLink', false, safe);
    // Add rel/target to the created link
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      let node = sel.getRangeAt(0).commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      const a = node.closest?.('a');
      if (a) {
        a.setAttribute('rel', 'noopener noreferrer');
        a.setAttribute('target', '_blank');
      }
    }
  }

  // ── Paste Handler ──────────────────────────────────────────────────────────

  function handlePaste(e) {
    const info = getFieldInfo(e.target);
    if (!info) return;
    e.preventDefault();

    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');

    // If HTML available, use the transform pipeline (top-level blocks only)
    if (html && html.trim()) {
      const { blockId } = info;
      const { block, context } = state.findBlockAnywhere(blockId);

      if (!block || context !== null) {
        // For column sub-blocks, fall back to plain text
        document.execCommand('insertText', false, text);
        return;
      }

      const result = transforms.run('paste', { html, text }, {});
      const pastedBlocks = result.blocks;

      if (!pastedBlocks || pastedBlocks.length === 0) {
        document.execCommand('insertText', false, text);
        return;
      }

      // Insert blocks after current block
      let afterId = block.id;
      for (const pb of pastedBlocks) {
        state.addBlock(pb, afterId);
        renderer.insertBlock(pb, afterId);
        afterId = pb.id;
      }

      // Remove current block if it was empty
      const tmpDiv = document.createElement('div');
      tmpDiv.innerHTML = block.data.html ?? escapeHTML(block.data.text ?? '');
      if (!tmpDiv.textContent.trim()) {
        state.removeBlock(block.id);
        renderer.removeBlock(block.id);
      }

      // Focus first pasted block
      if (pastedBlocks.length > 0) {
        focusBlock(pastedBlocks[0].id, 0);
      }

      if (notifyChange) notifyChange();
    } else {
      // Plain text — insert at cursor
      document.execCommand('insertText', false, text);
    }
  }

  // ── Slash Select ───────────────────────────────────────────────────────────

  function onSlashSelect(item) {
    if (!slashBlockId) return;

    const { block, context } = state.findBlockAnywhere(slashBlockId);
    if (!block) return;

    // Build new block data
    let newData;
    if (item.type === 'columns') {
      const colCount = item.colCount || 2;
      newData = {
        columns: Array.from({ length: colCount }, () => [makeBlock('paragraph', { html: '' })]),
      };
    } else if (item.type === 'formula') {
      const latex = prompt('Enter LaTeX formula (e.g. E = mc^2):');
      if (!latex) return; // cancelled
      newData = { latex, displayMode: true };
    } else if (item.type === 'image' || item.type === 'audio' || item.type === 'video') {
      const label = item.type === 'video' ? 'video URL or YouTube/Vimeo link' : `${item.type} URL`;
      const url = prompt(`Enter ${label}:`);
      if (!url) return; // cancelled
      const safe = sanitizeURL(url);
      if (!safe) { alert('Invalid or unsafe URL.'); return; }
      newData = { src: safe, caption: '' };
    } else {
      newData = { ...(item.defaultData || {}) };
    }

    const newBlock = { ...block, type: item.type, data: newData };

    if (context !== null) {
      // Replace sub-block in column
      const { columnsBlockId, colIndex, indexInCol } = context;
      const columnsBlock = state.getBlock(columnsBlockId);
      const newColBlocks = columnsBlock.data.columns[colIndex].map((b, i) =>
        i === indexInCol ? newBlock : b
      );
      state.updateColumnBlock(columnsBlockId, colIndex, newColBlocks);
      const updatedCols = state.getBlock(columnsBlockId);
      renderer.updateBlock(updatedCols);
      focusBlock(newBlock.id, 0);
    } else {
      // Replace top-level block
      state.replaceBlock(block.id, newBlock);
      renderer.updateBlock(newBlock);
      focusBlock(newBlock.id, 0);
    }

    slashBlockId = null;
    slashFieldEl = null;
  }

  // ── Focus Helpers ──────────────────────────────────────────────────────────

  function focusBlock(blockId, offset) {
    const el = renderer.getBlockEl(blockId);
    if (!el) return;
    const field = el.querySelector('[data-bre-field]');
    if (!field) return;
    field.focus();
    if (typeof offset === 'number') {
      setCursorOffset(field, offset);
    }
  }

  function focusBlockEnd(blockId) {
    const el = renderer.getBlockEl(blockId);
    if (!el) return;
    const field = el.querySelector('[data-bre-field]');
    if (!field) return;
    field.focus();
    const len = field.textContent.length;
    setCursorOffset(field, len);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function getJSON() {
    return { ...state.getDoc() };
  }

  function setJSON(doc) {
    if (!doc || !Array.isArray(doc.blocks)) {
      console.warn('[bre] setJSON: invalid document');
      return;
    }
    state.setDoc(doc);
    renderer.renderAll(state.getBlocks());
  }

  function getHTML() {
    const blocks = state.getBlocks();
    const parts = [];
    let i = 0;

    while (i < blocks.length) {
      const block = blocks[i];

      // Group adjacent bulleted list items
      if (block.type === 'bulleted_list') {
        const group = [];
        while (i < blocks.length && blocks[i].type === 'bulleted_list') {
          group.push(blocks[i]);
          i++;
        }
        const plugin = blockRegistry.get('bulleted_list');
        const items = group.map(b => plugin.toHTML(b)).join('\n');
        parts.push(`<ul>\n${items}\n</ul>`);
        continue;
      }

      // Group adjacent numbered list items
      if (block.type === 'numbered_list') {
        const group = [];
        while (i < blocks.length && blocks[i].type === 'numbered_list') {
          group.push(blocks[i]);
          i++;
        }
        const plugin = blockRegistry.get('numbered_list');
        const items = group.map(b => plugin.toHTML(b)).join('\n');
        parts.push(`<ol>\n${items}\n</ol>`);
        continue;
      }

      // Regular block
      if (blockRegistry.has(block.type)) {
        const plugin = blockRegistry.get(block.type);
        parts.push(plugin.toHTML(block));
      }
      i++;
    }

    const raw = parts.join('\n');
    return sanitizeHTML(raw);
  }

  function setHTML(html) {
    if (typeof html !== 'string') return;
    const blocks = htmlToBlocks(html);
    setJSON({
      id: generateId(),
      version: 1,
      created: Date.now(),
      updated: Date.now(),
      blocks: blocks.length > 0 ? blocks : [makeBlock('paragraph', { html: '' })],
    });
  }

  function destroy() {
    root.removeEventListener('input', handleInput);
    root.removeEventListener('keydown', handleKeydown);
    root.removeEventListener('paste', handlePaste);
    root.removeEventListener('click', handleClick);
    slashMenu.destroy();
    if (renderer.destroy) renderer.destroy();
    root.remove();
  }

  return { getJSON, setJSON, getHTML, setHTML, destroy };
}

export { transforms };
