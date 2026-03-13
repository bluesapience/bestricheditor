/**
 * Virtualized renderer for Best Rich Editor.
 *
 * Presents the same interface as createRenderer() but only renders
 * visible ± OVERSCAN blocks. Spacer divs above/below maintain scroll height.
 * Per-block heights are cached after measurement.
 *
 * Performance design:
 *  - Prefix sum array (Float64Array) gives O(1) spacer heights and O(log n)
 *    binary-search window finding. Rebuilt lazily when any height changes.
 *  - containerOffset is cached, only refreshed on resize → no getBoundingClientRect
 *    on scroll frames.
 *  - scrollParent is resolved once at attach time.
 *  - Both top- and bottom-entering blocks batched into DocumentFragments.
 *  - renderAll uses one DocumentFragment for the initial paint.
 *  - Heights measured after first paint so spacers are accurate from the start.
 *  - State subscriber only calls updateSpacers on block-count changes (not keystrokes).
 *
 * Usage: createVirtualRenderer(container, state)
 */
import { blockRegistry } from './blockRegistry.js';

const OVERSCAN = 30;
const DEFAULT_BLOCK_HEIGHT = 56; // px estimate for unrendered blocks

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

function createDragHandle() {
  const handle = document.createElement('div');
  handle.className = 'bre-drag-handle';
  handle.setAttribute('data-bre-handle', '');
  handle.setAttribute('aria-hidden', 'true');
  handle.innerHTML = DRAG_HANDLE_SVG;
  return handle;
}

function createBlockWrapper(block, contentEl) {
  const wrapper = document.createElement('div');
  wrapper.className = `bre-block bre-block--${block.type}`;
  wrapper.setAttribute('data-bre-block-id', block.id);
  wrapper.appendChild(createDragHandle());
  wrapper.appendChild(contentEl);
  return wrapper;
}

