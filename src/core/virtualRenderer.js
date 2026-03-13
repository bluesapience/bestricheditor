/**
 * Virtualized renderer for Best Rich Editor.
 *
 * Presents the same interface as createRenderer() but only renders
 * visible ± OVERSCAN blocks. Spacer divs above/below maintain scroll height.
 * Per-block heights are cached after measurement.
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

  // Spacer elements maintain scroll height for off-screen blocks
  const topSpacer = document.createElement('div');
  topSpacer.className = 'bre-virt-spacer-top';

  const bottomSpacer = document.createElement('div');
  bottomSpacer.className = 'bre-virt-spacer-bottom';

  // Find the nearest scrollable ancestor (or window)
  function findScrollParent(el) {
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      if (/auto|scroll/.test(style.overflow + style.overflowY)) return node;
      node = node.parentElement;
    }
    return window;
  }

  function estimateHeight(id) {
    return heightCache.get(id) ?? DEFAULT_BLOCK_HEIGHT;
  }

  function measureBlock(id) {
    const el = blockMap.get(id);
    if (el) {
      const h = el.getBoundingClientRect().height;
      if (h > 0) heightCache.set(id, h);
    }
  }

  function calcTopHeight() {
    let h = 0;
    for (let i = 0; i < visibleStart; i++) {
      h += estimateHeight(blocks[i].id);
    }
    return h;
  }

  function calcBottomHeight() {
    let h = 0;
    for (let i = visibleEnd + 1; i < blocks.length; i++) {
      h += estimateHeight(blocks[i].id);
    }
    return h;
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

  // ── Window calculation ───────────────────────────────────────────────────

  function calcVisibleWindow() {
    const scrollParent = findScrollParent(container);
    let scrollTop, viewHeight;

    if (scrollParent === window) {
      scrollTop = window.scrollY;
      viewHeight = window.innerHeight;
    } else {
      scrollTop = scrollParent.scrollTop;
      viewHeight = scrollParent.clientHeight;
    }

    // Get container's offset from scroll origin
    const containerRect = container.getBoundingClientRect();
    const containerOffset = scrollParent === window
      ? containerRect.top + window.scrollY
      : containerRect.top + scrollParent.scrollTop;

    const viewTop = scrollTop - containerOffset;
    const viewBottom = viewTop + viewHeight;

    // Walk heights to find first/last visible block
    let cumHeight = 0;
    let newStart = 0;
    let newEnd = blocks.length - 1;

    for (let i = 0; i < blocks.length; i++) {
      const h = estimateHeight(blocks[i].id);
      if (cumHeight + h >= viewTop) {
        newStart = Math.max(0, i - OVERSCAN);
        break;
      }
      cumHeight += h;
    }

    cumHeight = 0;
    for (let i = 0; i < newStart; i++) cumHeight += estimateHeight(blocks[i].id);

    for (let i = newStart; i < blocks.length; i++) {
      cumHeight += estimateHeight(blocks[i].id);
      if (cumHeight >= viewBottom) {
        newEnd = Math.min(blocks.length - 1, i + OVERSCAN);
        break;
      }
    }

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

    // Add new blocks entering from the top — collect in a fragment to preserve order
    if (newStart < visibleStart) {
      const frag = document.createDocumentFragment();
      for (let i = newStart; i < visibleStart && i <= newEnd; i++) {
        const el = renderBlockEl(blocks[i]);
        blockMap.set(blocks[i].id, el);
        frag.appendChild(el);
        if (blocks[i].type === 'columns') registerSubBlocks(blocks[i]);
      }
      // Insert the whole fragment before the first currently-visible block
      container.insertBefore(frag, firstCurrentEl || bottomSpacer);
    }

    // Add new blocks entering from the bottom
    for (let i = Math.max(visibleEnd + 1, newStart); i <= newEnd; i++) {
      const el = renderBlockEl(blocks[i]);
      blockMap.set(blocks[i].id, el);
      container.insertBefore(el, bottomSpacer);
      if (blocks[i].type === 'columns') registerSubBlocks(blocks[i]);
    }

    visibleStart = newStart;
    visibleEnd = newEnd;
    updateSpacers();
  }

  // ── Scroll handler ───────────────────────────────────────────────────────

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

  let scrollParent = null;

  function attachScroll() {
    scrollParent = findScrollParent(container);
    scrollParent.addEventListener('scroll', onScroll, { passive: true });
  }

  function detachScroll() {
    if (scrollParent) {
      scrollParent.removeEventListener('scroll', onScroll);
      scrollParent = null;
    }
  }

  // Keep internal blocks array in sync with state (handles drag reorder, etc.)
  const unsubscribe = state.subscribe((doc) => {
    blocks = doc.blocks;
    updateSpacers();
  });

  // ── Public API (matches createRenderer interface) ─────────────────────────

  function renderAll(newBlocks) {
    detachScroll();
    blocks = newBlocks;
    blockMap.clear();
    heightCache.clear();
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

    for (let i = visibleStart; i <= visibleEnd; i++) {
      const el = renderBlockEl(blocks[i]);
      blockMap.set(blocks[i].id, el);
      container.insertBefore(el, bottomSpacer);
      if (blocks[i].type === 'columns') registerSubBlocks(blocks[i]);
    }

    topSpacer.style.height = '0px';
    bottomSpacer.style.height = calcBottomHeight() + 'px';

    attachScroll();
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
    // Find insert index
    const afterIdx = blocks.findIndex(b => b.id === afterId);
    const insertIdx = afterIdx === -1 ? blocks.length : afterIdx + 1;

    // State subscription will update blocks array; handle DOM here
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

    updateSpacers();
  }

  function removeBlock(id) {
    const el = blockMap.get(id);
    if (el) {
      el.parentNode && el.parentNode.removeChild(el);
      blockMap.delete(id);
      if (visibleEnd > visibleStart) visibleEnd--;
    }
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
