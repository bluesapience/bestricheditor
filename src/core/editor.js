/**
 * Best Rich Editor — Stage 1
 * Block engine + 7 essential blocks + slash menu + drag + columns
 */

import { generateId } from '../utils/id.js';
import { debounce } from '../utils/debounce.js';
import {
  closestBlock,
  getCursorOffset,
  setCursorOffset,
  isCursorAtStart,
  isCursorAtEnd,
} from '../utils/dom.js';
import { sanitizeHTML } from '../utils/sanitize.js';
import { createState } from './state.js';
import { createCommands } from './commands.js';
import { createRenderer } from './renderer.js';
import { blockRegistry } from './blockRegistry.js';
import { createSlashMenu } from '../ui/slashMenu.js';
import { initDragHandles } from '../ui/dragHandle.js';

// Register all block types (side effects)
import '../blocks/paragraph.js';
import '../blocks/heading.js';
import '../blocks/quote.js';
import '../blocks/divider.js';
import '../blocks/code.js';
import '../blocks/bulletedList.js';
import '../blocks/numberedList.js';
import '../ui/columns.js';

// Slash menu items
const SLASH_ITEMS = [
  {
    type: 'paragraph',
    label: 'Text',
    icon: 'T',
    description: 'Start writing with plain text',
    defaultData: { text: '' },
  },
  {
    type: 'heading',
    label: 'Heading 1',
    icon: 'H1',
    description: 'Large section heading',
    defaultData: { level: 1, text: '' },
  },
  {
    type: 'heading',
    label: 'Heading 2',
    icon: 'H2',
    description: 'Medium section heading',
    defaultData: { level: 2, text: '' },
  },
  {
    type: 'heading',
    label: 'Heading 3',
    icon: 'H3',
    description: 'Small section heading',
    defaultData: { level: 3, text: '' },
  },
  {
    type: 'bulleted_list',
    label: 'Bulleted List',
    icon: '•',
    description: 'Create a simple bulleted list',
    defaultData: { text: '' },
  },
  {
    type: 'numbered_list',
    label: 'Numbered List',
    icon: '1.',
    description: 'Create a numbered list',
    defaultData: { text: '' },
  },
  {
    type: 'quote',
    label: 'Quote',
    icon: '"',
    description: 'Capture a quote or callout',
    defaultData: { text: '' },
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
    label: 'Columns',
    icon: '⫾',
    description: 'Two-column layout',
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

  const opts = {
    mode: 'BRE',
    onChange: null,
    embedAllowlist: ['youtube.com', 'youtu.be', 'vimeo.com'],
    virtualize: false,
    ...options,
  };

  // ── Mount ──────────────────────────────────────────────────────────────────

  const root = document.createElement('div');
  root.className = 'bre-editor';
  root.setAttribute('data-bre-mode', opts.mode);
  container.appendChild(root);

  // ── Subsystems ─────────────────────────────────────────────────────────────

  const state = createState();
  const commands = createCommands();
  const renderer = createRenderer(root);

  // Initialize with one empty paragraph if no content
  const initBlock = makeBlock('paragraph', { text: '' });
  state.addBlock(initBlock);
  renderer.renderAll(state.getBlocks());

  // Slash menu
  const slashMenu = createSlashMenu(onSlashSelect);

  // Drag handles
  initDragHandles(root, state, renderer);

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

  // ── Input Handler ──────────────────────────────────────────────────────────

  function handleInput(e) {
    const info = getFieldInfo(e.target);
    if (!info) return;
    const { fieldEl, blockId, fieldName } = info;

    // Fix empty contenteditable leaving <br>
    if (fieldEl.textContent === '' && fieldEl.innerHTML !== '') {
      fieldEl.innerHTML = '';
    }

    const text = fieldEl.textContent;

    // Sync to state
    const { block, context } = state.findBlockAnywhere(blockId);
    if (!block) return;

    if (context === null) {
      // Top-level block
      state.updateBlockData(blockId, { [fieldName]: text });
    } else {
      // Column sub-block — update its data within the column
      const { columnsBlockId, colIndex } = context;
      const columnsBlock = state.getBlock(columnsBlockId);
      if (!columnsBlock) return;
      const newColBlocks = columnsBlock.data.columns[colIndex].map(b => {
        if (b.id !== blockId) return b;
        return { ...b, data: { ...b.data, [fieldName]: text } };
      });
      state.updateColumnBlock(columnsBlockId, colIndex, newColBlocks);
    }

    // Slash menu
    if (fieldName === 'text') {
      if (text === '/') {
        slashBlockId = blockId;
        slashFieldEl = fieldEl;
        const rect = fieldEl.getBoundingClientRect();
        slashMenu.show(rect, SLASH_ITEMS);
      } else if (text.startsWith('/') && slashBlockId === blockId) {
        slashMenu.filter(text.slice(1));
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
    const cursorOffset = getCursorOffset(fieldEl);
    const fullText = fieldEl.textContent;
    const beforeText = fullText.slice(0, cursorOffset);
    const afterText = fullText.slice(cursorOffset);

    if (context !== null) {
      // Sub-block inside a column
      const { columnsBlockId, colIndex, indexInCol } = context;
      const columnsBlock = state.getBlock(columnsBlockId);
      if (!columnsBlock) return;

      // Update current block text
      const updatedBlock = { ...block, data: { ...block.data, text: beforeText } };
      const newPara = makeBlock('paragraph', { text: afterText });

      const newColBlocks = [...columnsBlock.data.columns[colIndex]];
      newColBlocks[indexInCol] = updatedBlock;
      newColBlocks.splice(indexInCol + 1, 0, newPara);

      state.updateColumnBlock(columnsBlockId, colIndex, newColBlocks);

      // Re-render the columns block
      const updatedColumnsBlock = state.getBlock(columnsBlockId);
      renderer.updateBlock(updatedColumnsBlock);

      // Focus the new block
      focusBlock(newPara.id, 0);
    } else {
      // Top-level block
      // Update current block
      state.updateBlockData(block.id, { text: beforeText });
      // Create new paragraph
      const newPara = makeBlock('paragraph', { text: afterText });
      state.addBlock(newPara, block.id);
      renderer.insertBlock(newPara, block.id);

      // Update fieldEl text immediately (avoid re-render flicker)
      if (fieldEl.textContent !== beforeText) {
        fieldEl.textContent = beforeText;
      }

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
        const updatedBlock = { ...block, type: 'paragraph', data: { text: block.data.text || '' } };
        const newColBlocks = colBlocks.map((b, i) => i === indexInCol ? updatedBlock : b);
        state.updateColumnBlock(columnsBlockId, colIndex, newColBlocks);
        const updatedCols = state.getBlock(columnsBlockId);
        renderer.updateBlock(updatedCols);
        focusBlock(updatedBlock.id, 0);
        return;
      }

      // Merge with previous if prev has text field
      const prevPlugin = blockRegistry.get(prevBlock.type);
      const prevHasText = prevPlugin && prevBlock.data && typeof prevBlock.data.text === 'string';

      if (prevHasText) {
        const prevText = prevBlock.data.text;
        const mergedOffset = prevText.length;
        const updatedPrev = { ...prevBlock, data: { ...prevBlock.data, text: prevText + text } };
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
        const newBlock = makeBlock('paragraph', { text: block.data.text || '' });
        newBlock.id = block.id; // keep same id
        state.replaceBlock(block.id, newBlock);
        renderer.updateBlock(state.getBlock(block.id));
        focusBlock(newBlock.id, 0);
      }
      return;
    }

    // Non-paragraph type with text: convert to paragraph
    if (block.type !== 'paragraph' && text.length > 0) {
      const newBlock = { ...block, type: 'paragraph', data: { text: block.data.text || '' } };
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
    const prevHasText = prevPlugin && prevBlock.data && typeof prevBlock.data.text === 'string';

    if (prevHasText) {
      const prevText = prevBlock.data.text;
      const mergedOffset = prevText.length;
      state.updateBlockData(prevBlock.id, { text: prevText + text });
      state.removeBlock(block.id);
      renderer.removeBlock(block.id);

      // Update prev block in DOM to show merged text
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

  // ── Paste Handler ──────────────────────────────────────────────────────────

  function handlePaste(e) {
    const info = getFieldInfo(e.target);
    if (!info) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  // ── Slash Select ───────────────────────────────────────────────────────────

  function onSlashSelect(item) {
    if (!slashBlockId) return;

    const { block, context } = state.findBlockAnywhere(slashBlockId);
    if (!block) return;

    // Build new block data
    let newData;
    if (item.type === 'columns') {
      newData = {
        columns: [
          [makeBlock('paragraph', { text: '' })],
          [makeBlock('paragraph', { text: '' })],
        ],
      };
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

  function destroy() {
    root.removeEventListener('input', handleInput);
    root.removeEventListener('keydown', handleKeydown);
    root.removeEventListener('paste', handlePaste);
    slashMenu.destroy();
    root.remove();
  }

  return { getJSON, setJSON, getHTML, destroy };
}
