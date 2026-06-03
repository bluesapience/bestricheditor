/**
 * BREM — Markdown mode editor factory.
 * options.mode = "BREM"
 */
import { generateId } from '../utils/id.js';
import { debounce } from '../utils/debounce.js';
import { sanitizeHTML } from '../utils/sanitize.js';
import { parseMarkdown } from '../utils/markdown.js';
import { htmlToBlocks } from '../utils/htmlToBlocks.js';
import { ensureKaTeXStyles } from '../utils/katex-lazy.js';

export function createBremEditor(container, options = {}) {
  ensureKaTeXStyles();

  const opts = {
    onChange: null,
    ...options,
  };

  // ── Internal state ────────────────────────────────────────────────────────
  let markdown = '';
  let isPreviewing = true;

  // Stable document / block IDs — generated once, preserved across getJSON() calls.
  let _docId = generateId();
  let _blockId = generateId();
  let _created = Date.now();

  // ── DOM structure ─────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'bre-editor bre-editor--brem';
  root.setAttribute('data-bre-mode', 'BREM');

  const textarea = document.createElement('textarea');
  textarea.className = 'bre-brem-textarea';
  textarea.placeholder = 'Write markdown here… (blur or click Preview to render)';
  textarea.hidden = true;

  const preview = document.createElement('div');
  preview.className = 'bre-brem-preview';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'bre-brem-toggle';
  toggleBtn.type = 'button';
  toggleBtn.textContent = 'Edit';

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
      id: _docId,
      version: 1,
      created: _created,
      updated: Date.now(),
      blocks: [{ id: _blockId, type: 'markdown', data: { markdown } }],
    };
  }

  function renderPreview() {
    preview.innerHTML = sanitizeHTML(parseMarkdown(markdown), { allowKaTeX: true, allowMedia: true });
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
    if (doc.id) _docId = doc.id;
    if (doc.created) _created = doc.created;
    const block = doc.blocks.find(b => b.type === 'markdown');
    if (!block) return;
    if (block.id) _blockId = block.id;
    markdown = block.data.markdown || '';
    textarea.value = markdown;
    autoGrow();
    if (isPreviewing) {
      renderPreview();
    }
  }

  function blocksToMarkdown(blocks) {
    const lines = [];
    const getText = (d) => {
      if (d.html != null) {
        const div = document.createElement('div');
        div.innerHTML = sanitizeHTML(d.html);
        return div.textContent;
      }
      return d.text || '';
    };
    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph':
          lines.push(getText(block.data));
          break;
        case 'heading':
          lines.push(`${'#'.repeat(block.data.level || 1)} ${getText(block.data)}`);
          break;
        case 'quote':
          lines.push(`> ${getText(block.data)}`);
          break;
        case 'code':
          lines.push(`\`\`\`${block.data.language || ''}\n${block.data.code || ''}\n\`\`\``);
          break;
        case 'bulleted_list':
          lines.push(`- ${getText(block.data)}`);
          break;
        case 'numbered_list':
          lines.push(`1. ${getText(block.data)}`);
          break;
        case 'divider':
          lines.push('---');
          break;
        default:
          break;
      }
      lines.push('');
    }
    return lines.join('\n').trimEnd();
  }

  function setHTML(html) {
    if (typeof html !== 'string') return;
    const blocks = htmlToBlocks(html);
    const md = blocksToMarkdown(blocks);
    markdown = md;
    textarea.value = md;
    autoGrow();
    if (isPreviewing) renderPreview();
  }

  function getHTML() {
    return sanitizeHTML(parseMarkdown(markdown), { allowKaTeX: true, allowMedia: true });
  }

  function destroy() {
    root.remove();
  }

  return { getJSON, setJSON, getHTML, setHTML, destroy };
}
