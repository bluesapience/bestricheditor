/**
 * Plain (non-virtualized) DOM renderer.
 * Maintains a flat Map of blockId -> Element for all blocks including sub-blocks.
 */
import { createBlockEl, registerSubBlocks } from './blockEl.js';

export function createRenderer(container, ctx) {
  /** @type {Map<string, Element>} */
  const blockMap = new Map();

  function renderAll(blocks) {
    blockMap.clear();
    container.textContent = '';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const el = createBlockEl(block, ctx);
      blockMap.set(block.id, el);
      frag.appendChild(el);
      if (block.type === 'columns') registerSubBlocks(blockMap, el);
    }
    container.appendChild(frag);
  }

  function updateBlock(block) {
    const existing = blockMap.get(block.id);
    if (!existing || !existing.parentNode) return;
    const newEl = createBlockEl(block, ctx);
    existing.parentNode.replaceChild(newEl, existing);
    blockMap.set(block.id, newEl);
    if (block.type === 'columns') registerSubBlocks(blockMap, newEl);
  }

  /** Insert after the element for afterId, or append when afterId is null. */
  function insertBlock(block, afterId) {
    const el = createBlockEl(block, ctx);
    blockMap.set(block.id, el);
    const afterEl = afterId == null ? null : blockMap.get(afterId);
    if (afterEl && afterEl.parentNode) {
      afterEl.parentNode.insertBefore(el, afterEl.nextSibling);
    } else {
      container.appendChild(el);
    }
    if (block.type === 'columns') registerSubBlocks(blockMap, el);
  }

  function removeBlock(id) {
    const el = blockMap.get(id);
    if (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
      blockMap.delete(id);
    }
  }

  function getBlockEl(id) {
    return blockMap.get(id) || null;
  }

  function destroy() {
    blockMap.clear();
    container.textContent = '';
  }

  return { renderAll, updateBlock, insertBlock, removeBlock, getBlockEl, destroy };
}
