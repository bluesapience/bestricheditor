/**
 * Floating inline formatting toolbar for BRE mode.
 * Appears above (or below) selected text; shows only marks the block supports.
 */

import { blockRegistry } from '../core/blockRegistry.js';

const MARK_DEFS = [
  { mark: 'bold',      label: 'Bold',        html: '<b>B</b>' },
  { mark: 'italic',    label: 'Italic',      html: '<i>I</i>' },
  { mark: 'underline', label: 'Underline',   html: '<u>U</u>' },
  { mark: 'code',      label: 'Inline code', html: '&lt;&gt;' },
];

const LINK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

/**
 * @param {HTMLElement} root - editor root element
 * @param {{ handleLinkInsert: (fieldEl: HTMLElement) => void }} opts
 * @returns {{ destroy: () => void, handleMark: (mark: string) => void }}
 */
export function createInlineToolbar(root, { handleLinkInsert }) {
  const toolbar = document.createElement('div');
  toolbar.className = 'bre-inline-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Text formatting');
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
    toolbar.innerHTML = '';
    const marks = caps.marks ?? [];
    let hasMarkBtns = false;

    MARK_DEFS.forEach(({ mark, label, html }) => {
      if (!marks.includes(mark)) return;
      hasMarkBtns = true;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bre-inline-toolbar-btn';
      btn.dataset.mark = mark;
      btn.setAttribute('aria-label', label);
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = html; // static literal — no user data
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
      btn.setAttribute('aria-label', 'Link (Cmd+K)');
      btn.innerHTML = LINK_ICON; // static SVG literal — no user data
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
    toolbar.classList.add('bre-inline-toolbar--visible');
    visible = true;
    requestAnimationFrame(reposition);
  }

  function hide() {
    toolbar.classList.remove('bre-inline-toolbar--visible');
    visible = false;
  }

  // ── Event listeners ──────────────────────────────────────────────────────

  function onSelectionChange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { hide(); return; }
    const caps = getCaps();
    if (!caps || (!caps.marks?.length && !caps.links)) { hide(); return; }
    show(caps);
  }

  function onScroll() {
    if (visible) hide();
  }

  document.addEventListener('selectionchange', onSelectionChange);
  root.addEventListener('mouseup', onSelectionChange);
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });

  function destroy() {
    document.removeEventListener('selectionchange', onSelectionChange);
    root.removeEventListener('mouseup', onSelectionChange);
    document.removeEventListener('scroll', onScroll, { passive: true, capture: true });
    toolbar.remove();
  }

  return { destroy, handleMark };
}
