/**
 * Efficient DOM renderer for Best Rich Editor.
 * Maintains a flat Map of blockId -> Element for all blocks including sub-blocks.
 */
import { blockRegistry } from './blockRegistry.js';

const DRAG_HANDLE_SVG = `<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="3" cy="2" r="1.5"/>
  <circle cx="7" cy="2" r="1.5"/>
  <circle cx="3" cy="6" r="1.5"/>
  <circle cx="7" cy="6" r="1.5"/>
  <circle cx="3" cy="10" r="1.5"/>
  <circle cx="7" cy="10" r="1.5"/>
  <circle cx="3" cy="14" r="1.5"/>
  <circle cx="7" cy="14" r="1.5"/>
</svg>`;

/**
 * Create the drag handle element.
 */
function createDragHandle() {
  const handle = document.createElement('div');
  handle.className = 'bre-drag-handle';
  handle.setAttribute('data-bre-handle', '');
  handle.setAttribute('aria-hidden', 'true');
  handle.innerHTML = DRAG_HANDLE_SVG;
  return handle;
}

/**
 * Wrap a block's rendered content in the standard block wrapper.
 */
function createBlockWrapper(block, contentEl) {
  const wrapper = document.createElement('div');
  wrapper.className = `bre-block bre-block--${block.type}`;
  wrapper.setAttribute('data-bre-block-id', block.id);
  wrapper.appendChild(createDragHandle());
  wrapper.appendChild(contentEl);
  return wrapper;
}

export function createRenderer(container) {
  /** @type {Map<string, Element>} */
  const blockMap = new Map();

  /**
   * Render a single block to an Element using the block's plugin.
   */
  function renderBlockEl(block) {
    const plugin = blockRegistry.get(block.type);
    const contentEl = plugin.render(block);
    return createBlockWrapper(block, contentEl);
  }

  /**
   * Register sub-blocks of a columns block in the flat map.
   * Crawls data.columns and finds elements with data-bre-block-id.
   */
  function registerSubBlocks(columnsBlock) {
    const cols = columnsBlock.data && columnsBlock.data.columns;
    if (!Array.isArray(cols)) return;
    for (const col of cols) {
      if (!Array.isArray(col)) continue;
      for (const subBlock of col) {
        const el = container.querySelector(`[data-bre-block-id="${subBlock.id}"]`);
        if (el) blockMap.set(subBlock.id, el);
      }
    }
  }

  /**
   * Full render — clears container, renders all blocks using a document fragment.
   */
  function renderAll(blocks) {
    // Clear existing
    blockMap.clear();
    container.innerHTML = '';

    const frag = document.createDocumentFragment();
    for (const block of blocks) {
      const el = renderBlockEl(block);
      blockMap.set(block.id, el);
      frag.appendChild(el);
    }
    container.appendChild(frag);

    // Register sub-blocks for columns
    for (const block of blocks) {
      if (block.type === 'columns') {
        registerSubBlocks(block);
      }
    }
  }

  /**
   * Re-render a single block, replacing its existing element.
   */
  function updateBlock(block) {
    const existing = blockMap.get(block.id);
    if (!existing) return;

    const newEl = renderBlockEl(block);
    existing.parentNode.replaceChild(newEl, existing);
    blockMap.set(block.id, newEl);

    // If columns, re-register sub-blocks
    if (block.type === 'columns') {
      registerSubBlocks(block);
    }
  }

  /**
   * Insert a new block element after the element with afterId.
   * If afterId is null, append to container.
   */
  function insertBlock(block, afterId) {
    const el = renderBlockEl(block);
    blockMap.set(block.id, el);

    if (afterId == null) {
      container.appendChild(el);
    } else {
      const afterEl = blockMap.get(afterId);
      if (afterEl && afterEl.parentNode) {
        afterEl.parentNode.insertBefore(el, afterEl.nextSibling);
      } else {
        container.appendChild(el);
      }
    }

    if (block.type === 'columns') {
      registerSubBlocks(block);
    }
  }

  /**
   * Remove a block element from DOM and map.
   */
  function removeBlock(id) {
    const el = blockMap.get(id);
    if (el) {
      el.parentNode && el.parentNode.removeChild(el);
      blockMap.delete(id);
    }
  }

  /**
   * Get the element for a block by id.
   */
  function getBlockEl(id) {
    return blockMap.get(id) || null;
  }

  return {
    renderAll,
    updateBlock,
    insertBlock,
    removeBlock,
    getBlockEl,
    registerSubBlocks,
  };
}
