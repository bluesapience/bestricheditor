/**
 * Document state factory for Best Rich Editor.
 * Immutable-style state — never mutates arrays in place.
 */
import { generateId } from '../utils/id.js';

function makeDoc(blocks = []) {
  return {
    id: generateId(),
    version: 1,
    created: Date.now(),
    updated: Date.now(),
    blocks,
  };
}

export function createState(initialDoc) {
  let doc = initialDoc ? { ...initialDoc } : makeDoc();
  const subscribers = new Set();

  function notify() {
    for (const fn of subscribers) fn(doc);
  }

  function getDoc() {
    return doc;
  }

  function getBlocks() {
    return doc.blocks;
  }

  function getBlock(id) {
    return doc.blocks.find(b => b.id === id) || null;
  }

  function getBlockIndex(id) {
    return doc.blocks.findIndex(b => b.id === id);
  }

  /**
   * Search top-level blocks AND within columns data.columns arrays.
   * Returns { block, context: null | { columnsBlockId, colIndex, indexInCol } }
   */
  function findBlockAnywhere(id) {
    // Check top-level first
    const topLevel = doc.blocks.find(b => b.id === id);
    if (topLevel) {
      return { block: topLevel, context: null };
    }

    // Search within columns blocks
    for (const colBlock of doc.blocks) {
      if (colBlock.type !== 'columns') continue;
      const cols = colBlock.data && colBlock.data.columns;
      if (!Array.isArray(cols)) continue;
      for (let colIndex = 0; colIndex < cols.length; colIndex++) {
        const col = cols[colIndex];
        if (!Array.isArray(col)) continue;
        const indexInCol = col.findIndex(b => b.id === id);
        if (indexInCol !== -1) {
          return {
            block: col[indexInCol],
            context: {
              columnsBlockId: colBlock.id,
              colIndex,
              indexInCol,
            },
          };
        }
      }
    }

    return { block: null, context: null };
  }

  /**
   * Add a block to the end or after the specified block id.
   */
  function addBlock(block, afterId) {
    let blocks;
    if (afterId == null) {
      blocks = [...doc.blocks, block];
    } else {
      const idx = doc.blocks.findIndex(b => b.id === afterId);
      if (idx === -1) {
        blocks = [...doc.blocks, block];
      } else {
        blocks = [
          ...doc.blocks.slice(0, idx + 1),
          block,
          ...doc.blocks.slice(idx + 1),
        ];
      }
    }
    doc = { ...doc, updated: Date.now(), blocks };
    notify();
  }

  /**
   * Merge partial data into a top-level block's data.
   */
  function updateBlockData(id, partialData) {
    const blocks = doc.blocks.map(b => {
      if (b.id !== id) return b;
      return { ...b, data: { ...b.data, ...partialData } };
    });
    doc = { ...doc, updated: Date.now(), blocks };
    notify();
  }

  /**
   * Replace an entire top-level block.
   */
  function replaceBlock(id, newBlock) {
    const blocks = doc.blocks.map(b => b.id === id ? newBlock : b);
    doc = { ...doc, updated: Date.now(), blocks };
    notify();
  }

  /**
   * Remove a top-level block by id.
   */
  function removeBlock(id) {
    const blocks = doc.blocks.filter(b => b.id !== id);
    doc = { ...doc, updated: Date.now(), blocks };
    notify();
  }

  /**
   * Reorder top-level blocks by moving fromIndex to toIndex.
   */
  function moveBlock(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const blocks = [...doc.blocks];
    const [moved] = blocks.splice(fromIndex, 1);
    blocks.splice(toIndex, 0, moved);
    doc = { ...doc, updated: Date.now(), blocks };
    notify();
  }

  /**
   * Load a full document into state.
   */
  function setDoc(newDoc) {
    doc = { ...newDoc };
    notify();
  }

  /**
   * Update one column's blocks array within a columns block.
   */
  function updateColumnBlock(columnsBlockId, colIndex, colBlocks) {
    const blocks = doc.blocks.map(b => {
      if (b.id !== columnsBlockId) return b;
      const newColumns = b.data.columns.map((col, i) =>
        i === colIndex ? colBlocks : col
      );
      return { ...b, data: { ...b.data, columns: newColumns } };
    });
    doc = { ...doc, updated: Date.now(), blocks };
    notify();
  }

  /**
   * Subscribe to state changes. Returns unsubscribe function.
   */
  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return {
    getDoc,
    getBlocks,
    getBlock,
    getBlockIndex,
    findBlockAnywhere,
    addBlock,
    updateBlockData,
    replaceBlock,
    removeBlock,
    moveBlock,
    setDoc,
    updateColumnBlock,
    subscribe,
  };
}
