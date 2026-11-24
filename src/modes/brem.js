/**
 * BREM — Markdown mode editor factory.
 * options.mode = "BREM"
 *
 * Note: programmatic setJSON()/setHTML() never fire 'change' — only user edits do.
 */
import { generateId } from '../utils/id.js';
import { sanitizeToFragment } from '../utils/sanitize.js';
import { parseMarkdown, markdownToBlocks } from '../utils/markdown.js';
import { blocksToMarkdown } from '../utils/blocksToMarkdown.js';
import { htmlToBlocks } from '../utils/htmlToBlocks.js';
import { ensureKaTeXStyles, loadKaTeX, getKaTeX } from '../utils/katex-lazy.js';
import { EventEmitter } from '../core/events.js';

export const DEFAULT_MESSAGES = {
  placeholder: 'Write markdown here…',
  preview: 'Preview',
  edit: 'Edit',
  editorLabel: 'Markdown editor',
  previewLabel: 'Markdown preview',
  invalidDocument: 'Invalid document',
};

const CHANGE_DELAY = 300;

export function createBremEditor(container, options = {}) {
  ensureKaTeXStyles();

  const opts = { onChange: null, readOnly: false, placeholder: undefined, dir: undefined, ...options };
  const messages = { ...DEFAULT_MESSAGES, ...(opts.messages || {}) };
  if (typeof opts.placeholder === 'string') messages.placeholder = opts.placeholder;

  const emitter = new EventEmitter();
  const unsubs = [];
  for (const [ev, fn] of [
    ['change', opts.onChange], ['ready', opts.onReady], ['focus', opts.onFocus],
    ['blur', opts.onBlur], ['selectionchange', opts.onSelectionChange],
  ]) {
    if (typeof fn === 'function') unsubs.push(emitter.on(ev, fn));
  }

  // ── Internal state ────────────────────────────────────────────────────────
  let markdown = '';
  let isPreviewing = true;
  let readOnly = !!opts.readOnly;
  let destroyed = false;
  let changeTimer = null;
  // Sanitized render of the current markdown, shared by preview and getHTML().
  // Valid only for the exact source and KaTeX-loaded state it was built from.
  let renderCache = null; // { md, katex, frag }
  const SANITIZE_OPTS = { allowKaTeX: true, allowMedia: true };

  let _docId = generateId();
  let _blockId = generateId();
  let _created = Date.now();

  // ── DOM structure ─────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'bre-editor bre-editor--brem';
  root.setAttribute('data-bre-mode', 'BREM');
  if (opts.dir) root.setAttribute('dir', opts.dir);

  const textarea = document.createElement('textarea');
  textarea.className = 'bre-brem-textarea';
  textarea.placeholder = messages.placeholder;
  textarea.setAttribute('aria-label', messages.editorLabel);
  textarea.hidden = true;

  const preview = document.createElement('div');
  preview.className = 'bre-brem-preview';
  preview.setAttribute('data-bre-placeholder', messages.placeholder);
  preview.setAttribute('aria-label', messages.previewLabel);
  preview.tabIndex = 0;

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'bre-brem-toggle';
  toggleBtn.type = 'button';

  root.appendChild(textarea);
  root.appendChild(preview);
  if (!readOnly) root.appendChild(toggleBtn);
  container.appendChild(root);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function autoGrow() {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  function getDoc() {
    return {
      id: _docId,
      version: 1,
      created: _created,
      updated: Date.now(),
      blocks: [{ id: _blockId, type: 'markdown', data: { markdown } }],
    };
  }

  function scheduleChange() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      changeTimer = null;
      if (!destroyed) emitter.emit('change', getDoc());
    }, CHANGE_DELAY);
  }

  function updateToggleLabel() {
    toggleBtn.textContent = isPreviewing ? messages.edit : messages.preview;
    toggleBtn.setAttribute('aria-label', toggleBtn.textContent);
  }

  /** Parse + sanitize once per (markdown, KaTeX state); callers must clone the result. */
  function sanitizedFragment() {
    const katex = !!getKaTeX();
    if (!renderCache || renderCache.md !== markdown || renderCache.katex !== katex) {
      renderCache = {
        md: markdown,
        katex,
        frag: sanitizeToFragment(parseMarkdown(markdown, { embedAllowlist: opts.embedAllowlist }), SANITIZE_OPTS),
      };
    }
    return renderCache.frag;
  }

  function renderPreview() {
    if (!markdown.trim()) { preview.replaceChildren(); return; } // :empty -> placeholder
    preview.replaceChildren(sanitizedFragment().cloneNode(true));
    // KaTeX loads lazily — re-render once it arrives if the text has math.
    if (!getKaTeX() && markdown.includes('$')) {
      const snapshot = markdown;
      loadKaTeX().then((k) => {
        if (k && !destroyed && snapshot === markdown && isPreviewing) renderPreview();
      });
    }
  }

  function showPreview() {
    if (!markdown.trim() && !readOnly) return; // don't switch if empty
    renderPreview();
    textarea.hidden = true;
    preview.hidden = false;
    isPreviewing = true;
    updateToggleLabel();
  }

  function showEdit() {
    if (readOnly) return;
    textarea.hidden = false;
    preview.hidden = true;
    isPreviewing = false;
    updateToggleLabel();
    textarea.focus();
    autoGrow();
  }

  function loadMarkdown(md) {
    markdown = md;
    textarea.value = md;
    clearTimeout(changeTimer); // programmatic loads must not emit a stale change
    changeTimer = null;
    // The textarea is hidden while previewing; showEdit() sizes it on entry.
    if (isPreviewing || readOnly) renderPreview(); else autoGrow();
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  const on = (target, type, fn, o) => {
    target.addEventListener(type, fn, o);
    unsubs.push(() => target.removeEventListener(type, fn, o));
  };

  on(textarea, 'input', () => {
    markdown = textarea.value;
    renderCache = null; // source changed: free the stale render
    autoGrow();
    scheduleChange();
  });

  on(textarea, 'blur', () => {
    if (markdown.trim() && !readOnly) showPreview();
  });

  on(textarea, 'keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); showPreview(); }
  });

  // mousedown preventDefault keeps the textarea from blurring before click fires.
  on(toggleBtn, 'mousedown', (e) => e.preventDefault());

  on(toggleBtn, 'click', () => {
    if (isPreviewing) showEdit(); else showPreview();
  });

  on(preview, 'click', (e) => {
    if (readOnly) return;
    if (e.target.closest && e.target.closest('a')) return; // let links navigate
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && preview.contains(sel.anchorNode)) return; // user is selecting text
    showEdit();
  });

  on(preview, 'keydown', (e) => {
    if (!readOnly && (e.key === 'Enter' || e.key === ' ') && e.target === preview) {
      e.preventDefault();
      showEdit();
    }
  });

  on(root, 'focusin', (e) => {
    if (!e.relatedTarget || !root.contains(e.relatedTarget)) emitter.emit('focus', e);
  });
  on(root, 'focusout', (e) => {
    if (!e.relatedTarget || !root.contains(e.relatedTarget)) emitter.emit('blur', e);
  });

  on(document, 'selectionchange', () => {
    if (document.activeElement === textarea) {
      emitter.emit('selectionchange', {
        blockId: null,
        collapsed: textarea.selectionStart === textarea.selectionEnd,
      });
      return;
    }
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && preview.contains(sel.anchorNode)) {
      emitter.emit('selectionchange', { blockId: null, collapsed: sel.isCollapsed });
    }
  });

  // ── Read-only handling ────────────────────────────────────────────────────

  function applyReadOnly() {
    if (readOnly) {
      if (toggleBtn.parentNode) toggleBtn.remove();
      textarea.remove();
      preview.hidden = false;
      isPreviewing = true;
      renderPreview();
      root.setAttribute('data-bre-readonly', 'true');
    } else {
      root.removeAttribute('data-bre-readonly');
      if (!textarea.parentNode) root.insertBefore(textarea, preview);
      if (!toggleBtn.parentNode) root.appendChild(toggleBtn);
      textarea.value = markdown;
      textarea.hidden = true;
      preview.hidden = false;
      isPreviewing = true;
      updateToggleLabel();
    }
  }

  // Initial state
  if (readOnly) {
    textarea.remove();
    root.setAttribute('data-bre-readonly', 'true');
  } else {
    updateToggleLabel();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns the document. Default: a single `markdown` block (BREM storage).
   * `getJSON({ as: 'blocks' })` parses the markdown into BRE blocks
   * (heading/paragraph/lists/quote/code/divider/table/image/formula...).
   */
  function getJSON(getOpts) {
    const doc = getDoc();
    if (getOpts && getOpts.as === 'blocks') doc.blocks = markdownToBlocks(markdown);
    return doc;
  }

  /** Accepts markdown blocks and/or any BRE blocks (converted to markdown). */
  function setJSON(doc) {
    if (!doc || !Array.isArray(doc.blocks)) {
      console.warn('[bre] BREM setJSON: ' + messages.invalidDocument);
      return;
    }
    if (doc.id) _docId = doc.id;
    if (doc.created) _created = doc.created;
    const mdBlock = doc.blocks.find(b => b && b.type === 'markdown');
    if (mdBlock && mdBlock.id) _blockId = mdBlock.id;
    loadMarkdown(blocksToMarkdown(doc.blocks));
  }

  function setHTML(html) {
    if (typeof html !== 'string') return;
    loadMarkdown(blocksToMarkdown(htmlToBlocks(html)));
  }

  function getHTML() {
    if (!markdown.trim()) return '';
    // Serialising already-sanitized DOM (a read, not an innerHTML assignment).
    const holder = document.createElement('div');
    holder.appendChild(sanitizedFragment().cloneNode(true));
    return holder.innerHTML;
  }

  function setReadOnly(v) {
    v = !!v;
    if (v === readOnly) return;
    readOnly = v;
    applyReadOnly();
  }

  function focus() {
    if (readOnly) preview.focus();
    else if (isPreviewing) showEdit();
    else textarea.focus();
  }

  function blur() {
    if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(changeTimer);
    changeTimer = null;
    unsubs.forEach(u => u());
    unsubs.length = 0;
    if (emitter._listeners) emitter._listeners.clear();
    renderCache = null;
    root.remove();
  }

  const api = {
    getJSON, setJSON, getHTML, setHTML, destroy,
    setReadOnly,
    isReadOnly: () => readOnly,
    focus, blur,
    isEmpty: () => !markdown.trim(),
    on: (ev, fn) => emitter.on(ev, fn),
    off: (ev, fn) => emitter.off(ev, fn),
  };

  queueMicrotask(() => { if (!destroyed) emitter.emit('ready', api); });
  return api;
}
