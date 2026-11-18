/**
 * Document state factory for Best Rich Editor.
 *
 * Immutable-style: blocks and block.data objects are never mutated in place, so
 * snapshots can share structure. That makes undo/redo snapshots O(1) (a
 * reference to the previous blocks array) instead of a JSON deep copy, and lets
 * the renderer diff by identity (`oldBlock !== newBlock`).
 *
 * Hot path (typing) cost is O(1) lookup + one shallow array copy (a memcpy-
 * speed slice), independent of block size. The id→index map is rebuilt lazily
 * and only after structural changes (add / remove / move / setDoc).
 */
import { generateId } from '../utils/id.js';
import { migrateDocument, CURRENT_VERSION } from './migrate.js';

const MAX_HISTORY = 100;

function makeDoc(blocks = []) {
  const now = Date.now();
  return { id: generateId(), version: CURRENT_VERSION, created: now, updated: now, blocks };
}

export function createState(initialDoc) {
  let doc = initialDoc ? migrateDocument(initialDoc) : makeDoc();
  const subscribers = new Set();

  let undoStack = [];
  let redoStack = [];

  // id → index cache for top-level blocks. null = dirty.
  let indexMap = null;

  function ensureIndex() {
    if (indexMap) return indexMap;
    indexMap = new Map();
    const blocks = doc.blocks;
    for (let i = 0; i < blocks.length; i++) indexMap.set(blocks[i].id, i);
    return indexMap;
  }

  function structural() {
    indexMap = null;
  }

  function notify() {
    for (const fn of subscribers) fn(doc);
  }

  function commit(blocks, { isStructural = false, silent = false } = {}) {
    if (isStructural) structural();
    doc = { ...doc, updated: Date.now(), blocks };
    if (!silent) notify();
  }

  // ── History (reference snapshots) ──────────────────────────────────────────

  function saveUndoSnapshot() {
    // Nothing changed since the last snapshot (no-op key presses): don't push a
    // duplicate or wipe the redo stack.
    if (undoStack.length && undoStack[undoStack.length - 1] === doc.blocks) return;
    undoStack.push(doc.blocks);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (undoStack.length === 0) return false;
    redoStack.push(doc.blocks);
    if (redoStack.length > MAX_HISTORY) redoStack.shift();
    structural();
    doc = { ...doc, blocks: undoStack.pop(), updated: Date.now() };
    notify();
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    undoStack.push(doc.blocks);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    structural();
    doc = { ...doc, blocks: redoStack.pop(), updated: Date.now() };
    notify();
    return true;
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  // ── Reads ──────────────────────────────────────────────────────────────────

  function getDoc() { return doc; }
  function getBlocks() { return doc.blocks; }

  function getBlockIndex(id) {
    const i = ensureIndex().get(id);
    return i === undefined ? -1 : i;
  }

  function getBlock(id) {
    const i = getBlockIndex(id);
    return i === -1 ? null : doc.blocks[i];
  }

  /**
   * Search top-level blocks AND within columns data.columns arrays.
   * Returns { block, context: null | { columnsBlockId, colIndex, indexInCol } }
   */
  function findBlockAnywhere(id) {
    const idx = getBlockIndex(id);
    if (idx !== -1) return { block: doc.blocks[idx], context: null };

    for (const colBlock of doc.blocks) {
      if (colBlock.type !== 'columns') continue;
      const cols = colBlock.data && colBlock.data.columns;
      if (!Array.isArray(cols)) continue;
      for (let colIndex = 0; colIndex < cols.length; colIndex++) {
        const col = cols[colIndex];
        if (!Array.isArray(col)) continue;
        for (let indexInCol = 0; indexInCol < col.length; indexInCol++) {
          if (col[indexInCol].id === id) {
            return {
              block: col[indexInCol],
              context: { columnsBlockId: colBlock.id, colIndex, indexInCol },
            };
          }
        }
      }
    }
    return { block: null, context: null };
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  function addBlock(block, afterId) {
    const idx = afterId == null ? -1 : getBlockIndex(afterId);
    const blocks = doc.blocks.slice();
    if (idx === -1) blocks.push(block);
    else blocks.splice(idx + 1, 0, block);
    commit(blocks, { isStructural: true });
  }

  /** Merge partial data into a top-level block's data. */
  function updateBlockData(id, partialData, opts) {
    const idx = getBlockIndex(id);
    if (idx === -1) return;
    const old = doc.blocks[idx];
    const blocks = doc.blocks.slice();
    blocks[idx] = { ...old, data: { ...old.data, ...partialData } };
    commit(blocks, opts);
  }

  function replaceBlock(id, newBlock) {
    const idx = getBlockIndex(id);
    if (idx === -1) return;
    const blocks = doc.blocks.slice();
    blocks[idx] = newBlock;
    // id may change; keep the cache honest.
    commit(blocks, { isStructural: newBlock.id !== id });
  }

  function removeBlock(id) {
    const idx = getBlockIndex(id);
    if (idx === -1) return;
    const blocks = doc.blocks.slice();
    blocks.splice(idx, 1);
    commit(blocks, { isStructural: true });
  }

  function moveBlock(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const blocks = doc.blocks.slice();
    const [moved] = blocks.splice(fromIndex, 1);
    blocks.splice(toIndex, 0, moved);
    commit(blocks, { isStructural: true });
  }

  /** Insert several blocks after afterId in one commit (paste / upload). */
  function insertBlocks(newBlocks, afterId) {
    if (!newBlocks.length) return;
    const idx = afterId == null ? -1 : getBlockIndex(afterId);
    const blocks = doc.blocks.slice();
    if (idx === -1) blocks.push(...newBlocks);
    else blocks.splice(idx + 1, 0, ...newBlocks);
    commit(blocks, { isStructural: true });
  }

  /** Load a full document. Migrates old versions, clears history. */
  function setDoc(newDoc) {
    doc = migrateDocument(newDoc);
    structural();
    undoStack = [];
    redoStack = [];
    notify();
  }

  function updateColumnBlock(columnsBlockId, colIndex, colBlocks, opts) {
    const idx = getBlockIndex(columnsBlockId);
    if (idx === -1) return;
    const b = doc.blocks[idx];
    const columns = b.data.columns.slice();
    columns[colIndex] = colBlocks;
    const blocks = doc.blocks.slice();
    blocks[idx] = { ...b, data: { ...b.data, columns } };
    commit(blocks, opts);
  }

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
    insertBlocks,
    updateBlockData,
    replaceBlock,
    removeBlock,
    moveBlock,
    setDoc,
    updateColumnBlock,
    subscribe,
    saveUndoSnapshot,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
