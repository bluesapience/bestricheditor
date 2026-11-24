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
import { imageFiles, pastedImages, splitFirst, uploadOne, altFromFile, markdownImage, trackFileDrag } from '../utils/imageUpload.js';

export const DEFAULT_MESSAGES = {
  placeholder: 'Write markdown here…',
  preview: 'Preview',
  edit: 'Edit',
  editorLabel: 'Markdown editor',
  previewLabel: 'Markdown preview',
  invalidDocument: 'Invalid document',
  uploadingFile: 'Uploading {name}…',
  uploadFailed: 'Image upload failed',
  uploadNotConfigured: 'Image upload is not configured',
  uploadTooLarge: 'Image is too large',
  uploadOneAtATime: 'Upload one image at a time',
  invalidUrl: 'Invalid or unsafe URL.',
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
    ['blur', opts.onBlur], ['selectionchange', opts.onSelectionChange], ['error', opts.onError],
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

  // ── Image upload ──────────────────────────────────────────────────────────
  // One image per action. A unique `![Uploading name…]()` placeholder is written at the
  // caret, then swapped for the real image (or removed on failure). No bytes are embedded.

  const inFlight = new Set();

  function placeholderFor(file) {
    const name = String(file.name || 'image').replace(/[\[\]\r\n]+/g, ' ').trim();
    let candidate;
    for (let n = 1; ; n++) {
      const shown = n === 1 ? name : `${name} (${n})`;
      const label = messages.uploadingFile.replace('{name}', () => shown); // function: no `$` patterns
      candidate = `![${label}]()`;
      if (!inFlight.has(candidate) && !textarea.value.includes(candidate)) return candidate;
    }
  }

  /** Write `value` into the textarea + model, keeping the caret at `caret`. */
  function setText(value, caret, caretEnd) {
    textarea.value = value;
    markdown = value;
    renderCache = null;
    if (caret != null) textarea.setSelectionRange(caret, caretEnd == null ? caret : caretEnd);
    if (isPreviewing) renderPreview(); else autoGrow();
    scheduleChange();
  }

  /**
   * Replace [start, end) with `text` and leave the selection at [selStart, selEnd].
   * While the textarea is focused this goes through the browser's own editing command, so
   * the change stays on the native undo stack; otherwise (or if the command is unavailable)
   * the value is written directly, which never steals focus.
   */
  function replaceRange(start, end, text, selStart, selEnd) {
    const v = textarea.value;
    if (document.activeElement === textarea) {
      textarea.setSelectionRange(start, end);
      let ok = false;
      try { ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete'); } catch (_) { ok = false; }
      if (ok) {
        if (markdown !== textarea.value) { // the command's input event normally syncs this already
          markdown = textarea.value;
          renderCache = null;
          scheduleChange();
        }
        textarea.setSelectionRange(selStart, selEnd);
        return;
      }
    }
    setText(v.slice(0, start) + text + v.slice(end), selStart, selEnd);
  }

  function insertAtCaret(text, atEnd) {
    const v = textarea.value;
    if (atEnd) {
      const sep = v && !v.endsWith('\n') ? '\n' : '';
      const n = v.length + sep.length + text.length;
      replaceRange(v.length, v.length, sep + text, n, n);
      return;
    }
    const s0 = textarea.selectionStart, e0 = textarea.selectionEnd;
    replaceRange(s0, e0, text, s0 + text.length, s0 + text.length);
  }

  function replacePlaceholder(ph, next) {
    const i = textarea.value.indexOf(ph);
    if (i === -1) return;
    const delta = next.length - ph.length;
    const end = i + ph.length;
    // Map each selection end through the replacement so a user's selection is kept.
    const map = (pos) => (pos >= end ? pos + delta : pos > i ? i + next.length : pos);
    replaceRange(i, end, next, map(textarea.selectionStart), map(textarea.selectionEnd));
  }

  async function uploadFiles(files, atEnd) {
    if (destroyed || readOnly) return;
    const { first, extra } = splitFirst(files);
    if (!first) return;
    if (extra.length) emitter.emit('error', { type: 'upload', error: new Error(messages.uploadOneAtATime), file: extra[0] });
    if (typeof opts.uploadImage !== 'function') {
      emitter.emit('error', { type: 'upload', error: new Error(messages.uploadNotConfigured), file: first });
      return;
    }
    if (atEnd || isPreviewing) showEdit();
    const ph = placeholderFor(first);
    inFlight.add(ph);
    insertAtCaret(ph, atEnd);
    try {
      const url = await uploadOne(first, { hook: opts.uploadImage, maxSize: opts.uploadMaxSize, messages });
      if (destroyed) return;
      if (readOnly) { // went read-only meanwhile: drop our transient placeholder, insert nothing
        markdown = markdown.replace(ph, '');
        textarea.value = markdown;
        renderCache = null;
        renderPreview();
        return;
      }
      replacePlaceholder(ph, markdownImage(altFromFile(first), url));
    } catch (error) {
      if (destroyed) return;
      replacePlaceholder(ph, '');
      emitter.emit('error', { type: 'upload', error, file: first });
    } finally {
      inFlight.delete(ph);
    }
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

  const hasFileDrag = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  on(root, 'dragover', (e) => { if (hasFileDrag(e)) e.preventDefault(); });
  on(root, 'drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt || !(dt.files && dt.files.length)) return;
    e.preventDefault(); // never let the browser navigate to a dropped file
    const imgs = imageFiles(dt.files);
    if (imgs.length) uploadFiles(imgs, !textarea.parentNode || textarea.hidden || e.target === preview || preview.contains(e.target));
  });
  on(textarea, 'paste', (e) => {
    const imgs = pastedImages(e.clipboardData); // text wins over a picture on the clipboard
    if (!imgs.length) return;
    e.preventDefault();
    uploadFiles(imgs, false);
  });
  unsubs.push(trackFileDrag(root, () => !readOnly));

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
