/**
 * Drag handle — pointer-event based block reordering for Best Rich Editor.
 */

/**
 * Initialize drag handle behavior.
 * @param {Element} root - editor root element
 * @param {object} state - editor state
 * @param {object} renderer - editor renderer
 */
export function initDragHandles(root, state, renderer) {
  let dragging = false;
  let dragBlockId = null;
  let dragStartY = 0;
  let dropLine = null;
  let targetIndex = -1;

  // Create the drop indicator line
  function createDropLine() {
    const line = document.createElement('div');
    line.className = 'bre-drop-line';
    line.style.display = 'none';
    root.appendChild(line);
    return line;
  }

  dropLine = createDropLine();

  /**
   * Get all top-level block elements in order.
   */
  function getTopLevelBlockEls() {
    return Array.from(root.querySelectorAll(':scope > .bre-block'));
  }

  /**
   * Find the block element from a handle element.
   */
  function getBlockElFromHandle(handleEl) {
    return handleEl.closest('[data-bre-block-id]');
  }

  /**
   * Get the block id from a block element.
   */
  function getBlockId(blockEl) {
    return blockEl.getAttribute('data-bre-block-id');
  }

  /**
   * Check if a block is a direct child of root (top-level).
   */
  function isTopLevel(blockEl) {
    return blockEl.parentElement === root;
  }

  /**
   * Calculate the drop index based on Y position.
   */
  function calcDropIndex(clientY) {
    const blockEls = getTopLevelBlockEls();
    for (let i = 0; i < blockEls.length; i++) {
      const rect = blockEls[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) return i;
    }
    return blockEls.length;
  }

  /**
   * Show the drop indicator at the given index.
   */
  function showDropLine(index) {
    const blockEls = getTopLevelBlockEls();
    dropLine.style.display = 'block';

    if (blockEls.length === 0) {
      dropLine.style.top = '0px';
      return;
    }

    if (index >= blockEls.length) {
      const last = blockEls[blockEls.length - 1];
      const rect = last.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      dropLine.style.top = `${rect.bottom - rootRect.top}px`;
    } else {
      const el = blockEls[index];
      const rect = el.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      dropLine.style.top = `${rect.top - rootRect.top}px`;
    }
  }

  root.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-bre-handle]');
    if (!handle) return;

    const blockEl = getBlockElFromHandle(handle);
    if (!blockEl) return;

    // Only handle top-level blocks
    if (!isTopLevel(blockEl)) return;

    e.preventDefault();

    dragging = true;
    dragBlockId = getBlockId(blockEl);
    dragStartY = e.clientY;

    // Capture pointer so we keep receiving events
    root.setPointerCapture(e.pointerId);

    blockEl.classList.add('bre-block--dragging');
    targetIndex = -1;
  });

  root.addEventListener('pointermove', (e) => {
    if (!dragging || !dragBlockId) return;

    const newIndex = calcDropIndex(e.clientY);
    targetIndex = newIndex;
    showDropLine(newIndex);
  });

  root.addEventListener('pointerup', (e) => {
    if (!dragging || !dragBlockId) return;

    dragging = false;
    dropLine.style.display = 'none';

    const blockEl = renderer.getBlockEl(dragBlockId);
    if (blockEl) blockEl.classList.remove('bre-block--dragging');

    const fromIndex = state.getBlockIndex(dragBlockId);
    if (fromIndex === -1 || targetIndex === -1) {
      dragBlockId = null;
      return;
    }

    // Calculate effective toIndex accounting for removal
    let toIndex = targetIndex;
    if (toIndex > fromIndex) toIndex--;

    if (toIndex !== fromIndex) {
      state.moveBlock(fromIndex, toIndex);
      // Full re-render preserves virtual renderer spacers and handles all cases cleanly.
      renderer.renderAll(state.getBlocks());
      root.appendChild(dropLine);
    }

    dragBlockId = null;
    targetIndex = -1;

    root.releasePointerCapture(e.pointerId);
  });

  root.addEventListener('pointercancel', (e) => {
    if (!dragging) return;
    dragging = false;
    dropLine.style.display = 'none';

    if (dragBlockId) {
      const blockEl = renderer.getBlockEl(dragBlockId);
      if (blockEl) blockEl.classList.remove('bre-block--dragging');
    }

    dragBlockId = null;
    targetIndex = -1;
    root.releasePointerCapture(e.pointerId);
  });
}
