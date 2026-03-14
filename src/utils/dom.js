/**
 * DOM helpers for Best Rich Editor.
 */

/**
 * Create a DOM element with attributes and children.
 * Handles class, data-* attributes, boolean attributes (disabled, checked, etc.)
 */
export function elt(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  }
  return el;
}

/**
 * Escape HTML entities to prevent XSS.
 */
export function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Return the closest ancestor element (or self) with data-bre-block-id.
 */
export function closestBlock(el) {
  let node = el;
  while (node && node !== document) {
    if (node.hasAttribute && node.hasAttribute('data-bre-block-id')) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Get the character offset of the cursor within a contenteditable element.
 */
export function getCursorOffset(el) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(el);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  return preCaretRange.toString().length;
}

/**
 * Set the cursor to a specific character offset within a contenteditable element.
 */
export function setCursorOffset(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let remaining = offset;
  let node = walker.nextNode();

  // Handle empty element
  if (!node) {
    const range = document.createRange();
    range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }

  while (node) {
    const len = node.textContent.length;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode();
  }

  // If offset is beyond content, place at end
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Returns true if the cursor is at offset 0 in the element.
 */
export function isCursorAtStart(el) {
  return getCursorOffset(el) === 0;
}

/**
 * Returns true if the cursor is at the end of the element's text content.
 */
export function isCursorAtEnd(el) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const offset = getCursorOffset(el);
  return offset === el.textContent.length;
}
