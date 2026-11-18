/**
 * Block drag-and-drop for Best Rich Editor.
 *
 * A SINGLE handle element is shared by all blocks (instead of 1 handle + SVG
 * per block): it is repositioned onto the hovered / focused top-level block.
 * That removes ~10 DOM nodes per block.
 *
 * Pointer events cover mouse, pen and touch (the handle sets touch-action:none).
 * Keyboard alternative: Alt+Shift+ArrowUp / ArrowDown moves the current block.
 */

/**
 * @param {Element} root       editor root (positioned ancestor of handle/drop line)
 * @param {Element} content    element that directly contains the block wrappers
 * @param {object}  state
 * @param {object}  renderer
 * @param {{ messages: object, isReadOnly: () => boolean, onMove: (info) => void }} hooks
 */
export function initDragHandles(root, content, state, renderer, hooks) {
  const { messages, isReadOnly, onMove, onHandleClick } = hooks;

  const handle = document.createElement('div');
  handle.className = 'bre-drag-handle';
  handle.setAttribute('data-bre-handle', '');
  handle.setAttribute('aria-hidden', 'true');
  handle.setAttribute('title', messages.dragHandle);
  handle.hidden = true;
  handle.textContent = '⋮⋮'; // ⋮⋮ — one text node
  root.appendChild(handle);

  const dropLine = document.createElement('div');
  dropLine.className = 'bre-drop-line';
  dropLine.hidden = true;
  root.appendChild(dropLine);

  let hoveredEl = null; // top-level .bre-block currently under the handle
  let dragging = false;
  let dragBlockId = null;
  let targetIndex = -1;
  let lastClientY = 0;
  let pending = null; // pointerdown on the handle, not yet a drag
  const DRAG_THRESHOLD = 4; // px of movement before a press becomes a drag

  /** Climb from any node to its top-level block wrapper. */
  function topLevelBlock(node) {
    let el = node && node.closest ? node.closest('.bre-block') : null;
    while (el && el.parentElement !== content) {
      el = el.parentElement ? el.parentElement.closest('.bre-block') : null;
    }
    return el;
  }

  function place(el) {
    // While a press is pending/dragging the browser captures the pointer on the
    // root and fires hover events aimed at it; those must not hide the handle.
    if (el === hoveredEl || dragging || pending) return;
    hoveredEl = el;
    if (!el || isReadOnly()) {
      handle.hidden = true;
      return;
    }
    handle.hidden = false;
    // offsetTop is relative to the shared positioned ancestor (root).
    handle.style.top = el.offsetTop + 'px';
  }

  function onPointerOver(e) {
    if (dragging || e.target === handle) return;
    place(topLevelBlock(e.target));
  }

  function onFocusIn(e) {
    place(topLevelBlock(e.target));
  }

  function onPointerLeave() {
    if (dragging) return;
    // Keep the handle on the focused block if focus is inside the editor.
    const active = document.activeElement;
    const focusedBlock = active && root.contains(active) ? topLevelBlock(active) : null;
    place(focusedBlock);
  }

  // ── Drop-index maths ────────────────────────────────────────────────────

  function blockEls() {
    return content.querySelectorAll(':scope > .bre-block');
  }

  function calcDropIndex(clientY) {
    const els = blockEls();
    // Binary search on block midpoints (blocks are in document order).
    let lo = 0;
    let hi = els.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const r = els[mid].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  function showDropLine(index) {
    const els = blockEls();
    dropLine.hidden = false;
    if (els.length === 0) {
      dropLine.style.top = '0px';
      return;
    }
    const target = index >= els.length ? els[els.length - 1] : els[index];
    const y = index >= els.length ? target.offsetTop + target.offsetHeight : target.offsetTop;
    dropLine.style.top = y + 'px';
  }

  // ── Pointer drag ────────────────────────────────────────────────────────

  function onPointerDown(e) {
    const h = e.target.closest('[data-bre-handle]');
    if (!h || !hoveredEl || isReadOnly()) return;
    e.preventDefault();
    // A press only becomes a drag after moving; a plain click opens the block menu.
    pending = {
      id: hoveredEl.getAttribute('data-bre-block-id'),
      x: e.clientX,
      y: e.clientY,
      rect: handle.getBoundingClientRect(), // measured while the handle is certainly visible
    };
    try { root.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }

  function startDrag() {
    dragging = true;
    dragBlockId = pending.id;
    targetIndex = -1;
    pending = null;
    if (hoveredEl) hoveredEl.setAttribute('data-bre-dragging', '');
  }

  function onPointerMove(e) {
    if (pending && !dragging) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < DRAG_THRESHOLD) return;
      startDrag();
    }
    if (!dragging) return;
    lastClientY = e.clientY;
    targetIndex = calcDropIndex(lastClientY);
    showDropLine(targetIndex);
  }

  function endDrag(e, commit) {
    if (!dragging) return;
    dragging = false;
    dropLine.hidden = true;
    const dragEl = renderer.getBlockEl(dragBlockId);
    if (dragEl) dragEl.removeAttribute('data-bre-dragging');
    const id = dragBlockId;
    const target = targetIndex;
    dragBlockId = null;
    targetIndex = -1;
    try { root.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    if (!commit || target === -1) return;
    const from = state.getBlockIndex(id);
    if (from === -1) return;
    // target is an index among RENDERED blocks; offset into the full document
    // (non-zero when virtualized and scrolled).
    let to = target + (renderer.firstRenderedIndex ? renderer.firstRenderedIndex() : 0);
    if (to > from) to--;
    if (to === from) return;
    state.saveUndoSnapshot();
    state.moveBlock(from, to);
    renderer.refresh(state.getBlocks());
    hoveredEl = null;
    handle.hidden = true;
    onMove({ blockId: id, from, to });
  }

  function onPointerUp(e) {
    if (pending && !dragging) {
      const { id, rect } = pending;
      pending = null;
      try { root.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      // Notion-style: the menu opens just to the right of the handle, level with it.
      const anchorRect = { top: rect.top, bottom: rect.top, left: rect.right + 4, right: rect.right + 4 };
      if (onHandleClick) onHandleClick({ blockId: id, anchorRect });
      return;
    }
    endDrag(e, true);
  }
  function onPointerCancel(e) {
    pending = null;
    endDrag(e, false);
  }

  // ── Keyboard alternative ────────────────────────────────────────────────

  function onKeyDown(e) {
    if (!(e.altKey && e.shiftKey) || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if (isReadOnly()) return;
    const blockEl = topLevelBlock(e.target);
    if (!blockEl) return;
    e.preventDefault();
    const id = blockEl.getAttribute('data-bre-block-id');
    const from = state.getBlockIndex(id);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (from === -1 || to < 0 || to >= state.getBlocks().length) return;
    state.saveUndoSnapshot();
    state.moveBlock(from, to);
    renderer.refresh(state.getBlocks());
    // Restore focus to the moved block.
    const el = renderer.getBlockEl(id);
    const field = el && el.querySelector('[data-bre-field]');
    if (field) field.focus();
    hoveredEl = null;
    place(el ? topLevelBlock(el) : null);
    onMove({ blockId: id, from, to });
  }

  root.addEventListener('pointerover', onPointerOver);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('pointerleave', onPointerLeave);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('keydown', onKeyDown);

  return {
    /** Re-sync after content changes the layout (undo, paste, readOnly toggle). */
    refresh() {
      hoveredEl = null;
      handle.hidden = true;
    },
    destroy() {
      root.removeEventListener('pointerover', onPointerOver);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('pointerleave', onPointerLeave);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('pointercancel', onPointerCancel);
      root.removeEventListener('keydown', onKeyDown);
      handle.remove();
      dropLine.remove();
    },
  };
}
