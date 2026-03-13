/**
 * BREM — Markdown mode editor factory.
 * options.mode = "BREM"
 */
import { generateId } from '../utils/id.js';
import { debounce } from '../utils/debounce.js';
import { sanitizeHTML } from '../utils/sanitize.js';
import { parseMarkdown } from '../utils/markdown.js';

/**
 * Inject the KaTeX stylesheet from CDN once per page.
 */
function ensureKaTeXStyles() {
  if (document.getElementById('bre-katex-css')) return;
  const link = document.createElement('link');
  link.id = 'bre-katex-css';
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css';
  document.head.appendChild(link);
}

export function createBremEditor(container, options = {}) {
  ensureKaTeXStyles();

  const opts = {
    onChange: null,
    ...options,
  };

  // ── Internal state ────────────────────────────────────────────────────────
  let markdown = '';
  let isPreviewing = false;

  // ── DOM structure ─────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'bre-editor bre-editor--brem';
  root.setAttribute('data-bre-mode', 'BREM');

  const textarea = document.createElement('textarea');
  textarea.className = 'bre-brem-textarea';
  textarea.placeholder = 'Write markdown here… (blur or click Preview to render)';

  const preview = document.createElement('div');
  preview.className = 'bre-brem-preview';
  preview.hidden = true;

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'bre-brem-toggle';
  toggleBtn.type = 'button';
  toggleBtn.textContent = 'Preview';

  root.appendChild(textarea);
  root.appendChild(preview);
  root.appendChild(toggleBtn);
  container.appendChild(root);

  // ── Debounced onChange ────────────────────────────────────────────────────
  const notifyChange = opts.onChange
    ? debounce(() => opts.onChange(getDoc()), 300)
    : null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function autoGrow() {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  function getDoc() {
    return {
      id: generateId(),
      version: 1,
      created: Date.now(),
      updated: Date.now(),
      blocks: [
        {
          id: generateId(),
          type: 'markdown',
          data: { markdown },
        },
      ],
    };
  }

  function renderPreview() {
    preview.innerHTML = sanitizeHTML(parseMarkdown(markdown), { allowKaTeX: true });
  }

  function showPreview() {
    if (!markdown.trim()) return; // don't switch if empty
    renderPreview();
    textarea.hidden = true;
    preview.hidden = false;
    toggleBtn.textContent = 'Edit';
    isPreviewing = true;
  }

  function showEdit() {
    textarea.hidden = false;
    preview.hidden = true;
    toggleBtn.textContent = 'Preview';
    isPreviewing = false;
    textarea.focus();
    autoGrow();
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  textarea.addEventListener('input', () => {
    markdown = textarea.value;
    autoGrow();
    if (notifyChange) notifyChange();
  });

  textarea.addEventListener('blur', () => {
    if (markdown.trim()) {
      showPreview();
    }
  });

  // mousedown preventDefault stops the textarea from blurring before click fires,
  // which would otherwise trigger showPreview() via the blur handler and flip
  // isPreviewing to true before the click handler reads it.
  toggleBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  toggleBtn.addEventListener('click', () => {
    if (isPreviewing) {
      showEdit();
    } else {
      showPreview();
    }
  });

  preview.addEventListener('click', () => {
    showEdit();
  });

  // ── Public API ─────────────────────────────────────────────────────────────

  function getJSON() {
    return getDoc();
  }

  function setJSON(doc) {
    if (!doc || !Array.isArray(doc.blocks)) {
      console.warn('[bre] BREM setJSON: invalid document');
      return;
    }
    const block = doc.blocks.find(b => b.type === 'markdown');
    if (!block) return;
    markdown = block.data.markdown || '';
    textarea.value = markdown;
    autoGrow();
    if (isPreviewing) {
      renderPreview();
    }
  }

  function getHTML() {
    return sanitizeHTML(parseMarkdown(markdown), { allowKaTeX: true });
  }

  function destroy() {
    root.remove();
  }

  return { getJSON, setJSON, getHTML, destroy };
}