export function createVirtualRenderer(container, state) {
  /** @type {Map<string, Element>} blockId → DOM element (visible blocks only) */
  const blockMap = new Map();

  /** @type {Map<string, number>} blockId → measured height in px */
  const heightCache = new Map();

  /** @type {Array<{id: string, type: string, data: object}>} */
  let blocks = [];

  let visibleStart = 0;
  let visibleEnd = -1;
  let rafPending = false;

  // Cached layout values — refreshed once at attach time and on resize.
  let scrollParent = null;
  let cachedContainerOffset = 0;

  // ── Prefix sum ──────────────────────────────────────────────────────────
  // prefixSums[i] = total height of blocks[0..i-1].
  // null means dirty — rebuilt lazily on next access via buildPrefixSums().
  // This makes calcTopHeight / calcBottomHeight O(1) and calcVisibleWindow
  // O(log n) (binary search) instead of O(n) linear scans.
  /** @type {Float64Array|null} */
  let prefixSums = null;

  function invalidatePrefix() {
    prefixSums = null;
  }

  function buildPrefixSums() {
    if (prefixSums !== null) return;
    const len = blocks.length;
    prefixSums = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) {
      prefixSums[i + 1] = prefixSums[i] + estimateHeight(blocks[i].id);
    }
  }

  // Spacer elements maintain scroll height for off-screen blocks
  const topSpacer = document.createElement('div');
  topSpacer.className = 'bre-virt-spacer-top';

  const bottomSpacer = document.createElement('div');
  bottomSpacer.className = 'bre-virt-spacer-bottom';

  // Find the nearest scrollable ancestor (or window). Called once at attach.
  function findScrollParent(el) {
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      if (/auto|scroll/.test(style.overflow + style.overflowY)) return node;
      node = node.parentElement;
    }
    return window;
  }

  function refreshContainerOffset() {
    if (!scrollParent) return;
    const rect = container.getBoundingClientRect();
    cachedContainerOffset = scrollParent === window
      ? rect.top + window.scrollY
      : rect.top + scrollParent.scrollTop;
  }

  function estimateHeight(id) {
    return heightCache.get(id) ?? DEFAULT_BLOCK_HEIGHT;
  }

  function measureBlock(id) {
    const el = blockMap.get(id);
    if (el) {
      const h = el.getBoundingClientRect().height;
      // Only invalidate prefix when height actually changed
      if (h > 0 && heightCache.get(id) !== h) {
        heightCache.set(id, h);
        invalidatePrefix();
      }
    }
  }

  /** Measure all currently-visible blocks and update spacers. */
  function measureVisibleAndUpdateSpacers() {
    for (let i = visibleStart; i <= visibleEnd; i++) {
      measureBlock(blocks[i].id);
    }
    updateSpacers();
  }

  // O(1) after prefix build
  function calcTopHeight() {
    buildPrefixSums();
    return prefixSums[visibleStart];
  }

  // O(1) after prefix build
  function calcBottomHeight() {
    buildPrefixSums();
    return prefixSums[blocks.length] - prefixSums[visibleEnd + 1];
  }

  function updateSpacers() {
    topSpacer.style.height = calcTopHeight() + 'px';
    bottomSpacer.style.height = calcBottomHeight() + 'px';
  }

  function renderBlockEl(block) {
    const plugin = blockRegistry.get(block.type);
    const contentEl = plugin.render(block);
    return createBlockWrapper(block, contentEl);
  }

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

  // ── Window calculation (O(log n) binary search) ───────────────────────────
  // Uses cached scrollParent + containerOffset — zero DOM reads per scroll frame
  // after the prefix sum is built.

  function calcVisibleWindow() {
    buildPrefixSums();

    let scrollTop, viewHeight;
    if (scrollParent === window) {
      scrollTop = window.scrollY;
      viewHeight = window.innerHeight;
    } else {
      scrollTop = scrollParent.scrollTop;
      viewHeight = scrollParent.clientHeight;
    }

    const viewTop = scrollTop - cachedContainerOffset;
    const viewBottom = viewTop + viewHeight;
    const n = blocks.length;

    // Binary search: first block whose bottom edge reaches viewTop
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (prefixSums[mid + 1] < viewTop) lo = mid + 1;
      else hi = mid;
    }
    const newStart = Math.max(0, lo - OVERSCAN);

    // Binary search: first block whose bottom edge reaches viewBottom
    lo = 0; hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (prefixSums[mid + 1] < viewBottom) lo = mid + 1;
      else hi = mid;
    }
    const newEnd = Math.min(n - 1, lo + OVERSCAN);

    return { newStart, newEnd };
  }

  // ── Reconcile ────────────────────────────────────────────────────────────

  function reconcile(newStart, newEnd) {
    if (newStart === visibleStart && newEnd === visibleEnd) return;

    // Capture the first currently-visible element BEFORE any removals
    const firstCurrentEl = visibleStart <= visibleEnd && blocks[visibleStart]
      ? blockMap.get(blocks[visibleStart].id)
      : null;

    // Measure + remove blocks scrolling out of view at top
    for (let i = visibleStart; i < newStart && i <= visibleEnd; i++) {
      measureBlock(blocks[i].id);
      const el = blockMap.get(blocks[i].id);
      if (el) { el.parentNode && el.parentNode.removeChild(el); blockMap.delete(blocks[i].id); }
    }

    // Measure + remove blocks scrolling out of view at bottom
    for (let i = Math.max(newEnd + 1, visibleStart); i <= visibleEnd; i++) {
      measureBlock(blocks[i].id);
      const el = blockMap.get(blocks[i].id);
      if (el) { el.parentNode && el.parentNode.removeChild(el); blockMap.delete(blocks[i].id); }
    }

    // Add new blocks entering from the top — batch in a fragment to preserve order
    if (newStart < visibleStart) {
      const frag = document.createDocumentFragment();
      for (let i = newStart; i < visibleStart && i <= newEnd; i++) {
        const el = renderBlockEl(blocks[i]);
        blockMap.set(blocks[i].id, el);
        frag.appendChild(el);
        if (blocks[i].type === 'columns') registerSubBlocks(blocks[i]);
      }
      container.insertBefore(frag, firstCurrentEl || bottomSpacer);
    }

    // Add new blocks entering from the bottom — batch in a fragment
    if (newEnd > visibleEnd) {
      const frag = document.createDocumentFragment();
      for (let i = Math.max(visibleEnd + 1, newStart); i <= newEnd; i++) {
        const el = renderBlockEl(blocks[i]);
        blockMap.set(blocks[i].id, el);
        frag.appendChild(el);
        if (blocks[i].type === 'columns') registerSubBlocks(blocks[i]);
      }
      container.insertBefore(frag, bottomSpacer);
    }

    visibleStart = newStart;
    visibleEnd = newEnd;
    updateSpacers();
  }

  // ── Scroll + Resize handlers ──────────────────────────────────────────────

  function onScroll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (blocks.length === 0) return;
      const { newStart, newEnd } = calcVisibleWindow();
      reconcile(newStart, newEnd);
    });
  }

  function onWindowResize() {
    refreshContainerOffset();
    if (blocks.length > 0) onScroll();
  }

  function attachScroll() {
    scrollParent = findScrollParent(container);
    refreshContainerOffset();
    scrollParent.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onWindowResize, { passive: true });
  }

  function detachScroll() {
    if (scrollParent) {
      scrollParent.removeEventListener('scroll', onScroll);
      scrollParent = null;
    }
    window.removeEventListener('resize', onWindowResize);
  }

  // Keep internal blocks array in sync (drag reorder, insert, delete).
  // Only updateSpacers when block count changes — not on every keystroke.
  let prevBlockCount = 0;
  const unsubscribe = state.subscribe((doc) => {
    const countChanged = doc.blocks.length !== prevBlockCount;
    blocks = doc.blocks;
    invalidatePrefix(); // block list or order may have changed
    if (countChanged) {
      prevBlockCount = blocks.length;
      updateSpacers();
    }
  });

  // ── Public API (matches createRenderer interface) ─────────────────────────

  function renderAll(newBlocks) {
    detachScroll();
    blocks = newBlocks;
    prevBlockCount = blocks.length;
    blockMap.clear();
    heightCache.clear();
    invalidatePrefix();
    container.innerHTML = '';
    container.appendChild(topSpacer);
    container.appendChild(bottomSpacer);

    if (blocks.length === 0) {
      visibleStart = 0;
      visibleEnd = -1;
      updateSpacers();
      attachScroll();
      return;
    }

    // Initial window: first 2×OVERSCAN blocks
    visibleStart = 0;
    visibleEnd = Math.min(blocks.length - 1, OVERSCAN * 2);

    // Single DocumentFragment — one DOM write for all initial blocks
    const frag = document.createDocumentFragment();
    for (let i = visibleStart; i <= visibleEnd; i++) {
      const el = renderBlockEl(blocks[i]);
      blockMap.set(blocks[i].id, el);
      frag.appendChild(el);
      if (blocks[i].type === 'columns') registerSubBlocks(blocks[i]);
    }
    container.insertBefore(frag, bottomSpacer);

    topSpacer.style.height = '0px';
    bottomSpacer.style.height = calcBottomHeight() + 'px';

    attachScroll();

    // Measure actual heights after first paint — corrects spacer estimates.
    requestAnimationFrame(() => {
      if (blocks.length > 0) measureVisibleAndUpdateSpacers();
    });
  }

  function updateBlock(block) {
    const existing = blockMap.get(block.id);
    if (!existing) return; // outside visible window — state already updated

    const newEl = renderBlockEl(block);
    existing.parentNode.replaceChild(newEl, existing);
    blockMap.set(block.id, newEl);

    if (block.type === 'columns') registerSubBlocks(block);
  }

  function insertBlock(block, afterId) {
    const afterIdx = blocks.findIndex(b => b.id === afterId);
    const insertIdx = afterIdx === -1 ? blocks.length : afterIdx + 1;

    if (insertIdx >= visibleStart && insertIdx <= visibleEnd + 1) {
      const el = renderBlockEl(block);
      blockMap.set(block.id, el);

      const afterEl = afterId ? blockMap.get(afterId) : null;
      if (afterEl && afterEl.parentNode) {
        afterEl.parentNode.insertBefore(el, afterEl.nextSibling);
      } else {
        container.insertBefore(el, bottomSpacer);
      }

      visibleEnd = Math.min(visibleEnd + 1, blocks.length - 1);
      if (block.type === 'columns') registerSubBlocks(block);
    }

    invalidatePrefix();
    updateSpacers();
  }

  function removeBlock(id) {
    const el = blockMap.get(id);
    if (el) {
      el.parentNode && el.parentNode.removeChild(el);
      blockMap.delete(id);
      if (visibleEnd > visibleStart) visibleEnd--;
    }
    invalidatePrefix();
    updateSpacers();
  }

  function getBlockEl(id) {
    return blockMap.get(id) || null;
  }

  function destroy() {
    detachScroll();
    unsubscribe();
  }

  return {
    renderAll,
    updateBlock,
    insertBlock,
    removeBlock,
    getBlockEl,
    registerSubBlocks,
    destroy,
  };
}
