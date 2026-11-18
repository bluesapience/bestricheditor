/**
 * Floating inline formatting toolbar for BRE mode.
 * Appears above (or below) selected text; shows only marks the block supports.
 */

import { blockRegistry } from '../core/blockRegistry.js';

// Labels resolve through options.messages at build time. Glyphs use semantic
// elements (<b>, <i>, <u>) so they inherit the host's styling.
const MARK_DEFS = [
  { mark: 'bold',      msg: 'bold',       tag: 'b', text: 'B' },
  { mark: 'italic',    msg: 'italic',     tag: 'i', text: 'I' },
  { mark: 'underline', msg: 'underline',  tag: 'u', text: 'U' },
  { mark: 'code',      msg: 'inlineCode', tag: 'code', text: '<>' },
];

/**
 * @param {HTMLElement} root - editor root element
 * @param {{ handleLinkInsert: (fieldEl: HTMLElement) => void }} opts
 * @returns {{ destroy: () => void, handleMark: (mark: string) => void }}
 */
export function createInlineToolbar(root, { handleLinkInsert, messages, isReadOnly = () => false }) {
  const toolbar = document.createElement('div');
  toolbar.className = 'bre-inline-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', messages.textFormatting);
  toolbar.hidden = true;
  document.body.appendChild(toolbar);

  let visible = false;

  // ── Capability lookup ────────────────────────────────────────────────────

  function getBlockType(blockEl) {
    const typeClass = Array.from(blockEl.classList).find(c => c.startsWith('bre-block--'));
    return typeClass ? typeClass.slice('bre-block--'.length) : null;
  }

  function getCaps() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    if (!root.contains(sel.anchorNode)) return null;

    const anchor = sel.anchorNode.nodeType === Node.TEXT_NODE
      ? sel.anchorNode.parentElement
      : sel.anchorNode;
    const fieldEl = anchor?.closest('[data-bre-field]');
    if (!fieldEl) return null;

    const blockEl = fieldEl.closest('[data-bre-block-id]');
    if (!blockEl) return null;

    const blockType = getBlockType(blockEl);
    if (!blockType) return null;

    return blockRegistry.get(blockType)?.capabilities ?? null;
  }

  // ── Active state ─────────────────────────────────────────────────────────

  function isInsideCode() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    let node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    return !!node.closest?.('code');
  }

  function updateActiveStates() {
    toolbar.querySelectorAll('[data-mark]').forEach(btn => {
      const mark = btn.dataset.mark;
      let active = false;
      try {
        if (mark === 'bold')           active = document.queryCommandState('bold');
        else if (mark === 'italic')    active = document.queryCommandState('italic');
        else if (mark === 'underline') active = document.queryCommandState('underline');
        else if (mark === 'code')      active = isInsideCode();
      } catch (_) { /* queryCommandState can throw in edge cases */ }
      btn.classList.toggle('bre-inline-toolbar-btn--active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  // ── Mark commands ────────────────────────────────────────────────────────

  function wrapInCode() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const code = document.createElement('code');
    code.appendChild(range.extractContents());
    range.insertNode(code);
    const newRange = document.createRange();
    newRange.selectNodeContents(code);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  function unwrapCode() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    const code = node.closest?.('code');
    if (!code) return;
    const frag = document.createDocumentFragment();
    while (code.firstChild) frag.appendChild(code.firstChild);
    code.parentNode.replaceChild(frag, code);
  }

  function handleMark(mark) {
    if (mark === 'bold')           document.execCommand('bold');
    else if (mark === 'italic')    document.execCommand('italic');
    else if (mark === 'underline') document.execCommand('underline');
    else if (mark === 'code') {
      if (isInsideCode()) unwrapCode();
      else wrapInCode();
    }
    updateActiveStates();
  }

  // ── Build toolbar ────────────────────────────────────────────────────────

  function getLinkFieldEl() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    const anchor = sel.anchorNode.nodeType === Node.TEXT_NODE
      ? sel.anchorNode.parentElement
      : sel.anchorNode;
    return anchor?.closest('[data-bre-field]') ?? null;
  }

  function buildButtons(caps) {
    toolbar.textContent = '';
    const marks = caps.marks ?? [];
    let hasMarkBtns = false;

    MARK_DEFS.forEach(({ mark, msg, tag, text }) => {
      if (!marks.includes(mark)) return;
      hasMarkBtns = true;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bre-inline-toolbar-btn';
      btn.dataset.mark = mark;
      btn.setAttribute('aria-label', messages[msg]);
      btn.setAttribute('title', messages[msg]);
      btn.setAttribute('aria-pressed', 'false');
      const glyph = document.createElement(tag);
      glyph.textContent = text;
      btn.appendChild(glyph);
      btn.addEventListener('mousedown', e => {
        e.preventDefault(); // preserve selection
        handleMark(mark);
      });
      toolbar.appendChild(btn);
    });

    if (hasMarkBtns && caps.links) {
      const sep = document.createElement('span');
      sep.className = 'bre-inline-toolbar-sep';
      sep.setAttribute('aria-hidden', 'true');
      toolbar.appendChild(sep);
    }

    if (caps.links) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bre-inline-toolbar-btn';
      btn.setAttribute('aria-label', messages.link);
      btn.setAttribute('title', messages.link);
      btn.textContent = '\u{1F517}\uFE0E'; // text-presentation link glyph
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        const fieldEl = getLinkFieldEl();
        if (fieldEl) handleLinkInsert(fieldEl);
        hide();
      });
      toolbar.appendChild(btn);
    }

    updateActiveStates();
  }

  // ── Positioning ──────────────────────────────────────────────────────────

  function reposition() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const tw = toolbar.offsetWidth;
    const th = toolbar.offsetHeight;
    const gap = 8;

    const editorRect = root.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(editorRect.left, Math.min(left, editorRect.right - tw));

    let top = rect.top - th - gap;
    if (top < gap) top = rect.bottom + gap;

    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
  }

  // ── Show / hide ──────────────────────────────────────────────────────────

  function show(caps) {
    buildButtons(caps);
    toolbar.hidden = false;
    toolbar.classList.add('bre-inline-toolbar--visible');
    visible = true;
    requestAnimationFrame(reposition);
  }

  function hide() {
    toolbar.classList.remove('bre-inline-toolbar--visible');
    toolbar.hidden = true;
    visible = false;
  }

  // ── Event listeners ──────────────────────────────────────────────────────

  function onSelectionChange() {
    const sel = window.getSelection();
    if (isReadOnly() || !sel || sel.isCollapsed) { hide(); return; }
    const caps = getCaps();
    if (!caps || (!caps.marks?.length && !caps.links)) { hide(); return; }
    show(caps);
  }

  function onScroll() {
    if (visible) hide();
  }

  // Keyboard: Escape dismisses the toolbar without losing the selection.
  function onKeyDown(e) {
    if (e.key === 'Escape' && visible) hide();
  }

  document.addEventListener('selectionchange', onSelectionChange);
  root.addEventListener('mouseup', onSelectionChange);
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  root.addEventListener('keydown', onKeyDown);

  function destroy() {
    document.removeEventListener('selectionchange', onSelectionChange);
    root.removeEventListener('mouseup', onSelectionChange);
    document.removeEventListener('scroll', onScroll, { capture: true });
    root.removeEventListener('keydown', onKeyDown);
    toolbar.remove();
  }

  return { destroy, handleMark };
}
